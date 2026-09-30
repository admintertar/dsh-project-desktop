import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectReleaseUpdater} from '../src/desktop-adapter/official/project-release-updater.mjs';
import {createOfficialUpdateFixture} from '../scripts/official-update-fixture.mjs';

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'project-updater-'));
  const fixture = createOfficialUpdateFixture('darwin');
  const updater = new ProjectReleaseUpdater({directory, request: fixture.request, platform: 'darwin'});
  t.after(async () => {updater.dispose(); await rm(directory, {recursive: true, force: true})});
  return {directory, fixture, updater};
}
test('our feed produces official progress/readiness events and rechecks the installer before handoff', async t => {
  const {fixture, updater} = await setup(t), progress = [], ready = [];
  updater.on('download-progress', value => progress.push(value.percent));
  updater.on('update-downloaded', value => ready.push(value.version));
  assert.equal((await updater.checkForUpdates()).updateInfo.version, '0.1.12');
  await updater.downloadUpdate();
  const artifact = await updater.verifiedArtifact();
  assert.deepEqual(await readFile(artifact.path), fixture.next.body);
  assert.equal(progress[0], 0); assert.equal(progress.at(-1), 100);
  assert.deepEqual(ready, ['0.1.12']);
  if (process.platform !== 'win32') assert.equal((await stat(artifact.path)).mode & 0o777, 0o600);
  await writeFile(artifact.path, 'altered');
  await assert.rejects(updater.verifiedArtifact(), /changed after download/);
});
test('corrupt downloads never become installable and do not replace an existing installer', async t => {
  const {directory, fixture, updater} = await setup(t);
  await writeFile(join(directory, fixture.next.name), 'keep');
  await updater.checkForUpdates(); fixture.corrupt = true;
  await assert.rejects(updater.downloadUpdate(), /SHA-256 mismatch/);
  assert.equal(await readFile(join(directory, fixture.next.name), 'utf8'), 'keep');
  assert.deepEqual(await readdir(directory), [fixture.next.name]);
  await assert.rejects(updater.verifiedArtifact(), /No verified installer/);
});
test('a changed version-bound manifest cannot silently change the confirmed download', async t => {
  const {directory, fixture, updater} = await setup(t);
  await updater.checkForUpdates(); fixture.next.release.sourceCommit = 'b'.repeat(40);
  await assert.rejects(updater.downloadUpdate(), /confirmed update changed/);
  assert.deepEqual(await readdir(directory), []);
});
test('invalid or oversized metadata and disposed requests fail before installation', async t => {
  const {updater} = await setup(t);
  updater.request = async () => new Response('x'.repeat(16385));
  await assert.rejects(updater.checkForUpdates(), /size limit/);
  updater.request = async () => Response.json({schemaVersion: 1, version: '0.1.12'});
  await assert.rejects(updater.checkForUpdates(), /Invalid Project Desktop/);
  updater.dispose();
  updater.request = async (_url, init) => {init.signal.throwIfAborted()};
  await assert.rejects(updater.checkForUpdates(), /abort/i);
});
