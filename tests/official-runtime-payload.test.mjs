import {strict as assert} from 'node:assert';
import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {inventoryOfficialPayload, verifyOfficialRuntimePayload} from '../src/desktop-adapter/official/runtime-payload.mjs';

test('runtime consumption rejects mismatched source and modified executable bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-payload-'));
  try {
    const pin = {repository: 'official', commit: 'abc', version: '1.0.0', desktopTree: 'tree', dependencyLockBlob: 'lock'};
    writeFileSync(join(root, 'node'), 'node bytes', {mode: 0o755});
    const metadata = {schemaVersion: 1, kind: 'official-unsigned-development-runtime', ...pin,
      target: 'mac-arm64', signed: false, relocated: true, inventory: inventoryOfficialPayload(root)};
    writeFileSync(join(root, 'source.json'), JSON.stringify(metadata));
    assert.deepEqual(verifyOfficialRuntimePayload(root, pin, 'mac-arm64'), metadata);
    assert.throws(() => verifyOfficialRuntimePayload(root, {...pin, commit: 'different'}, 'mac-arm64'), /differs/);
    assert.throws(() => verifyOfficialRuntimePayload(root, pin, 'mac-x64'), /differs/);
    writeFileSync(join(root, 'node'), 'changed executable');
    assert.throws(() => verifyOfficialRuntimePayload(root, pin, 'mac-arm64'), /integrity/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('payload permits internal framework links and rejects links back to a workspace', {skip: process.platform === 'win32'}, () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-runtime-links-'));
  const root = join(base, 'payload');
  try {
    mkdirSync(join(root, 'Versions/A'), {recursive: true});
    writeFileSync(join(root, 'Versions/A/binary'), 'binary');
    symlinkSync('A', join(root, 'Versions/Current'));
    assert.ok(inventoryOfficialPayload(root).some(entry => entry.target === 'A'));
    writeFileSync(join(base, 'workspace-module'), 'external');
    symlinkSync('../workspace-module', join(root, 'module'));
    assert.throws(() => inventoryOfficialPayload(root), /external link/);
    rmSync(join(root, 'module'));
    symlinkSync(join(root, 'Versions/A/binary'), join(root, 'module'));
    assert.throws(() => inventoryOfficialPayload(root), /external link/);
  } finally {rmSync(base, {recursive: true, force: true});}
});
