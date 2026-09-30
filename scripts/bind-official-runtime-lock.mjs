/** Bind a frozen external graph to freshly built, verified official tarballs. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {parse} from 'yaml';
import {readOfficialRuntimeLock} from '../src/desktop-adapter/official/runtime-inputs.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
}

/** pnpm packs workspace ranges asynchronously, so JSON key order is not stable.
 * Require identical full manifests before changing ONLY first-party integrity
 * fields. Never resolve, update or replace any third-party dependency. Callers
 * must first verify the pinned checkout and official tarball descriptor.
 */
export function bindOfficialRuntimeLock(directory, set, inputs, readManifest = file =>
  JSON.parse(execFileSync('tar', ['-xOzf', file, 'package/package.json'], {cwd: set, encoding: 'utf8'}))) {
  const metadata = JSON.parse(readFileSync(join(directory, 'inputs.json'), 'utf8'));
  const baselineBytes = readFileSync(join(dirname(directory), 'package-manifests.json'));
  assert.equal(hash(baselineBytes), metadata.packageManifestsSha256, 'Package manifest baseline checksum changed');
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.schemaVersion, 1);
  const descriptor = {schemaVersion: 1, packages: baseline.packages.map(({manifestSha256, ...record}) => record)};
  assert.equal(hash(JSON.stringify(descriptor, null, 2) + '\n'), metadata.packageSetSha256,
    'Package manifest baseline differs from the locked package set');
  const {body} = readOfficialRuntimeLock(directory, {...inputs, packageSetSha256: metadata.packageSetSha256});
  const current = JSON.parse(readFileSync(join(set, 'desktop-packages.json'), 'utf8'));
  assert.deepEqual(current.packages.map(p => [p.name, p.version, p.file]),
    baseline.packages.map(p => [p.name, p.version, p.file]), 'Official package identities changed');
  const parsed = parse(body), expected = structuredClone(parsed);
  let bound = body;
  for (let index = 0; index < current.packages.length; index++) {
    const record = current.packages[index], original = baseline.packages[index];
    assert.match(record.file, /^[a-zA-Z0-9_.-]+\.tgz$/);
    assert.match(record.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(hash(canonical(readManifest(`desktop-packages/${record.file}`))), original.manifestSha256,
      `Official package manifest changed: ${record.name}`);
    const resolution = expected.packages[`${record.name}@file:desktop-packages/${record.file}`]?.resolution;
    assert.equal(resolution?.tarball, `file:desktop-packages/${record.file}`);
    assert.equal(resolution.integrity, original.integrity);
    const before = `resolution: {integrity: ${original.integrity}, tarball: ${resolution.tarball}}`;
    assert.equal(bound.split(before).length, 2, `Ambiguous local resolution: ${record.name}`);
    bound = bound.replace(before, `resolution: {integrity: ${record.integrity}, tarball: ${resolution.tarball}}`);
    resolution.integrity = record.integrity;
  }
  assert.deepEqual(parse(bound), expected, 'Binding changed the frozen dependency graph');
  return {body: bound, metadata};
}
