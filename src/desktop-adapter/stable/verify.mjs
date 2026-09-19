import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {lock, desktopSource} from '../paths.mjs';
import {desktopRequire} from './modules.mjs';

/** Check the installed graph, not just a version label or the presence of old tarballs. */
export function verifyRuntimeDependencies() {
  const source = JSON.parse(readFileSync(join(desktopSource, 'package.json'), 'utf8'));
  let checked = 0;
  for (const [name, expected] of Object.entries(source.dependencies)) {
    if (!name.startsWith('@deepseek-ai/') || !/^\d+\.\d+\.\d+/.test(expected)) continue;
    const actual = JSON.parse(readFileSync(desktopRequire.resolve(name + '/package.json'), 'utf8'));
    if (actual.version !== expected) throw new Error(`Stable dependency mismatch: ${name}: expected ${expected}, found ${actual.version}`);
    checked++;
  }
  const actual = JSON.parse(readFileSync(desktopRequire.resolve('@deepseek-ai/dsh/package.json'), 'utf8'));
  if (actual.version !== lock.harness.version) throw new Error('Installed Harness differs from the stable lock');
  return {checked, harnessVersion: actual.version};
}
