import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateFixture} from '../scripts/update-fixtures.mjs';
import {createProjectReleaseFeed, parseProjectRelease} from '../src/desktop-adapter/stable/project-release-feed.mjs';
import {loadDesktop} from '../src/desktop-adapter/stable/modules.mjs';

const {DESKTOP_VERSION_ENDPOINT, checkForDesktopUpdate} = await loadDesktop('update-checker');
const {downloadDesktopUpdate} = await loadDesktop('update-download');
const {startDesktopUpdateLifecycle} = await loadDesktop('update-lifecycle');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function feedFor(fixture, {corrupt = false} = {}) {
  const requests = [];
  const feed = createProjectReleaseFeed({platform: fixture.release.assets[0].name.endsWith('.dmg') ? 'darwin' : 'win32', request: async (url, init) => {
    requests.push({url, init});
    if (url.startsWith('https://api.github.com/')) return Response.json(fixture.release, {headers: {ETag: '"fixture"'}});
    if (url.endsWith('.sha256')) return new Response(fixture.checksum);
    return new Response(corrupt ? Buffer.alloc(512) : fixture.body);
  }});
  return {feed, requests};
}
test('only a complete stable release with fixed repository assets is accepted', () => {
  const {release} = updateFixture();
  assert.equal(parseProjectRelease(release, 'darwin').version, '0.1.1');
  for (const change of [{draft: true}, {prerelease: true}, {tag_name: 'v0.1.1-beta.1'}, {assets: []},
    {html_url: 'https://example.com'}, {assets: [...release.assets, release.assets[0]]},
    {assets: release.assets.map(asset => ({...asset, browser_download_url: 'https://example.com/installer'}))}]) {
    assert.throws(() => parseProjectRelease({...release, ...change}, 'darwin'));
  }
  assert.throws(() => parseProjectRelease(release, 'linux'));
});
test('official comparison uses Shell version and sends no upstream headers or installation identifiers to GitHub', async () => {
  const {feed, requests} = feedFor(updateFixture());
  const result = await checkForDesktopUpdate({currentVersion: '0.1.0', channel: 'stable', request: feed.versionRequest});
  assert.equal(result.status, 'update-available');
  assert.ok(requests.every(({url}) => url.startsWith('https://api.github.com/repos/admintertar/dsh-project-desktop/')));
  assert.deepEqual(requests[0].init.headers, {Accept: 'application/vnd.github+json'});
  assert.equal((await checkForDesktopUpdate({currentVersion: '0.1.1', channel: 'stable', request: feed.versionRequest})).status, 'up-to-date');
  assert.equal((await checkForDesktopUpdate({currentVersion: '0.2.0', channel: 'stable', request: feed.versionRequest})).status, 'up-to-date');
});
test('conditional requests use the previously validated release, never an empty 304', async () => {
  let calls = 0;
  const feed = createProjectReleaseFeed({platform: 'darwin', request: async (_url, init) => {
    if (++calls === 1) return Response.json(updateFixture().release, {headers: {ETag: '"v1"'}});
    assert.equal(init.headers['If-None-Match'], '"v1"'); return new Response(null, {status: 304});
  }});
  for (let i = 0; i < 2; i++) assert.equal((await (await feed.versionRequest(DESKTOP_VERSION_ENDPOINT, {})).json()).version, '0.1.1');
});
test('the official downloader writes a verified DMG/EXE and rejects corrupt data before replacing an existing file', async () => {
  for (const platform of ['darwin', 'win32']) {
    const fixture = updateFixture('0.1.1', platform), root = mkdtempSync(join(tmpdir(), 'project-update-'));
    const path = join(root, fixture.name);
    const {feed} = feedFor(fixture);
    await downloadDesktopUpdate({platform, version: '0.1.1', destinationPath: path, request: feed.downloadRequest});
    assert.deepEqual(readFileSync(path), fixture.body);
    writeFileSync(path, 'keep previous download');
    const corrupt = feedFor(fixture, {corrupt: true}).feed;
    await assert.rejects(downloadDesktopUpdate({platform, version: '0.1.1', destinationPath: path, request: corrupt.downloadRequest}));
    assert.equal(readFileSync(path, 'utf8'), 'keep previous download');
    assert.deepEqual(readdirSync(root), [fixture.name]);
  }
});
test('official lifecycle coalesces manual checks and persists one background notification per version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-update-state-'));
  let requests = 0, prompts = 0, notifications = 0;
  const options = {policy: {enabled: false, initialDelayMs: 0, intervalMs: 15, requestTimeoutMs: 2000}, locale: () => 'en',
    registerTrayItem: () => ({refresh() {}, dispose() {}}), adapter: {
      isPackaged: true, canDownload: true, currentVersion: '0.1.0', releaseChannel: 'stable', statePath: join(root, 'state.json'),
      request: async () => {requests++; await pause(20); return Response.json({version: '0.1.1', channel: 'stable'})},
      confirmDownload: async () => {prompts++; return false}, showManualCheckResult() {}, downloadAndOpen() {throw new Error('Not confirmed')}, notify() {notifications++},
    }};
  let lifecycle = startDesktopUpdateLifecycle(options);
  await Promise.all([lifecycle.checkNow(), lifecycle.checkNow()]);
  assert.equal(requests, 1); assert.equal(prompts, 1); await lifecycle.dispose();
  for (let round = 0; round < 2; round++) {
    lifecycle = startDesktopUpdateLifecycle({...options, policy: {...options.policy, enabled: true}});
    await pause(120); await lifecycle.dispose();
  }
  assert.equal(notifications, 1);
});
