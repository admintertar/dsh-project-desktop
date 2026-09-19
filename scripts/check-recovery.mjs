import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {captureProjectCheckpoint, createProjectRecovery, assertProjectRecoveryComplete} from '../src/desktop-adapter/stable/recovery.mjs';
import {projectProfiles, profileSelectionPath} from '../src/desktop-adapter/stable/project-profiles.mjs';

function fixture() {
  const stateDirectory = mkdtempSync(join(tmpdir(), 'project-checkpoint-'));
  const manifestPath = join(stateDirectory, 'Fixture.agent-project');
  const home = join(stateDirectory, 'dsh'), profile = join(home, 'profiles/desktop');
  mkdirSync(profile, {recursive: true});
  writeFileSync(join(stateDirectory, 'project-desktop.json'), JSON.stringify({schemaVersion: 1, manifestPath}));
  writeFileSync(join(profile, 'package.json'), JSON.stringify({name: 'fixture', private: true, dependencies: {}, dsh: {profile: {bundles: []}}}));
  writeFileSync(join(profile, 'cordis.patch.yml.project-desktop-owner'), manifestPath + '\n');
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

test('official selection is project-local and missing selected Profiles do not silently fall back', async () => {
  const first = fixture(), second = fixture();
  for (const data of [first, second]) {
    writeFileSync(join(data.profile, 'cordis.patch.yml.project-desktop-owner'), data.manifestPath + '\n');
  }
  const one = await projectProfiles(first), two = await projectProfiles(second);
  one.create('review'); one.select('review');
  assert.equal(one.startup().name, 'review'); assert.equal(two.current(), 'desktop');
  assert.equal((await projectProfiles(first)).current(), 'review');
  assert.throws(() => one.create('../escape'));
  assert.throws(() => one.create('review'));
  writeFileSync(profileSelectionPath(first.stateDirectory), JSON.stringify({version: 2, active: 'missing'}));
  assert.throws(() => one.startup()); assert.equal(one.current(), 'missing');
});

test('a failed restore blocks only its Profile and changing the selected Profile invalidates previews', async () => {
  const data = fixture();
  const secondProfile = join(data.home, 'profiles/review'); mkdirSync(secondProfile);
  writeFileSync(join(secondProfile, 'package.json'), readFileSync(join(data.profile, 'package.json')));
  writeFileSync(join(secondProfile, 'cordis.patch.yml.project-desktop-owner'), data.manifestPath + '\n');
  await captureProjectCheckpoint(data.stateDirectory);
  await captureProjectCheckpoint(data.stateDirectory, 'review');
  let failure = true;
  const recovery = await createProjectRecovery({...data, profileName: 'review', materialize: async () => {if (failure) throw new Error('offline')}});
  writeFileSync(join(secondProfile, 'package.json'), JSON.stringify({name: 'changed'}));
  await assert.rejects(recovery.controller.executeCheckpointRestore((await recovery.controller.previewCheckpointRestore('slot-1')).previewId));
  assert.throws(() => assertProjectRecoveryComplete(data.stateDirectory, 'review'), /incomplete/);
  assertProjectRecoveryComplete(data.stateDirectory, 'desktop');
  failure = false;
  await recovery.controller.executeCheckpointRestore((await recovery.controller.previewCheckpointRestore('slot-1')).previewId);
  assertProjectRecoveryComplete(data.stateDirectory, 'review');
  const preview = await recovery.controller.previewCheckpointRestore('slot-1');
  mkdirSync(join(data.stateDirectory, 'profile-selection'));
  writeFileSync(profileSelectionPath(data.stateDirectory), JSON.stringify({version: 2, active: 'desktop'}));
  await assert.rejects(recovery.controller.executeCheckpointRestore(preview.previewId));
  assertProjectRecoveryComplete(data.stateDirectory, 'review');
  recovery.dispose();
});

test('recovery refuses a Profile bound to another project', async () => {
  const data = fixture(); await captureProjectCheckpoint(data.stateDirectory);
  writeFileSync(join(data.profile, 'cordis.patch.yml.project-desktop-owner'), '/other/Other.agent-project\n');
  await assert.rejects(createProjectRecovery(data), /not owned/);
  assertProjectRecoveryComplete(data.stateDirectory);
});
