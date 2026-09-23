import {existsSync, realpathSync, statSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {classifyProjectTarget, findProjectFile} from './project-files.mjs';
import {validResourceBranch, validResourceUrl, validRepositoryName} from '../shared/remote-resource.mjs';

/**
 * Import an existing agent-project repository through the same clone machinery the
 * creation guide uses, so private remotes keep the plugin's credential chain.
 *
 * The checkout always lands in a fresh `<parent>/<name>` folder. A repository that
 * turns out not to be an agent-project is rolled back completely, which the welcome
 * window promises in its copy; an ambiguous one is kept, because deleting a checkout
 * the user can still open by hand would be data loss.
 */
export class RepositoryImports {
  /** id -> {url, branch, target}; a Renderer only ever names the id it was given. */
  pending = new Map();
  constructor(clones) {this.clones = clones;}

  /** Validate the form and start one clone job; resolves as soon as Git is running. */
  async start(value) {
    const draft = value && typeof value === 'object' ? value : {};
    const url = typeof draft.url === 'string' ? draft.url.trim() : '';
    const branch = typeof draft.branch === 'string' ? draft.branch.trim() : '';
    const name = typeof draft.name === 'string' ? draft.name.trim() : '';
    if (!validResourceUrl(url)) throw new Error('resource-url-invalid');
    if (!validResourceBranch(branch)) throw new Error('resource-branch-invalid');
    if (!validRepositoryName(name)) throw new Error('repository-name-invalid');
    let parent;
    try {parent = realpathSync(draft.directory);} catch {throw new Error('repository-directory-invalid');}
    if (!statSync(parent).isDirectory()) throw new Error('repository-directory-invalid');
    const target = join(parent, name);
    if (existsSync(target)) throw new Error('repository-target-exists');
    const id = `import-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    await this.clones.start({id, name, url, branch});
    this.pending.set(id, {url, branch, target});
    return {id, target};
  }

  /** Complete a finished job: install, verify the project entry, then open or roll back. */
  async finish(id, signal) {
    const entry = this.pending.get(typeof id === 'string' ? id : '');
    if (!entry) throw new Error('operation-not-ready');
    const state = (await this.clones.snapshot()).find(item => item.id === id);
    if (!state || state.status !== 'completed' || state.url !== entry.url || state.branch !== entry.branch) throw new Error('operation-not-ready');
    await this.clones.install({id, url: entry.url, branch: entry.branch}, entry.target, signal);
    this.pending.delete(id);
    await this.clones.remove(id);
    const kind = classifyProjectTarget(entry.target);
    if (kind === 'file') return findProjectFile(entry.target);
    // An ambiguous checkout stays on disk: the folder still holds openable projects.
    if (kind === 'multiple') throw new Error(`repository-ambiguous:${entry.target}`);
    await rm(entry.target, {recursive: true, force: true});
    throw new Error('repository-not-project');
  }

  /** Abandon a running job and its staging without touching the final folder. */
  async cancel(id) {
    this.pending.delete(typeof id === 'string' ? id : '');
    await this.clones.remove(id);
    return true;
  }
}
