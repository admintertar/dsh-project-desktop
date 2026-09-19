import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repository, lock} from '../src/desktop-adapter/paths.mjs';
import {assertSourceTree} from './source-integrity.mjs';
export function setupGuideSources(source) {
  const destination = join(repository, '.upstream/harness-guide');
  const missing = Object.keys(lock.harness.guideSources).filter(path => !existsSync(join(destination, path)));
  if (missing.length) {
    if (!source) throw new Error('Provide the pinned Harness Git cache with --harness-source');
    const archive = execFileSync('git', ['-C', resolve(source), 'archive', '--format=tar', lock.harness.commit,
      ...missing, 'LICENSE'], {maxBuffer: 8 * 1024 * 1024});
    mkdirSync(destination, {recursive: true});
    execFileSync('tar', ['-xf', '-', '-C', destination], {input: archive});
  }
  for (const [path, tree] of Object.entries(lock.harness.guideSources)) assertSourceTree(join(destination, path), tree);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) setupGuideSources(process.argv[2]);
