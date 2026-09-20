import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {readFileSync} from 'node:fs';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const lock = JSON.parse(readFileSync(join(repository, 'upstream.lock.json'), 'utf8'));
export const desktopSource = join(repository, '.upstream/desktop/dsh-plugin-desktop');
/**
 * Development-only override: compile the companion plugin from a local working
 * tree so uncommitted edits reach a development shell without the commit /
 * lock / snapshot steps. The pinned tree check is skipped and release packaging
 * refuses to run while it is set; see docs/development.md.
 */
export const localProjectSource = process.env.DSH_PROJECT_PLUGIN_SOURCE
  ? resolve(process.env.DSH_PROJECT_PLUGIN_SOURCE) : undefined;
export const projectSource = localProjectSource ?? join(repository, '.upstream/project');
export const runtimePackage = join(repository, '.cache/runtime/dsh-plugin-desktop');
export const projectPackage = join(repository, '.cache/runtime/dsh-plugin-project');
