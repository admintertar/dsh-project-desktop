import test from 'node:test';
import assert from 'node:assert/strict';
import {promoteRelease} from '../scripts/publish-release.mjs';

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
