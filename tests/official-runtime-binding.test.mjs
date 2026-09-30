import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {parse, stringify} from 'yaml';
import {bindOfficialRuntimeLock} from '../scripts/bind-official-runtime-lock.mjs';

test('binding changes only local tarball integrity and rejects changed official manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'official-lock-binding-'));
  const target = join(root, 'mac-arm64'), set = join(root, 'set');
  mkdirSync(target); mkdirSync(set);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const json = value => JSON.stringify(value, null, 2) + '\n';
  const record = {name: '@deepseek-ai/example', version: '1.0.0', file: 'example.tgz', bytes: 1, integrity: 'sha512-YQ=='};
  const manifest = {dependencies: {external: '^1.0.0'}, name: record.name, version: record.version};
  const original = {schemaVersion: 1, packages: [record]};
  const baseline = json({schemaVersion: 1, packages: [{...record, manifestSha256: hash(JSON.stringify(manifest))}]});
  const key = `${record.name}@file:desktop-packages/${record.file}`;
  const body = `lockfileVersion: '9.0'\npackages:\n  '${key}':\n    resolution: {integrity: ${record.integrity}, tarball: file:desktop-packages/${record.file}}\n  external@1.2.3:\n    resolution: {integrity: sha512-ZQ==}\nsnapshots:\n  '${key}':\n    dependencies: {external: 1.2.3}\n`;
  const pin = {repository: 'official', commit: 'fixed', version: '1.0.0'};
  const inputs = {pin, target: 'mac-arm64', release: {nodeVersion: '24.18.1', pnpmVersion: '11.7.0'}};
  try {
    writeFileSync(join(root, 'package-manifests.json'), baseline);
    writeFileSync(join(target, 'pnpm-lock.yaml'), body);
    writeFileSync(join(target, 'inputs.json'), json({schemaVersion: 1, ...pin, target: inputs.target,
      ...inputs.release, packageSetSha256: hash(json(original)), lockfileSha256: hash(body), packageManifestsSha256: hash(baseline)}));
    writeFileSync(join(set, 'desktop-packages.json'), json({schemaVersion: 1, packages: [{...record, bytes: 2, integrity: 'sha512-Yg=='}]}));
    const bound = bindOfficialRuntimeLock(target, set, inputs, () => ({version: manifest.version, name: manifest.name, dependencies: manifest.dependencies}));
    const expected = parse(body); expected.packages[key].resolution.integrity = 'sha512-Yg==';
    assert.deepEqual(parse(bound.body), expected);
    assert.throws(() => bindOfficialRuntimeLock(target, set, inputs,
      () => ({...manifest, dependencies: {external: '^2.0.0'}})), /manifest changed/);
    assert.throws(() => bindOfficialRuntimeLock(target, set, {...inputs, pin: {...pin, commit: 'other'}}, () => manifest), /does not match/);
    writeFileSync(join(target, 'pnpm-lock.yaml'), stringify(expected));
    assert.throws(() => bindOfficialRuntimeLock(target, set, inputs, () => manifest), /checksum changed/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
