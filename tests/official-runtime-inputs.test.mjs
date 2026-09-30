import {strict as assert} from 'node:assert';
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {officialRuntimeTarget, readOfficialRuntimeLock} from '../src/desktop-adapter/official/runtime-inputs.mjs';

// Target selection must fail before any runtime download or native code execution.
test('official runtime preparation accepts only supported native targets', () => {
  assert.equal(officialRuntimeTarget('darwin', 'arm64'), 'mac-arm64');
  assert.equal(officialRuntimeTarget('darwin', 'x64'), 'mac-x64');
  assert.equal(officialRuntimeTarget('win32', 'x64'), 'win-x64');
  assert.throws(() => officialRuntimeTarget('linux', 'x64'), /Unsupported/);
  assert.throws(() => officialRuntimeTarget('win32', 'arm64'), /Unsupported/);
});

test('committed runtime lock rejects another source, package set, target, ABI or changed bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-runtime-lock-'));
  try {
    cpSync(new URL('../official-runtime-locks/mac-arm64/', import.meta.url), directory, {recursive: true});
    const pin = JSON.parse(readFileSync(new URL('../official-source.lock.json', import.meta.url), 'utf8'));
    const metadata = JSON.parse(readFileSync(join(directory, 'inputs.json'), 'utf8'));
    const inputs = {pin, target: 'mac-arm64', packageSetSha256: metadata.packageSetSha256,
      release: {nodeVersion: metadata.nodeVersion, pnpmVersion: metadata.pnpmVersion}};
    const valid = readOfficialRuntimeLock(directory, inputs);
    assert.ok(valid.body.includes('lockfileVersion:'));
    for (const override of [
      {pin: {...pin, commit: '0'.repeat(40)}}, {target: 'mac-x64'}, {packageSetSha256: '0'.repeat(64)},
      {release: {...inputs.release, nodeVersion: '0.0.0'}}, {release: {...inputs.release, pnpmVersion: '0.0.0'}},
    ]) assert.throws(() => readOfficialRuntimeLock(directory, {...inputs, ...override}), /does not match/);
    writeFileSync(join(directory, 'pnpm-lock.yaml'), valid.body + '\n# changed\n');
    assert.throws(() => readOfficialRuntimeLock(directory, inputs), /checksum changed/);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
