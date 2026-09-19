import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSourceTree} from './source-integrity.mjs';
import {repository, lock, desktopSource, projectSource} from '../src/desktop-adapter/paths.mjs';

export function verifyUpstream() {
  if (lock.channel !== 'stable' || lock.desktop.package !== 'dsh-plugin-desktop') throw new Error('Only stable is supported');
  assertSourceTree(desktopSource, lock.desktop.tree);
  assertSourceTree(projectSource, lock.project.tree);
  for (const [path, tree] of Object.entries(lock.harness.guideSources)) {
    assertSourceTree(join(repository, '.upstream/harness-guide', path), tree);
  }
  const inventory = join(repository, '.upstream/desktop/vendor/dsh-runtime', lock.harness.version);
  assertSourceTree(inventory, lock.harness.inventoryTree);
  const manifest = JSON.parse(readFileSync(join(desktopSource, 'package.json'), 'utf8'));
  const metadata = JSON.parse(readFileSync(join(inventory, 'manifest.json'), 'utf8'));
  const channels = JSON.parse(readFileSync(join(repository, '.upstream/desktop/upstream.json'), 'utf8')).channels;
  if (manifest.version !== lock.desktop.version || manifest.dependencies['@deepseek-ai/dsh'] !== lock.harness.version
    || metadata.commit !== lock.harness.commit || metadata.version !== lock.harness.version
    || channels.stable.commit !== lock.harness.commit || channels.stable.runtimePackageVersion !== lock.harness.version) {
    throw new Error('Desktop / Harness stable pins disagree');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyUpstream();
  console.log(`Official stable source intact: Desktop ${lock.desktop.version}, DSH ${lock.harness.version}`);
}
