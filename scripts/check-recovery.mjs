import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureProjectCheckpoint, createProjectRecovery, assertProjectRecoveryComplete} from '../src/desktop-adapter/stable/recovery.mjs';

function fixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'project-checkpoint-'));
  const manifestPath = join(stateDirectory, 'Fixture.agent-project');
  const home = join(stateDirectory, 'dsh'), profile = join(home, 'profiles/desktop');
  mkdirSync(profile, {recursive: true});
  writeFileSync(join(stateDirectory, 'project-desktop.json'), JSON.stringify({schemaVersion: 1, manifestPath}));
  writeFileSync(join(profile, 'package.json'), JSON.stringify({name: 'fixture', private: true, dependencies: {}, dsh: {profile: {bundles: []}}}));
  writeFileSync(join(home, 'settings.yaml'), 'locale:\n  preference: en\n');
  return {stateDirectory, manifestPath, home, profile};
}
test('official checkpoint restore preserves project data and rejects stale confirmations', async () => {
  const fixtureData = fixture(), {stateDirectory, home} = fixtureData;
  writeFileSync(join(home, 'conversation.txt'), 'keep conversation');
  await captureProjectCheckpoint(stateDirectory);
  writeFileSync(join(home, 'settings.yaml'), 'broken: [');
  const recovery = await createProjectRecovery(fixtureData);
  const slots = recovery.list(); assert.equal(slots.length, 1);
  const preview = await recovery.preview(slots[0].id);
  assert.ok(preview.changedFiles.includes('home/settings.yaml'));
  await recovery.restore(preview.previewId);
  assert.match(readFileSync(join(home, 'settings.yaml'), 'utf8'), /preference: en/);
  assert.equal(readFileSync(join(home, 'conversation.txt'), 'utf8'), 'keep conversation');
  assertProjectRecoveryComplete(stateDirectory);
  await assert.rejects(recovery.restore(preview.previewId), /expired/);
  assert.equal((await captureProjectCheckpoint(stateDirectory)).status, 'skipped-after-restore');
  recovery.dispose(); await assert.rejects(recovery.preview(slots[0].id));
});
test('dependency rebuild failure blocks boot and can be retried without consuming the good checkpoint', async () => {
  const data = fixture(); await captureProjectCheckpoint(data.stateDirectory);
  writeFileSync(join(data.profile, 'package.json'), JSON.stringify({name: 'changed'}));
  let fail = true, attempts = 0;
  const recovery = await createProjectRecovery({...data, materialize: async () => {attempts++; if (fail) throw new Error('offline')}});
  const id = recovery.list()[0].id;
  await assert.rejects(recovery.restore((await recovery.preview(id)).previewId));
  assert.throws(() => assertProjectRecoveryComplete(data.stateDirectory), /incomplete/);
  fail = false; await recovery.restore((await recovery.preview(id)).previewId);
  assert.equal(attempts, 2); assertProjectRecoveryComplete(data.stateDirectory); recovery.dispose();
});
test('first startup without a checkpoint offers no destructive recovery action', async () => {
  const data = fixture(); const recovery = await createProjectRecovery(data);
  assert.deepEqual(recovery.list(), []); await assert.rejects(recovery.preview('slot-1'));
  recovery.dispose();
});

test('early bundled-only checkpoint without a lockfile can complete real dependency recovery', async () => {
  const data = fixture();
  const bundled = join(data.profile, '.project-plugin'); mkdirSync(bundled);
  writeFileSync(join(bundled, 'package.json'), JSON.stringify({name: 'dsh-plugin-project', version: '0.0.0'}));
  writeFileSync(join(data.profile, 'package.json'), JSON.stringify({name: 'fixture', private: true,
    dependencies: {'dsh-plugin-project': 'link:./.project-plugin'}}));
  await captureProjectCheckpoint(data.stateDirectory);
  writeFileSync(join(data.profile, 'package.json'), 'broken: [');
  const recovery = await createProjectRecovery(data);
  try {
    await recovery.restore((await recovery.preview(recovery.list()[0].id)).previewId);
    assert.equal(existsSync(join(data.profile, 'pnpm-lock.yaml')), true);
    assertProjectRecoveryComplete(data.stateDirectory);
  } finally {recovery.dispose()}
});
