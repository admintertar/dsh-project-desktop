import {accessSync, constants, realpathSync, statSync} from 'node:fs';
import {basename} from 'node:path';

/** Pinned Project library, built without starting a Host or copying plugin business logic. */
export const loadGuideResources = () => import('../../../dist/guide-resources.mjs');

/** Directory selection is owned by the Shell; working-tree detection comes from the Resources page. */
export async function inspectGuideResource(path, signal) {
  signal?.throwIfAborted();
  let canonical;
  try {
    canonical = realpathSync(path);
    if (!statSync(canonical).isDirectory()) throw new Error();
    accessSync(canonical, constants.R_OK);
  } catch {throw new Error('resource-unavailable')}
  const {inspectResourceGit, runResourceGit} = await loadGuideResources();
  const git = await inspectResourceGit(canonical, (args, cwd, options) => runResourceGit(args, cwd, {...options, signal}));
  signal?.throwIfAborted();
  return {path: canonical, name: basename(canonical), git};
}
