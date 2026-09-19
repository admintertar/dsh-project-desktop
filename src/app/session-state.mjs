import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute} from 'node:path';

/** Last open windows, deliberately independent of the recent-project history. */
export class SessionState {
  constructor(file) {
    this.file = file;
    this.value = {version: 1, projects: [], activePath: null};
    if (!existsSync(file)) return;
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.projects) || value.projects.some(item =>
        !item || typeof item.path !== 'string' || !isAbsolute(item.path) || typeof item.title !== 'string'
        || !['open', 'opening', 'failed', 'recovering'].includes(item.phase))) throw new Error('Invalid workspace session');
      this.value = {...value, projects: [...new Map(value.projects.map(item => [item.path, item])).values()]};
    } catch {
      // Keep the unreadable record for diagnosis instead of overwriting it on the next open.
      const backup = `${file}.unreadable-${Date.now()}`;
      renameSync(file, backup);
      this.warning = 'session-unreadable';
    }
  }
  list() {return structuredClone(this.value.projects)}
  get(path) {return this.list().find(item => item.path === path)}
  write(next) {
    mkdirSync(dirname(this.file), {recursive: true, mode: 0o700});
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', {mode: 0o600});
    renameSync(temporary, this.file);
    this.value = next;
  }
  update(path, patch) {
    const previous = this.get(path);
    const item = {...previous, ...patch, path};
    this.write({...this.value, projects: [...this.value.projects.filter(entry => entry.path !== path), item]});
  }
  remove(path) {
    this.write({...this.value, projects: this.value.projects.filter(item => item.path !== path),
      activePath: this.value.activePath === path ? null : this.value.activePath});
  }
  focus(path) {
    if (this.get(path) && this.value.activePath !== path) this.write({...this.value, activePath: path});
  }
  window(path) {return structuredClone(this.value.layouts?.[path])}
  saveWindow(path, bounds) {
    this.write({...this.value, layouts: {...this.value.layouts, [path]: bounds}});
  }
}
