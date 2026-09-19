import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {parse} from 'yaml';
import {GuideClones, cleanupGuideClones} from '../src/app/guide-clones.mjs';
import {createProjectFromPlan} from '../src/app/project-bootstrap.mjs';
import {loadGuideResources} from '../src/desktop-adapter/stable/guide-resources.mjs';
import {validResourceBranch} from '../src/shared/remote-resource.mjs';
import {privateGitFixture, waitUntil} from './fixtures/private-git.mjs';

test('guide clone authenticates, retries credentials and creates from the selected branch without downloading again', {timeout: 40000}, async () => {
  const f = await privateGitFixture(), lib = await loadGuideResources();
  const pool = await GuideClones.create(f.root, {runGit: f.run(lib.runResourceGit)});
  const draft = {id: 'web', name: 'Web', url: f.url, branch: 'feature/demo'};
  try {
    const started = await pool.start(draft); assert.equal(started.status, 'cloning');
    await assert.rejects(pool.install(draft, join(f.root, 'premature')), /operation-not-ready/);
    const first = await waitUntil(() => pool.auth.snapshot().requests[0], 'authentication');
    pool.authentication({path: '', method: 'POST', body: {id: first.id, credential: {...f.credential, password: 'wrong'}}});
    const retry = await waitUntil(() => pool.auth.snapshot().requests.find(item => item.id !== first.id), 'authentication retry');
    assert.equal(retry.retry, true); pool.auth.answer(retry.id, f.credential);
    await waitUntil(async () => {
      const state = (await pool.snapshot())[0];
      assert.ok(!['failed', 'pending', 'cancelled'].includes(state.status), JSON.stringify(state));
      return state.status === 'completed';
    }, 'clone completion');
    const requests = f.requests;
    const resource = {...draft, mode: 'remote', path: 'web'};
    const manifest = await createProjectFromPlan({location: f.root, name: 'Product', resources: [resource]},
      {installRemote: (...args) => pool.install(...args)});
    assert.equal(f.requests, requests);
    const target = join(f.root, 'Product/web');
    assert.equal(f.git(['branch', '--show-current'], target), 'feature/demo');
    assert.equal(readFileSync(join(target, 'branch.txt'), 'utf8'), 'Selected feature branch\n');
    assert.equal(parse(readFileSync(manifest, 'utf8')).resources[1].branch, 'feature/demo');
    assert.doesNotMatch(readFileSync(join(target, '.git/config'), 'utf8'), /guide-private-test-token|fixture-user|dsh-git-auth|credential\.helper/);
    await assert.rejects(pool.install({...draft, branch: 'main'}, join(f.root, 'mismatch')), /operation-not-ready/);
    // Leaving the branch blank uses the remote default; another resource has an independent job.
    await pool.start({...draft, id: 'other', branch: ''});
    const defaultAuth = await waitUntil(() => pool.auth.snapshot().requests[0], 'default branch authentication');
    pool.auth.answer(defaultAuth.id, f.credential);
    await waitUntil(async () => (await pool.snapshot()).find(item => item.id === 'other')?.status === 'completed', 'default branch clone');
    const copy = join(f.root, 'default-copy'); await pool.install({...draft, id: 'other', branch: ''}, copy);
    assert.equal(f.git(['branch', '--show-current'], copy), 'main');
    assert.equal(existsSync(join(copy, 'branch.txt')), false);
    // A syntactically valid missing branch fails in Git and remains unavailable to project creation.
    await pool.start({...draft, id: 'missing', branch: 'does-not-exist'});
    const missingAuth = await waitUntil(() => pool.auth.snapshot().requests[0], 'missing branch authentication');
    pool.auth.answer(missingAuth.id, f.credential);
    await waitUntil(async () => (await pool.snapshot()).find(item => item.id === 'missing')?.status === 'failed', 'missing branch failure');
    await assert.rejects(pool.install({...draft, id: 'missing', branch: 'does-not-exist'}, join(f.root, 'missing-copy')), /operation-not-ready/);
    // Closing cleans only staging; the completed project survives.
    await pool.dispose(); assert.ok(existsSync(target));
    assert.deepEqual(readdirSync(join(f.root, 'creation-drafts')), []);
  } finally {await pool.dispose(); await f.close()}
});

test('guide authentication cancellation, clone retry and window close release pending prompts and staging', {timeout: 40000}, async () => {
  const f = await privateGitFixture(), lib = await loadGuideResources();
  const pool = await GuideClones.create(f.root, {runGit: f.run(lib.runResourceGit)});
  const draft = {id: 'web', name: 'Web', url: f.url};
  try {
    await pool.start(draft);
    const request = await waitUntil(() => pool.auth.snapshot().requests[0], 'authentication');
    pool.auth.answer(request.id, null);
    await waitUntil(async () => (await pool.snapshot())[0].status === 'cancelled', 'cancellation');
    await pool.start(draft);
    await waitUntil(() => pool.auth.snapshot().requests[0], 'retry authentication');
    await pool.cancel(draft.id);
    assert.equal(pool.auth.snapshot().requests.length, 0);
    await pool.start(draft);
    const last = await waitUntil(() => pool.auth.snapshot().requests[0], 'closing authentication');
    await pool.dispose();
    assert.throws(() => pool.auth.answer(last.id, f.credential), /git-auth-expired/);
    assert.deepEqual(readdirSync(join(f.root, 'creation-drafts')), []);
    await cleanupGuideClones(f.root);
    assert.ok(existsSync(join(f.root, 'private.git')));
  } finally {await pool.dispose(); await f.close()}
});

test('guide rejects invalid input before allocating a clone; branch validation agrees with Git', async () => {
  const f = await privateGitFixture(), pool = await GuideClones.create(f.root);
  try {
    for (const url of ['', 'file:///tmp/repo', 'https://user:token@example.com/repo', 'http://example.com/repo', '--upload-pack=bad']) {
      await assert.rejects(pool.start({id: 'web', name: 'Web', url}), /resource-url-invalid/);
    }
    for (const branch of ['HEAD', '../bad', '-main', 'a//b', 'a.lock', 'a b', 'a~1', 'a..b', 'a@{b', '.hidden', 'a\\b']) {
      assert.equal(validResourceBranch(branch), false, branch);
      assert.throws(() => f.git(['check-ref-format', '--branch', branch]));
      await assert.rejects(pool.start({id: 'web', name: 'Web', url: f.url, branch}), /resource-branch-invalid/);
    }
    for (const branch of ['main', 'feature/demo', '发布/v1', 'release-1.2']) {
      assert.equal(validResourceBranch(branch), true); assert.equal(f.git(['check-ref-format', '--branch', branch]), branch);
    }
    assert.equal(existsSync(join(f.root, 'creation-drafts')), false);
  } finally {await pool.dispose(); await f.close()}
});
