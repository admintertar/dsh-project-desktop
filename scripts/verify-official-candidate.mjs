import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const pin = JSON.parse(readFileSync(join(repository, 'official-candidate.lock.json'), 'utf8'));
const source = process.argv[2];
if (!source || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/verify-official-candidate.mjs /path/to/deepseek-harness');
}
if (!/^[a-f0-9]{40}$/.test(pin.commit) || !/^[a-f0-9]{40}$/.test(pin.desktopTree)
  || !/^[a-f0-9]{40}$/.test(pin.dependencyLockBlob)) {
  throw new Error('Official candidate pin must contain full Git object IDs');
}

const git = (...args) => execFileSync('git', ['-C', resolve(source), ...args], {encoding: 'utf8'}).trim();
const expect = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label} differs from official-candidate.lock.json: ${actual}`);
};

// Read only committed objects: a dirty source checkout cannot alter the verified inputs.
expect(git('rev-parse', '--verify', `${pin.commit}^{commit}`), pin.commit, 'Commit');
expect(git('rev-parse', `${pin.commit}:apps/desktop`), pin.desktopTree, 'Desktop source tree');
expect(git('rev-parse', `${pin.commit}:pnpm-lock.yaml`), pin.dependencyLockBlob, 'Dependency lock blob');
expect(git('rev-parse', `refs/tags/${pin.tag}^{commit}`), pin.commit, 'Release tag');
const root = JSON.parse(git('show', `${pin.commit}:package.json`));
const desktop = JSON.parse(git('show', `${pin.commit}:apps/desktop/package.json`));
expect(root.version, pin.version, 'Harness version');
expect(desktop.version, pin.version, 'Desktop version');
expect(desktop.name, '@deepseek-ai/dsh-desktop', 'Desktop package name');
if (desktop.private !== true) throw new Error('Official Desktop package is unexpectedly public');
console.log(`Verified official Harness/Desktop ${pin.version} at ${pin.commit}`);
