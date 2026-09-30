import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const pin = JSON.parse(readFileSync(join(repository, 'official-source.lock.json'), 'utf8'));

/** Validate the source checkout used by development probes and build staging. */
export function verifyOfficialSource(source) {
  if (!/^[a-f0-9]{40}$/.test(pin.commit) || !/^[a-f0-9]{40}$/.test(pin.desktopTree)
    || !/^[a-f0-9]{40}$/.test(pin.dependencyLockBlob)) {
    throw new Error('Official source pin must contain full Git object IDs');
  }
  const directory = resolve(source);
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], {encoding: 'utf8'}).trim();
  const expect = (actual, expected, label) => {
    if (actual !== expected) throw new Error(`${label} differs from official-source.lock.json: ${actual}`);
  };
  // The probes import live source files, so require the checked-out tree to match the pin.
  expect(git('rev-parse', '--verify', `${pin.commit}^{commit}`), pin.commit, 'Commit');
  expect(git('rev-parse', 'HEAD'), pin.commit, 'Checked-out HEAD');
  const changedPaths = git('status', '--porcelain=v1', '--untracked-files=normal');
  if (changedPaths) throw new Error(`Official source checkout must be clean:\n${changedPaths}`);
  expect(git('rev-parse', `${pin.commit}:apps/desktop`), pin.desktopTree, 'Desktop source tree');
  expect(git('rev-parse', `${pin.commit}:pnpm-lock.yaml`), pin.dependencyLockBlob, 'Dependency lock blob');
  expect(git('rev-parse', `refs/tags/${pin.tag}^{commit}`), pin.commit, 'Release tag');
  const root = JSON.parse(git('show', `${pin.commit}:package.json`));
  const desktop = JSON.parse(git('show', `${pin.commit}:apps/desktop/package.json`));
  expect(root.version, pin.version, 'Harness version');
  expect(desktop.version, pin.version, 'Desktop version');
  expect(desktop.name, '@deepseek-ai/dsh-desktop', 'Desktop package name');
  if (desktop.private !== true) throw new Error('Official Desktop package is unexpectedly public');
  return {source: directory, pin};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || process.argv.length !== 3) {
    throw new Error('Usage: node scripts/verify-official-source.mjs /path/to/deepseek-harness');
  }
  const {pin: checked} = verifyOfficialSource(process.argv[2]);
  console.log(`Verified official Harness/Desktop ${checked.version} at ${checked.commit}`);
}
