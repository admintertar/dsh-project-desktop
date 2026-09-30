/** Stage only the official web-facing artifacts used by a development Shell. */
import {createHash} from 'node:crypto';
import {strict as assert} from 'node:assert';
import {cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {officialBuildInputs} from '../src/desktop-adapter/official/build-inputs.mjs';
import {verifyOfficialSource} from './verify-official-source.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

/** Record every staged byte and reject links that would escape this directory. */
function stagedFiles(root) {
  const files = [];
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      if (!prefix && entry.name === 'inputs.json') continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Official development staging contains a symlink: ${relative}`);
      if (stat.isDirectory()) visit(path, relative);
      else if (stat.isFile()) files.push({path: relative,
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex')});
      else throw new Error(`Official development staging contains a non-file: ${relative}`);
    }
  };
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Verify staged bytes before a consumer loads them. */
export function verifyOfficialDevelopment(directory = join(repository, '.cache/official-development')) {
  const pin = JSON.parse(readFileSync(join(repository, 'official-source.lock.json'), 'utf8'));
  const inventory = JSON.parse(readFileSync(join(directory, 'inputs.json'), 'utf8'));
  if (inventory.kind !== 'official-development' || inventory.repository !== pin.repository
    || inventory.commit !== pin.commit || inventory.version !== pin.version
    || inventory.desktopTree !== pin.desktopTree || inventory.dependencyLockBlob !== pin.dependencyLockBlob) {
    throw new Error('Official development inputs differ from the pinned source');
  }
  assert.deepEqual(stagedFiles(directory), inventory.files, 'Official development staged files changed');
  return inventory;
}

/**
 * The Host and CLI still resolve through the official pnpm workspace. This
 * directory is a reproducible development bridge, not a portable installer.
 */
export async function prepareOfficialDevelopment(source) {
  const {source: checked, pin} = verifyOfficialSource(source);
  const inputs = officialBuildInputs(checked, pin);
  const destination = join(repository, '.cache/official-development');
  const staging = `${destination}.building-${process.pid}`;
  rmSync(staging, {recursive: true, force: true});
  mkdirSync(staging, {recursive: true});
  try {
    await build({entryPoints: [inputs.webDocument], outfile: join(staging, 'web-document.mjs'),
      bundle: true, platform: 'node', format: 'esm', target: 'node22'});
    cpSync(inputs.desktopPreload, join(staging, 'preload-app.cjs'));
    cpSync(inputs.webDist, join(staging, 'web'), {recursive: true});
    cpSync(inputs.license, join(staging, 'LICENSE'));
    const inventory = {schemaVersion: 1, kind: 'official-development', repository: pin.repository,
      commit: pin.commit, version: pin.version, desktopTree: pin.desktopTree,
      dependencyLockBlob: pin.dependencyLockBlob, source: checked,
      hostEntry: inputs.hostEntry, cliEntry: inputs.cliEntry,
      files: stagedFiles(staging)};
    writeFileSync(join(staging, 'inputs.json'), JSON.stringify(inventory, null, 2) + '\n');
    rmSync(destination, {recursive: true, force: true});
    renameSync(staging, destination);
    verifyOfficialDevelopment(destination);
    return {inputs, inventory, destination,
      webDocument: join(destination, 'web-document.mjs'),
      preload: join(destination, 'preload-app.cjs'), webDist: join(destination, 'web')};
  } catch (error) {
    rmSync(staging, {recursive: true, force: true});
    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length !== 1) {
    throw new Error('Usage: node scripts/prepare-official-development.mjs /path/to/deepseek-harness');
  }
  const result = await prepareOfficialDevelopment(args[0]);
  const saved = JSON.parse(readFileSync(join(result.destination, 'inputs.json'), 'utf8'));
  console.log(`Prepared ${saved.version} official development inputs at ${result.destination}`);
}
