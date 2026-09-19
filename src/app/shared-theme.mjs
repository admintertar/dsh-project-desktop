const valid = value => ['system', 'light', 'dark'].includes(value);

/** App-owned preference. Persistence and nativeTheme are supplied by the application. */
export class SharedTheme {
  #value;
  #clients = new Map();
  #tail = Promise.resolve();
  #nativeInitialized = false;
  constructor({initial, persist, applyNative}) {
    if (initial !== undefined && !valid(initial)) throw new Error('Invalid stored theme');
    this.#value = initial;
    this.persist = persist;
    this.applyNative = applyNative;
  }
  get value() {return this.#value}
  #enqueue(action) {
    const task = this.#tail.then(action);
    this.#tail = task.catch(() => {});
    return task;
  }
  async connect(id, preference, apply) {
    if (!valid(preference)) throw new Error('Invalid project theme');
    await this.#enqueue(async () => {
      if (this.#clients.has(id)) throw new Error('Theme client is already connected');
      if (this.#value === undefined) {
        await this.persist(preference);
        this.#value = preference;
      }
      if (!this.#nativeInitialized) {
        await this.applyNative(this.#value);
        this.#nativeInitialized = true;
      }
      await apply(this.#value);
      this.#clients.set(id, apply);
    });
    return () => this.#enqueue(() => {this.#clients.delete(id)});
  }
  select(preference) {
    if (!valid(preference)) return Promise.reject(new Error('Invalid theme'));
    return this.#enqueue(async () => {
      await this.persist(preference);
      this.#value = preference;
      await this.applyNative(preference);
      this.#nativeInitialized = true;
      const applied = await Promise.allSettled([...this.#clients.values()].map(apply => Promise.resolve().then(() => apply(preference))));
      const errors = applied.filter(value => value.status === 'rejected').map(value => value.reason);
      if (errors.length) throw new AggregateError(errors, 'Some project windows failed to apply the shared theme');
    });
  }
}
