import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateFixture} from '../scripts/update-fixtures.mjs';
import {createProjectReleaseFeed, parseProjectRelease} from '../src/desktop-adapter/stable/project-release-feed.mjs';
import {createUpdateProgress} from '../src/desktop-adapter/stable/project-updates.mjs';
import {loadDesktop} from '../src/desktop-adapter/stable/modules.mjs';
import {latestUpdateManifestUrl, versionUpdateManifestUrl} from '../src/app/update-manifest.mjs';

const {DESKTOP_VERSION_ENDPOINT, checkForDesktopUpdate} = await loadDesktop('update-checker');
const {downloadDesktopUpdate} = await loadDesktop('update-download');
const {startDesktopUpdateLifecycle} = await loadDesktop('update-lifecycle');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function feedFor(fixture, {corrupt = false} = {}) {
  const requests = [];
  const feed = createProjectReleaseFeed({platform: fixture.platform, request: async (url, init) => {
    requests.push({url, init});
    assert.equal(new URL(url).hostname, 'github.com', 'The app must not call the REST API');
    if ([latestUpdateManifestUrl, versionUpdateManifestUrl(fixture.release.version)].includes(url)) return Response.json(fixture.release, {headers: {ETag: '"fixture"'}});
    assert.equal(url, fixture.release.assets.find(asset => asset.name === fixture.name).url);
    return new Response(corrupt ? Buffer.alloc(512) : fixture.body);
  }});
  return {feed, requests};
}
test('only a complete stable release with fixed repository assets is accepted', () => {
  const {release} = updateFixture();
  assert.equal(parseProjectRelease(release, 'darwin').version, '0.1.1');
  for (const change of [{schemaVersion: 2}, {channel: 'beta'}, {version: '0.1.1-beta.1'}, {assets: []}, {version: '01.1.1'},
    {releaseUrl: 'https://example.com'}, {sourceCommit: 'master'}, {assets: [...release.assets, release.assets[0]]},
    {assets: release.assets.map(asset => ({...asset, url: 'https://example.com/installer'}))},
    {assets: release.assets.map(asset => ({...asset, sha256: ''}))}, {assets: release.assets.map(asset => ({...asset, size: 0}))},
    {assets: release.assets.map(asset => ({...asset, size: 1024 ** 3 + 1}))}]) {
    assert.throws(() => parseProjectRelease({...release, ...change}, 'darwin'));
  }
  assert.throws(() => parseProjectRelease(release, 'linux'));
});
test('official comparison uses Shell version and sends no upstream headers or installation identifiers to GitHub', async () => {
  const {feed, requests} = feedFor(updateFixture());
  const result = await checkForDesktopUpdate({currentVersion: '0.1.0', channel: 'stable', request: feed.versionRequest});
  assert.equal(result.status, 'update-available');
  assert.ok(requests.every(({url}) => url === latestUpdateManifestUrl));
  assert.deepEqual(requests[0].init.headers, {Accept: 'application/json'});
  assert.equal(requests[0].init.redirect, 'follow');
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
  const empty = createProjectReleaseFeed({platform: 'darwin', request: async () => new Response(null, {status: 304})});
  await assert.rejects(empty.versionRequest(DESKTOP_VERSION_ENDPOINT, {}));
});
test('failed checks preserve a safe reason, reject invalid/oversized metadata and clear the reason after success', async () => {
  let request;
  const feed = createProjectReleaseFeed({platform: 'darwin', request: (...args) => request(...args)});
  for (const [response, reason] of [[new Response('', {status: 403}), {kind: 'http', status: 403}],
    [new Response('', {status: 429}), {kind: 'http', status: 429}], [new Response('{'), {kind: 'invalid', status: undefined}],
    [new Response(' '.repeat(16 * 1024 + 1)), {kind: 'invalid', status: undefined}]]) {
    request = async () => response;
    assert.equal(await checkForDesktopUpdate({currentVersion: '0.1.1', channel: 'stable', request: feed.versionRequest}), null);
    assert.deepEqual(feed.lastFailure, reason);
  }
  request = async () => {throw new Error('Network error with private data')};
  await assert.rejects(feed.versionRequest(DESKTOP_VERSION_ENDPOINT, {}));
  assert.deepEqual(feed.lastFailure, {kind: 'network', status: undefined});
  await assert.rejects(feed.versionRequest(DESKTOP_VERSION_ENDPOINT, {signal: AbortSignal.abort()}));
  assert.equal(feed.lastFailure.kind, 'timeout');
  request = async () => Response.json(updateFixture().release);
  await feed.versionRequest(DESKTOP_VERSION_ENDPOINT, {});
  assert.equal(feed.lastFailure, undefined);
});
test('the official downloader writes a verified DMG/EXE and rejects corrupt data before replacing an existing file', async () => {
  for (const platform of ['darwin', 'win32']) {
    const fixture = updateFixture('0.1.1', platform), root = mkdtempSync(join(tmpdir(), 'project-update-'));
    const path = join(root, fixture.name);
    const {feed, requests} = feedFor(fixture);
    await downloadDesktopUpdate({platform, version: '0.1.1', destinationPath: path, request: feed.downloadRequest});
    assert.deepEqual(readFileSync(path), fixture.body);
    assert.equal(requests[0].url, versionUpdateManifestUrl('0.1.1'));
    assert.equal(requests.length, 2, 'Only the exact-version manifest and installer are downloaded');
    writeFileSync(path, 'keep previous download');
    const corrupt = feedFor(fixture, {corrupt: true}).feed;
    await assert.rejects(downloadDesktopUpdate({platform, version: '0.1.1', destinationPath: path, request: corrupt.downloadRequest}));
    assert.equal(readFileSync(path, 'utf8'), 'keep previous download');
    assert.deepEqual(readdirSync(root), [fixture.name]);
  }
});
test('a tag manifest cannot silently switch the confirmed download to another version', async () => {
  const feed = createProjectReleaseFeed({platform: 'darwin', request: async () => Response.json(updateFixture('0.1.2').release)});
  const root = mkdtempSync(join(tmpdir(), 'project-update-tag-'));
  const path = join(root, 'existing.dmg'); writeFileSync(path, 'keep');
  await assert.rejects(downloadDesktopUpdate({platform: 'darwin', version: '0.1.1', destinationPath: path, request: feed.downloadRequest}));
  assert.equal(readFileSync(path, 'utf8'), 'keep');
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
test('the verified download stream reports monotonic progress against the declared total', async () => {
  const fixture = updateFixture();
  const reported = [];
  const chunked = body => new ReadableStream({start(controller) {
    for (let offset = 0; offset < body.length; offset += 128) controller.enqueue(body.subarray(offset, offset + 128));
    controller.close();
  }});
  const feed = createProjectReleaseFeed({platform: 'darwin', onProgress: update => reported.push(update),
    request: async url => [latestUpdateManifestUrl, versionUpdateManifestUrl(fixture.release.version)].includes(url)
      ? Response.json(fixture.release) : new Response(chunked(fixture.body))});
  const root = mkdtempSync(join(tmpdir(), 'project-update-progress-'));
  await downloadDesktopUpdate({platform: 'darwin', version: fixture.release.version, destinationPath: join(root, fixture.name), request: feed.downloadRequest});
  assert.equal(reported[0].received, 0);
  assert.ok(reported.length > 2, 'A chunked download reports more than one sample');
  assert.ok(reported.every(update => update.version === fixture.release.version && update.total === fixture.body.length));
  assert.ok(reported.every((update, index) => index === 0 || update.received >= reported[index - 1].received));
  assert.equal(reported.at(-1).received, fixture.body.length);
});
test('Shell download progress throttles refreshes, keeps the last sample and clears on completion', () => {
  let at = 1000, refreshes = 0;
  const progress = createUpdateProgress({intervalMs: 500, now: () => at, changed: () => {refreshes++}});
  assert.equal(progress.downloading, false); assert.equal(progress.snapshot, undefined);
  progress.begin('0.1.2');
  assert.equal(progress.downloading, true); assert.equal(refreshes, 1);
  progress.report({version: '0.1.2', received: 0, total: 400});
  assert.deepEqual(progress.snapshot, {version: '0.1.2', received: 0, total: 400, percent: 0});
  at += 100; progress.report({version: '0.1.2', received: 100, total: 400});
  assert.equal(progress.snapshot.percent, 0, 'A sample inside the throttle window is dropped');
  assert.equal(refreshes, 2);
  at += 500; progress.report({version: '0.1.2', received: 100, total: 400});
  assert.equal(progress.snapshot.percent, 25); assert.equal(refreshes, 3);
  at += 500; progress.report({version: '0.1.2', received: 100, total: 400});
  assert.equal(refreshes, 3, 'An unchanged percentage never refreshes');
  at += 500; progress.report({version: '0.1.2', received: 200, total: 400});
  assert.equal(progress.snapshot.percent, 50); assert.equal(refreshes, 4);
  progress.report({version: '0.1.2', received: 400, total: 400});
  assert.equal(progress.snapshot.percent, 100); assert.equal(refreshes, 5, 'Completion always refreshes');
  progress.end();
  assert.equal(progress.downloading, false); assert.equal(progress.snapshot, undefined); assert.equal(refreshes, 6);
  progress.end();
  assert.equal(refreshes, 6, 'A second end is a no-op');
});
