/** Serializes ownership per canonical project identity, independently of Electron and DSH. */
export class ProjectRegistry {
  #entries = new Map();
  #closed = false;

  list() {return [...this.#entries].map(([id, entry]) => ({id, phase: entry.phase}))}

  async open(id, create) {
    if (this.#closed) throw new Error('Application is closing');
    let entry = this.#entries.get(id);
    if (entry) {
      if (entry.phase === 'blocked') throw new Error('Previous Host shutdown is unconfirmed; retry close first');
      if (entry.phase === 'closing') {await entry.closeTask; return this.open(id, create)}
      const value = await entry.ready;
      value.focus?.();
      return value;
    }
    const controller = new AbortController();
    entry = {phase: 'opening', controller};
    this.#entries.set(id, entry);
    entry.ready = Promise.resolve().then(() => create(controller.signal)).then(value => {
      entry.value = value;
      if (controller.signal.aborted) throw controller.signal.reason;
      entry.phase = 'open';
      return value;
    }).catch(error => {
      if (typeof error?.projectResource?.close === 'function') {
        entry.value = error.projectResource;
        if (entry.phase !== 'closing') entry.phase = 'blocked';
        throw error;
      }
      if (entry.phase !== 'closing' && this.#entries.get(id) === entry) this.#entries.delete(id);
      throw error;
    });
    return entry.ready;
  }

  close(id) {
    const entry = this.#entries.get(id);
    if (!entry) return Promise.resolve();
    if (entry.closeTask) return entry.closeTask;
    entry.phase = 'closing';
    entry.controller.abort(new DOMException('Project closed', 'AbortError'));
    entry.closeTask = (async () => {
      await entry.ready.catch(() => {});
      try {
        await entry.value?.close();
        if (this.#entries.get(id) === entry) this.#entries.delete(id);
      } catch (error) {
        // Retain ownership if the old Host may still be alive; never open a competing Host.
        entry.phase = 'blocked';
        entry.closeTask = undefined;
        throw error;
      }
    })();
    return entry.closeTask;
  }

  async closeAll() {
    this.#closed = true;
    const results = await Promise.allSettled([...this.#entries.keys()].map(id => this.close(id)));
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) {
      this.#closed = false;
      throw new AggregateError(failed.map(result => result.reason), 'Project shutdown failed');
    }
  }
}
