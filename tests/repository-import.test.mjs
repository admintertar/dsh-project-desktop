import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {classifyProjectTarget} from '../src/app/project-files.mjs';
import {RepositoryImports} from '../src/app/repository-import.mjs';
import {GuideClones} from '../src/app/guide-clones.mjs';
import {loadGuideResources} from '../src/desktop-adapter/stable/guide-resources.mjs';
import {repositoryFolderName, validRepositoryName} from '../src/shared/remote-resource.mjs';
import {privateGitFixture, waitUntil} from './fixtures/private-git.mjs';

const manifestBody = 'schemaVersion: 1\nid: product-1\nname: Product\nresources:\n  - id: root\n    name: Product\n    type: local\n    path: .\nmemory: []\n';

test('a picked folder is classified before the pinned plugin speaks', async () => {
  const f = await privateGitFixture();
  try {
    const folder = join(f.root, 'Folder'); mkdirSync(folder);
    assert.equal(classifyProjectTarget(folder), 'none');
    assert.equal(classifyProjectTarget(join(f.root, 'missing')), 'missing');
    assert.equal(classifyProjectTarget(join(f.root, 'seed', 'README.md')), 'invalid');
    writeFileSync(join(folder, 'One.agent-project'), manifestBody);
    assert.equal(classifyProjectTarget(folder), 'file');
    assert.equal(classifyProjectTarget(join(folder, 'One.agent-project')), 'file');
    writeFileSync(join(folder, 'Two.agent-project'), manifestBody);
    assert.equal(classifyProjectTarget(folder), 'multiple');
  } finally {await f.close()}
});

test('a repository URL prefills one safe folder name, matching git clone', () => {
  assert.equal(repositoryFolderName('https://github.com/org/repository.git'), 'repository');
  assert.equal(repositoryFolderName('https://github.com/org/repository/'), 'repository');
  assert.equal(repositoryFolderName('ssh://git@example.com/team/app.git'), 'app');
  assert.equal(repositoryFolderName('git@github.com:org/repository.git'), 'repository');
  assert.equal(repositoryFolderName(''), '');
  for (const value of ['', '.', '..', '.git', 'a/b', 'a\\b', 'product.agent-project', 'x'.repeat(161)]) {
    assert.equal(validRepositoryName(value), false, JSON.stringify(value));
  }
  for (const value of ['repository', 'My App', '发布-1.0', 'x'.repeat(160)]) assert.equal(validRepositoryName(value), true, value);
});

test('repository import authenticates, clones into a new folder and rolls back a non-project checkout', {timeout: 60000}, async () => {
  const f = await privateGitFixture(), lib = await loadGuideResources();
  const pool = await GuideClones.create(f.root, {runGit: f.run(lib.runResourceGit)});
  const imports = new RepositoryImports(pool);
  // Publish an agent-project entry on main; feature/demo stays a checkout without one.
  writeFileSync(join(f.root, 'seed', 'Product.agent-project'), manifestBody);
  f.git(['add', '.']);
  f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'project']);
  f.git(['push', '--quiet', join(f.root, 'private.git'), 'main']);
  f.git(['update-server-info'], join(f.root, 'private.git'));
  const authenticate = async () => {
    const request = await waitUntil(() => pool.auth.snapshot().requests[0], 'authentication');
    pool.auth.answer(request.id, f.credential);
  };
  try {
    for (const [value, code] of [
      [{url: 'file:///tmp/repository', branch: '', directory: f.root, name: 'X'}, /resource-url-invalid/],
      [{url: f.url, branch: 'bad branch', directory: f.root, name: 'X'}, /resource-branch-invalid/],
      [{url: f.url, branch: '', directory: f.root, name: 'a/b'}, /repository-name-invalid/],
      [{url: f.url, branch: '', directory: join(f.root, 'missing'), name: 'X'}, /repository-directory-invalid/],
    ]) await assert.rejects(imports.start(value), code);
    mkdirSync(join(f.root, 'Taken'));
    await assert.rejects(imports.start({url: f.url, branch: 'main', directory: f.root, name: 'Taken'}), /repository-target-exists/);

    const success = await imports.start({url: f.url, branch: 'main', directory: f.root, name: 'Imported'});
    await authenticate();
    await waitUntil(async () => (await pool.snapshot()).find(item => item.id === success.id)?.status === 'completed', 'clone completion');
    assert.equal(await imports.finish(success.id), join(f.root, 'Imported', 'Product.agent-project'));
    assert.equal(existsSync(join(f.root, 'Imported', 'README.md')), true);
    assert.deepEqual(readdirSync(join(f.root, 'creation-drafts')), []);

    // A finished job can only be completed once; without an entry file the checkout is removed.
    await assert.rejects(imports.finish(success.id), /operation-not-ready/);
    const failure = await imports.start({url: f.url, branch: 'feature/demo', directory: f.root, name: 'NotAProject'});
    await authenticate();
    await waitUntil(async () => (await pool.snapshot()).find(item => item.id === failure.id)?.status === 'completed', 'second clone completion');
    await assert.rejects(imports.finish(failure.id), /repository-not-project/);
    assert.equal(existsSync(join(f.root, 'NotAProject')), false);

    const cancelled = await imports.start({url: f.url, branch: 'main', directory: f.root, name: 'Cancelled'});
    await imports.cancel(cancelled.id);
    assert.equal(existsSync(join(f.root, 'Cancelled')), false);
    assert.deepEqual(readdirSync(join(f.root, 'creation-drafts')), []);
  } finally {await pool.dispose(); await f.close()}
});
