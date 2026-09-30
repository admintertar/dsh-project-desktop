import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOfficialHostRequest, projectDisposer} from '../src/desktop-adapter/official/host-request.mjs';
import {prepareOfficialProfile} from '../src/desktop-adapter/official/profile.mjs';
import {officialPin} from '../src/desktop-adapter/official/paths.mjs';
import {ProjectRegistry} from '../src/windows/project-registry.mjs';

test('native requests never send a project cookie to another origin or follow a redirect', async () => {
  const calls = [];
  const request = createOfficialHostRequest('http://127.0.0.1:12001/?token=private', 'session=owned', async (...args) => {calls.push(args); return new Response('ok')});
  await request('/api/project/snapshot', {headers: new Headers({Accept: 'application/json'}), redirect: 'follow'});
  assert.equal(calls[0][1].headers.get('cookie'), 'session=owned');
  assert.equal(calls[0][1].headers.get('accept'), 'application/json');
  assert.equal(calls[0][1].redirect, 'error');
  for (const path of ['http://127.0.0.1:12002/api', '//example.org/api', 'https://127.0.0.1:12001/', 'http://u:p@127.0.0.1:12001/']) {
    assert.throws(() => request(path), /project Host/);
  }
  assert.equal(calls.length, 1);
});

test('a failed startup retains the Host until cleanup retry confirms its exit', async () => {
  const registry = new ProjectRegistry();
  let uiCleanups = 0, stops = 0, starts = 0;
  const close = projectDisposer([() => {uiCleanups++}, async () => {if (++stops === 1) throw new Error('unconfirmed')}]);
  await assert.rejects(registry.open('a', async () => {
    starts++;
    const error = new Error('renderer boot failed');
    try {await close()} catch {error.projectResource = {close}}
    throw error;
  }), /renderer boot failed/);
  assert.equal(registry.list()[0].phase, 'blocked');
  await assert.rejects(registry.open('a', () => {starts++}), /shutdown is unconfirmed/);
  await registry.close('a');
  assert.equal(starts, 1); assert.equal(stops, 2); assert.equal(uiCleanups, 1);
  assert.deepEqual(registry.list(), []);
  await close(); assert.equal(stops, 2);
});

test('Stable project data is refused before any marker or Profile is modified', async () => {
  const root = mkdtempSync(join(tmpdir(), 'official-project-owner-'));
  try {
    const plugin = join(root, 'plugin'); mkdirSync(join(plugin, 'lib'), {recursive: true});
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({name: 'dsh-plugin-project'}));
    writeFileSync(join(plugin, 'lib/build.json'), JSON.stringify({sourceCommit: officialPin.commit, harness: officialPin.version, desktop: officialPin.version}));
    for (const file of ['index.js', 'client.js']) writeFileSync(join(plugin, 'lib', file), '');
    const state = join(root, 'state'); mkdirSync(join(state, 'dsh/profiles/desktop'), {recursive: true});
    const manifestPath = join(root, 'project.agent-project'); writeFileSync(manifestPath, 'original');
    const original = join(state, 'dsh/profiles/desktop/package.json'); writeFileSync(original, 'original profile bytes');
    await assert.rejects(prepareOfficialProfile({runtimeDir: '/unused', stateDirectory: state, manifestPath, pluginSource: plugin}), /requires migration/);
    assert.equal(readFileSync(original, 'utf8'), 'original profile bytes');
    assert.equal(existsSync(join(state, 'project-desktop.json')), false);
    assert.equal(existsSync(join(state, 'dsh/official-shell.json')), false);
  } finally {rmSync(root, {recursive: true, force: true})}
});
