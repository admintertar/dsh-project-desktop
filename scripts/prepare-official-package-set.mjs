/** Build the official local-tarball closure used by Desktop's production runtime. */
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {officialBuildInputs} from '../src/desktop-adapter/official/build-inputs.mjs';
import {verifyOfficialSource} from './verify-official-source.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

/** Run the pinned official pnpm CLI without relying on a machine-global version. */
function run(node, pnpm, cwd, args) {
  const result = spawnSync(node, [pnpm, ...args], {cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Official pnpm ${args.join(' ')} failed (${String(result.status)}):\n${(result.stderr || result.stdout).slice(-4000)}`);
  }
}

/** Validate the completed tarballs with the official package-set verifier. */
function verifySet(source, set, version) {
  const loader = join(source, 'node_modules/tsx/dist/loader.mjs');
  const module = pathToFileURL(join(source, 'apps/desktop/src/core-package-set.ts')).href;
  const code = 'const {verifyDesktopCorePackageSet} = await import(process.argv[1]); verifyDesktopCorePackageSet(process.argv[2], process.argv[3]);';
  const result = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', code, module, set, version],
    {cwd: source, encoding: 'utf8'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Official package-set verification failed:\n${(result.stderr || result.stdout).slice(-4000)}`);
}

/** Check both the official tarball hashes and the Shell's fixed source identity. */
export function verifyOfficialPackageSet(source, directory = join(repository, '.cache/official-package-set')) {
  const {source: root, pin} = verifyOfficialSource(source);
  const metadata = JSON.parse(readFileSync(join(directory, 'source.json'), 'utf8'));
  if (metadata.schemaVersion !== 1 || metadata.kind !== 'official-desktop-package-set'
    || metadata.repository !== pin.repository || metadata.commit !== pin.commit
    || metadata.version !== pin.version || metadata.desktopTree !== pin.desktopTree
    || metadata.dependencyLockBlob !== pin.dependencyLockBlob) {
    throw new Error('Official package set differs from the pinned source');
  }
  const descriptor = readFileSync(join(directory, 'desktop-packages.json'));
  const count = JSON.parse(descriptor.toString('utf8')).packages.length;
  if (metadata.packageCount !== count
    || metadata.descriptorSha256 !== createHash('sha256').update(descriptor).digest('hex')) {
    throw new Error('Official package-set descriptor changed');
  }
  verifySet(root, directory, pin.version);
  return {metadata, packageCount: count};
}

/**
 * Run the official Desktop packaging stages through `prepare:packages`. The
 * output is portable first-party tarballs, but external npm dependencies and
 * native primary-runtime components are assembled by later official stages.
 */
export function prepareOfficialPackageSet(source) {
  const checked = verifyOfficialSource(source);
  const root = checked.source;
  const {pin} = checked;
  const pnpm = join(root, 'apps/desktop/node_modules/pnpm/bin/pnpm.mjs');
  if (!existsSync(pnpm)) throw new Error('Run pnpm install --frozen-lockfile in the official source first');
  const destination = join(repository, '.cache/official-package-set');
  const staging = `${destination}.building-${process.pid}`;
  rmSync(staging, {recursive: true, force: true});
  mkdirSync(staging, {recursive: true});
  try {
    run(process.execPath, pnpm, root, ['run', 'build:official']);
    officialBuildInputs(root, pin);
    const dsh = join(staging, 'packed-dsh');
    const vendor = join(staging, 'packed-vendor');
    const landlock = join(staging, 'packed-landlock');
    const set = join(staging, 'package-set');
    run(process.execPath, pnpm, root, ['run', 'release:pack', '--family', 'dsh', '--out', dsh, '--concurrency', '8']);
    run(process.execPath, pnpm, root, ['--dir', 'apps/desktop-host', 'pack', '--pack-destination', dsh]);
    run(process.execPath, pnpm, root, ['run', 'release:pack', '--family', 'vendor', '--out', vendor, '--concurrency', '4']);
    run(process.execPath, pnpm, root, ['--dir', 'native/system', 'run', 'build:ts']);
    mkdirSync(landlock);
    run(process.execPath, pnpm, root, ['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', landlock]);
    run(process.execPath, pnpm, root, ['exec', 'tsx', 'apps/desktop/scripts/prepare-package-set.ts',
      '--from', dsh, '--from', vendor, '--from', landlock, '--out', set]);
    verifySet(root, set, pin.version);
    verifyOfficialSource(root);
    const descriptor = readFileSync(join(set, 'desktop-packages.json'));
    const packages = JSON.parse(descriptor.toString('utf8')).packages;
    writeFileSync(join(set, 'source.json'), JSON.stringify({schemaVersion: 1, kind: 'official-desktop-package-set',
      repository: pin.repository, commit: pin.commit, version: pin.version, desktopTree: pin.desktopTree,
      dependencyLockBlob: pin.dependencyLockBlob, packageCount: packages.length,
      descriptorSha256: createHash('sha256').update(descriptor).digest('hex')}, null, 2) + '\n');
    rmSync(destination, {recursive: true, force: true});
    renameSync(set, destination);
    verifyOfficialPackageSet(root, destination);
    return {destination, packageCount: packages.length, pin};
  } finally {rmSync(staging, {recursive: true, force: true});}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length !== 1) {
    throw new Error('Usage: node scripts/prepare-official-package-set.mjs /path/to/deepseek-harness');
  }
  const result = prepareOfficialPackageSet(args[0]);
  console.log(`Prepared ${result.packageCount} official Desktop core tarballs at ${result.destination}`);
}
