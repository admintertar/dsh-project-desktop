import test from 'node:test';
import assert from 'node:assert/strict';
import {promoteRelease} from '../scripts/publish-release.mjs';
import {createUpdateManifest, parseUpdateManifest, latestUpdateManifestUrl, versionUpdateManifestUrl} from '../src/app/update-manifest.mjs';
import {verifyPublishedUpdate} from '../scripts/verify-update-feed.mjs';
import {updateFixture} from '../scripts/update-fixtures.mjs';

test('the published manifest contains only verified package identities, sizes, hashes and the exact source commit', () => {
  const fixture = updateFixture();
  const assets = fixture.assets.map(asset => ({...asset, path: '/private/build/' + asset.name}));
  assets.push({name: 'package.sha256', path: '/private/checksum'});
  const manifest = createUpdateManifest(assets, '0.1.1', 'b'.repeat(40));
  assert.equal(manifest.sourceCommit, 'b'.repeat(40)); assert.equal(manifest.assets.length, 3);
  assert.equal(JSON.stringify(manifest).includes('/private/'), false);
  assert.deepEqual(parseUpdateManifest(manifest), manifest);
  assert.throws(() => createUpdateManifest(assets.slice(1), '0.1.1', 'b'.repeat(40)), /missing/);
  assert.throws(() => createUpdateManifest(assets, '0.1.2', 'b'.repeat(40)), /missing/);
});
test('post-publication verification uses anonymous file downloads and rejects a stale same-version manifest', async () => {
  const fixture = updateFixture(), requests = [];
  let manifest = fixture.release;
  const request = async (url, init) => {
    requests.push(url);
    assert.equal(new URL(url).hostname, 'github.com');
    assert.equal(new Headers(init.headers).has('Authorization'), false);
    assert.equal(init.redirect, 'follow');
    if (url.endsWith('/update.json')) return Response.json(manifest);
    const asset = manifest.assets.find(asset => url === asset.url + '.sha256'); assert.ok(asset);
    return new Response(`${asset.sha256}  ${asset.name}\n`);
  };
  const options = {version: '0.1.1', commit: 'a'.repeat(40), assets: fixture.assets, request};
  assert.equal((await verifyPublishedUpdate(options)).ok, true);
  assert.deepEqual(requests.slice(0, 2), [versionUpdateManifestUrl('0.1.1'), latestUpdateManifestUrl]);
  manifest = {...manifest, sourceCommit: 'b'.repeat(40)};
  await assert.rejects(verifyPublishedUpdate(options), /differs from the verified release/);
});

function server({failPublish = false, lostResponse = false} = {}) {
  const releases = new Map([[1, {id: 1, draft: false, tag_name: 'v0.1.0'}], [2, {id: 2, draft: true, tag_name: 'candidate'}]]);
  let commit = 'old'; const operations = [];
  return {releases, operations, get commit() {return commit}, async api(path, method = 'GET', body) {
    operations.push({path, method, body});
    if (path.startsWith('/git/refs')) {commit = body.sha; return {}}
    const release = releases.get(Number(path.split('/').at(-1))); assert.ok(release);
    if (method === 'PATCH') {
      if (release.id === 2 && !body.draft && failPublish) throw new Error('Publish failed');
      Object.assign(release, body);
      if (release.id === 2 && !body.draft && lostResponse) throw new Error('Response lost');
    }
    return {...release};
  }};
}
const args = {candidate: {id: 2}, existing: {id: 1}, tag: 'v0.1.0', commit: 'new', previousCommit: 'old'};
test('same-version republish preserves the old release privately and promotes the fully uploaded candidate', async () => {
  const state = server(); await promoteRelease({...args, api: state.api});
  assert.equal(state.commit, 'new'); assert.equal(state.releases.get(1).draft, true);
  assert.equal(state.releases.get(2).tag_name, 'v0.1.0'); assert.equal(state.releases.get(2).draft, false);
});
test('a failed publication restores the old public release and version tag', async () => {
  const state = server({failPublish: true});
  await assert.rejects(promoteRelease({...args, api: state.api}), /Publish failed/);
  assert.equal(state.commit, 'old'); assert.equal(state.releases.get(1).draft, false);
  assert.equal(state.releases.get(1).tag_name, 'v0.1.0'); assert.equal(state.releases.get(2).draft, true);
});
test('a lost publication response does not roll back a successfully published release', async () => {
  const state = server({lostResponse: true}); await promoteRelease({...args, api: state.api});
  assert.equal(state.commit, 'new'); assert.equal(state.releases.get(2).draft, false);
});
test('an annotated version tag already targeting this commit is preserved', async () => {
  const state = server(); await promoteRelease({...args, existing: undefined, api: state.api, tagAlreadyTargetsCommit: true});
  assert.ok(state.operations.every(operation => !operation.path.startsWith('/git/refs')));
});
