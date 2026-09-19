import {constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {cp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadGuideResources} from '../desktop-adapter/stable/guide-resources.mjs';
import {validResourceUrl, validResourceBranch} from '../shared/remote-resource.mjs';

const marker = 'project-creation-draft-v1';
const fail = code => {throw new Error(code)};

/** Only called after acquiring the application's single-instance lock. */
export async function cleanupGuideClones(userData) {
  const parent = join(userData, 'creation-drafts');
  if (!existsSync(parent) || lstatSync(parent).isSymbolicLink()) return;
  for (const entry of readdirSync(parent, {withFileTypes: true})) {
    if (!entry.isDirectory() || !/^draft-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const path = join(parent, entry.name);
    try {if (readFileSync(join(path, 'owner'), 'utf8') === marker) await rm(path, {recursive: true, force: true});}
    catch { /* Preserve unrecognized or inaccessible state. */ }
  }
}

/** The Shell owns temporary placement; the unchanged plugin owns cloning, progress and credentials. */
export class GuideClones {
  entries = new Map();
  closing = false;
  constructor(userData, library, runGit) {
    this.parent = join(userData, 'creation-drafts');
    this.library = library;
    this.runGit = runGit ?? library.runResourceGit;
    this.auth = new library.ResourceGitAuthentication();
  }
  static async create(userData, options = {}) {
    return new GuideClones(userData, await loadGuideResources(), options.runGit);
  }
  open() {if (this.closing) fail('project-closing')}
  async start(value) {
    this.open();
    const {id, name, url, branch = ''} = value ?? {};
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)
      || typeof name !== 'string' || !name.trim() || name.length > 160) fail('resource-config-invalid');
    if (!validResourceUrl(url)) fail('resource-url-invalid');
    if (!validResourceBranch(branch)) fail('resource-branch-invalid');
    const previous = this.entries.get(id);
    if (previous?.url === url && previous.branch === branch) {
      const state = await this.view(previous);
      if (['cloning', 'completed'].includes(state.status)) return state;
    }
    await this.remove(id);
    this.open();
    if (this.entries.size >= 100) fail('resource-config-invalid');
    mkdirSync(this.parent, {recursive: true, mode: 0o700});
    if (lstatSync(this.parent).isSymbolicLink()) fail('operation-storage-failed');
    const directory = mkdtempSync(join(this.parent, 'draft-'));
    try {
      writeFileSync(join(directory, 'owner'), marker, {mode: 0o600});
      const root = join(directory, 'workspace'); mkdirSync(root);
      const store = new this.library.ProjectResourceStore(this.library.createProjectFile(join(root, 'draft.agent-project')), this.runGit);
      const manager = new this.library.ResourceCloneManager(store, join(directory, 'runtime'), this.runGit, undefined, this.auth);
      const entry = {id, url, branch, directory, root, manager};
      this.entries.set(id, entry);
      entry.operation = await manager.start({requestId: randomUUID(), expectedRevision: store.revision(), name: name.trim(),
        url, branch: branch || undefined, path: 'repository'});
      this.open();
      return await this.view(entry);
    } catch (error) {
      if (this.entries.has(id)) await this.remove(id); else await rm(directory, {recursive: true, force: true});
      throw error;
    }
  }
  async view(entry) {
    const state = await entry.manager.snapshot(false);
    const operation = state.operations.find(item => item.id === entry.operation?.id);
    return {id: entry.id, url: entry.url, branch: entry.branch, status: operation?.status ?? 'cloning',
      phase: operation?.phase, percent: operation?.percent, error: operation?.error};
  }
  async snapshot() {return Promise.all([...this.entries.values()].map(entry => this.view(entry)))}
  async cancel(id) {
    this.open();
    const entry = this.entries.get(id);
    if (!entry?.operation) fail('operation-not-found');
    await entry.manager.cancel(entry.operation.id);
    return this.view(entry);
  }
  async remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    return entry.cleanup ??= (async () => {
      await entry.manager.dispose();
      await rm(entry.directory, {recursive: true, force: true});
      if (this.entries.get(id) === entry) this.entries.delete(id);
    })();
  }
  async retain(ids) {
    this.open();
    if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== 'string')) fail('resource-config-invalid');
    await Promise.all([...this.entries.keys()].filter(id => !ids.includes(id)).map(id => this.remove(id)));
  }
  authentication(value) {
    this.open();
    if (value?.path === '/keys' && value.method === 'GET') return {keys: this.library.gitKeyChoices()};
    if (value?.path !== '' || !['GET', 'POST'].includes(value.method)) fail('git-auth-invalid');
    if (value.method === 'POST') this.auth.answer(value.body?.id, value.body?.credential);
    return this.auth.snapshot();
  }
  async install(item, target, signal) {
    this.open(); signal?.throwIfAborted();
    const entry = this.entries.get(item.id);
    if (!entry || entry.url !== item.url || entry.branch !== (item.branch ?? '')
      || (await this.view(entry)).status !== 'completed') fail('operation-not-ready');
    // Preserve the staging repository until the whole project succeeds, so rollback can be retried.
    await cp(join(entry.root, 'repository'), target, {recursive: true, force: false, errorOnExist: true,
      verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE});
    signal?.throwIfAborted();
  }
  async dispose() {
    this.closing = true; this.auth.dispose();
    return this.cleanup ??= Promise.all([...this.entries.keys()].map(id => this.remove(id)));
  }
}
