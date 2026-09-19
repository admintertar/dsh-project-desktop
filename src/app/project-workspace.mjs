import {basename, resolve} from 'node:path';
import {ProjectRegistry} from '../windows/project-registry.mjs';

/** Per-project transitions serialize stop, recovery and restart; other projects stay usable. */
export class ProjectWorkspace {
  #queues = new Map();
  #recoveries = new Map();
  #quitting = false;
  constructor({session, resolveProject, create, recovery, changed = () => {}}) {
    Object.assign(this, {session, resolveProject, create, recovery, changed});
    this.registry = new ProjectRegistry();
    this.projects = new Map();
    this.errors = new Map();
  }
  #run(path, action) {
    if (this.#quitting) return Promise.reject(new Error('Application is closing'));
    const task = (this.#queues.get(path) ?? Promise.resolve()).catch(() => {}).then(action);
    this.#queues.set(path, task);
    void task.finally(() => {if (this.#queues.get(path) === task) this.#queues.delete(path)}).catch(() => {});
    return task;
  }
  #record(path, phase) {
    this.session.update(path, {title: basename(path, '.agent-project'), phase});
    this.changed();
  }
  #fail(path, error) {
    this.errors.set(path, error.message ?? String(error));
    this.#record(path, 'failed');
  }
  async #open(path, safeMode = false) {
    if (this.projects.has(path) && this.session.get(path)?.phase === 'open'
      && !safeMode && !this.projects.get(path).safeMode
      && this.registry.list().some(entry => entry.id === path && entry.phase === 'open')) {
      const project = this.projects.get(path); project.focus(); return project;
    }
    this.#recoveries.get(path)?.dispose(); this.#recoveries.delete(path);
    try {
      // A previous stop failure must be resolved before another Host may own this state.
      await this.registry.close(path);
      this.projects.delete(path);
      this.#record(path, 'opening');
      const project = await this.registry.open(path, signal => this.create(path, signal, {safeMode}));
      this.projects.set(path, project);
      this.#record(path, safeMode ? 'failed' : 'open');
      if (!safeMode) this.errors.delete(path);
      this.changed();
      return project;
    } catch (error) {this.#fail(path, error); throw error}
  }
  open(target) {
    if (this.#quitting) return Promise.reject(new Error('Application is closing'));
    let path;
    try {path = this.resolveProject(target)}
    catch (error) {
      path = resolve(target);
      this.#fail(path, error);
      return Promise.reject(error);
    }
    return this.#run(path, () => this.#open(path));
  }
  async #stop(path) {
    await this.registry.close(path);
    this.projects.delete(path);
  }
  close(path) {
    return this.#run(path, async () => {
      try {
        await this.#stop(path);
        this.#recoveries.get(path)?.dispose(); this.#recoveries.delete(path);
        this.session.remove(path); this.errors.delete(path); this.changed();
      } catch (error) {this.#fail(path, error); throw error}
    });
  }
  restart(path) {
    return this.#run(path, async () => {
      const safeMode = Boolean(this.projects.get(path)?.safeMode);
      try {await this.#stop(path); return await this.#open(path, safeMode)}
      catch (error) {this.#fail(path, error); throw error}
    });
  }
  safeMode(path) {
    return this.#run(path, async () => {
      if (!this.session.get(path)) throw new Error('Unknown recovery project');
      if (this.projects.get(path)?.safeMode && this.registry.list().some(entry => entry.id === path && entry.phase === 'open')) {
        this.projects.get(path).focus(); return this.projects.get(path);
      }
      return this.#open(path, true);
    });
  }
  exitSafeMode(path) {
    return this.#run(path, async () => {
      try {await this.#stop(path); this.#record(path, 'failed')}
      catch (error) {this.#fail(path, error); throw error}
    });
  }
  fail(path, error) {
    return this.#run(path, async () => {
      try {await this.#stop(path)} catch (shutdown) {error = new AggregateError([error, shutdown], `${error.message}; ${shutdown.message}`)}
      this.#fail(path, error);
    });
  }
  beginRecovery(path, {requested = false} = {}) {
    return this.#run(path, async () => {
      if (!this.session.get(path)) throw new Error('Unknown recovery project');
      try {
        await this.#stop(path);
        if (requested) this.errors.delete(path);
        this.#record(path, 'recovering');
        let recovery = this.#recoveries.get(path);
        if (!recovery) {recovery = await this.recovery(path); this.#recoveries.set(path, recovery)}
        return recovery;
      } catch (error) {this.#fail(path, error); throw error}
    });
  }
  recover(path, action = 'list', value) {
    return this.#run(path, async () => {
      if (!this.session.get(path)) throw new Error('Unknown recovery project');
      try {
        await this.#stop(path);
        this.#record(path, 'failed');
        let recovery = this.#recoveries.get(path);
        if (!recovery) {recovery = await this.recovery(path); this.#recoveries.set(path, recovery)}
        if (action === 'list') return recovery.list();
        if (action === 'preview') return recovery.preview(value);
        if (action !== 'restore') throw new Error('Unsupported recovery action');
        await recovery.restore(value);
        return await this.#open(path);
      } catch (error) {this.#fail(path, error); throw error}
    });
  }
  async restore() {
    const active = this.session.value.activePath;
    const entries = this.session.list();
    await Promise.allSettled(entries.map(item => {
      if (item.phase === 'opening') this.#fail(item.path, new Error('startup-interrupted'));
      else if (item.phase === 'open') return this.open(item.path);
    }));
    this.projects.get(active)?.focus();
    return this.failures();
  }
  failures() {
    return this.session.list().filter(item => ['failed', 'recovering'].includes(item.phase)).map(item => ({...item, error: this.errors.get(item.path), safeMode: Boolean(this.projects.get(item.path)?.safeMode)}));
  }
  async shutdown() {
    this.#quitting = true;
    await Promise.allSettled([...this.#queues.values()]);
    try {
      // Explicit project closes remove records. Application quit preserves the set.
      await this.registry.closeAll();
      this.projects.clear();
      for (const recovery of this.#recoveries.values()) recovery.dispose();
      this.#recoveries.clear();
    } catch (error) {
      this.#quitting = false;
      for (const path of this.projects.keys()) {
        if (!this.registry.list().some(entry => entry.id === path)) this.projects.delete(path);
        else this.#fail(path, error);
      }
      throw error;
    }
  }
  async resumeAfterShutdown() {
    if (!this.#quitting || this.registry.list().length || this.projects.size) throw new Error('Shutdown must complete before resuming projects');
    this.registry = new ProjectRegistry();
    this.#quitting = false;
    return this.restore();
  }
}
