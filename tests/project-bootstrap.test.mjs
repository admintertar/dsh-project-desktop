import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, join} from 'node:path';
import {parse} from 'yaml';
import {createProjectFromPlan} from '../src/app/project-bootstrap.mjs';

function git(args, cwd) {
  return execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
}

/** Simulate a network clone while keeping all repository assertions on the real Git CLI. */
function cloneFixtureGit(args, cwd) {
  const cloneIndex = args.indexOf('clone');
  if (cloneIndex >= 0) {
    const url = args.at(-2);
    const target = args.at(-1);
    mkdirSync(target);
    git(['init', '--quiet'], target);
    git(['remote', 'add', 'origin', url], target);
    return '';
  }
  return git(args, cwd);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'project-bootstrap-'));
  return {root, cleanup: () => rmSync(root, {recursive: true, force: true})};
}

test('creates a root repository and independent empty resource repositories', async () => {
  const f = fixture();
  try {
    const manifest = await createProjectFromPlan({location: f.root, name: 'test', templateId: 'fullstack'});
    const projectRoot = join(f.root, 'test');
    const data = parse(readFileSync(manifest, 'utf8'));
    assert.equal(manifest, join(realpathSync(projectRoot), 'test.agent-project'));
    assert.equal(basename(projectRoot), 'test');
    assert.ok(existsSync(join(projectRoot, '.git')));
    assert.ok(existsSync(join(projectRoot, 'AGENT.md')));
    assert.ok(existsSync(join(projectRoot, '.agent-project/.gitignore')));
    assert.equal(existsSync(join(projectRoot, 'memory')), false);
    assert.match(git(['ls-files', '--others', '--exclude-standard'], projectRoot), /^\.agent-project\/\.gitignore$/m);
    assert.ok(existsSync(join(projectRoot, 'resources/test-backend', '.git')));
    assert.ok(existsSync(join(projectRoot, 'resources/test-backend', 'AGENT.md')));
    assert.ok(existsSync(join(projectRoot, 'resources/test-web', '.git')));
    assert.ok(existsSync(join(projectRoot, 'resources/test-web', 'AGENT.md')));
    assert.equal(existsSync(join(projectRoot, 'test-backend')), false);
    assert.equal(existsSync(join(projectRoot, 'test-web')), false);
    assert.match(readFileSync(join(projectRoot, '.gitignore'), 'utf8'), /^\/resources\/test-backend\/$/m);
    assert.match(readFileSync(join(projectRoot, '.gitignore'), 'utf8'), /^\/resources\/test-web\/$/m);
    assert.deepEqual(data.resources.map(item => [item.id, item.path]), [
      ['root', '.'], ['backend', 'resources/test-backend'], ['web', 'resources/test-web'],
    ]);
  } finally { f.cleanup(); }
});

test('creates missing parent directories through an existing directory alias', async () => {
  const f = fixture();
  try {
    const existing = join(f.root, 'Documents'); mkdirSync(existing);
    writeFileSync(join(existing, 'keep.txt'), 'keep');
    const alias = join(f.root, 'Documents alias'); symlinkSync(existing, alias, 'dir');
    const location = join(alias, 'AgentIDE', 'Nested projects');
    const manifest = await createProjectFromPlan({location, name: 'demo', templateId: 'empty'});
    const root = join(realpathSync(existing), 'AgentIDE', 'Nested projects', 'demo');
    assert.equal(manifest, join(root, 'demo.agent-project'));
    assert.equal(realpathSync.native(git(['rev-parse', '--show-toplevel'], root)), realpathSync.native(root));
    assert.equal(readFileSync(join(existing, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(await createProjectFromPlan({location, name: 'demo'}), manifest);
  } finally {f.cleanup()}
});

test('invalid plans and file or dangling-link locations do not create parent directories', async () => {
  const f = fixture();
  try {
    const location = join(f.root, 'AgentIDE', 'nested');
    await assert.rejects(createProjectFromPlan({location, name: 'invalid', resources: [
      {id: 'web', name: 'Web', mode: 'empty', path: '../outside'},
    ]}), /outside/);
    assert.equal(existsSync(join(f.root, 'AgentIDE')), false);
    const occupied = join(f.root, 'occupied'); writeFileSync(occupied, 'keep');
    for (const path of [occupied, join(occupied, 'nested')]) {
      await assert.rejects(createProjectFromPlan({location: path, name: 'demo'}), /directory|ENOTDIR/);
    }
    assert.equal(readFileSync(occupied, 'utf8'), 'keep');
    const absent = join(f.root, 'absent');
    const dangling = join(f.root, 'dangling'); symlinkSync(absent, dangling, 'dir');
    await assert.rejects(createProjectFromPlan({location: join(dangling, 'nested'), name: 'demo'}));
    assert.equal(existsSync(absent), false);
  } finally {f.cleanup()}
});

test('failed creation removes its project root and preserves the newly created shared location', async () => {
  const f = fixture();
  try {
    const location = join(f.root, 'AgentIDE', 'nested');
    const shared = join(location, 'other.txt');
    await assert.rejects(createProjectFromPlan({location, name: 'failed'}, {runGit: async () => {
      writeFileSync(shared, 'concurrent work');
      throw new Error('Fixture Git failure');
    }}), /Fixture Git failure/);
    assert.equal(existsSync(join(location, 'failed')), false);
    assert.deepEqual(readdirSync(location), ['other.txt']);
    assert.equal(readFileSync(shared, 'utf8'), 'concurrent work');
    const manifest = await createProjectFromPlan({location, name: 'retry'});
    assert.equal(existsSync(manifest), true);
  } finally {f.cleanup()}
});

test('admin and desktop compositions create their intended independent resource repositories', async () => {
  const f = fixture();
  try {
    for (const [templateId, roles] of [['admin', ['backend', 'admin']], ['desktop', ['desktop']]]) {
      const manifest = await createProjectFromPlan({location: f.root, name: templateId, templateId});
      const data = parse(readFileSync(manifest, 'utf8'));
      assert.deepEqual(data.resources.map(item => [item.id, item.path]), [
        ['root', '.'], ...roles.map(role => [role, `resources/${templateId}-${role}`]),
      ]);
      for (const role of roles) {
        const resourceRoot = join(f.root, templateId, 'resources', `${templateId}-${role}`);
        assert.equal(realpathSync.native(git(['rev-parse', '--show-toplevel'], resourceRoot)), realpathSync.native(resourceRoot));
        assert.match(readFileSync(join(resourceRoot, 'AGENT.md'), 'utf8'), new RegExp(`Resource role: ${role}\\.`));
      }
      if (templateId === 'desktop') assert.equal(existsSync(join(f.root, templateId, 'resources/desktop-backend')), false);
    }
  } finally {f.cleanup()}
});

test('omitted resource paths default under resources while explicit destinations stay unchanged', async () => {
  const f = fixture();
  try {
    const manifest = await createProjectFromPlan({location: f.root, name: 'defaults', resources: [
      {id: 'web', name: 'Web UI', mode: 'empty'},
      {id: 'custom', name: 'Custom', mode: 'empty', path: 'packages/custom'},
    ]});
    const root = join(f.root, 'defaults');
    assert.deepEqual(parse(readFileSync(manifest, 'utf8')).resources.map(item => item.path),
      ['.', 'resources/Web UI', 'packages/custom']);
    for (const path of ['resources/Web UI', 'packages/custom']) {
      const target = join(root, path);
      assert.equal(realpathSync.native(git(['rev-parse', '--show-toplevel'], target)), realpathSync.native(target));
      assert.equal(git(['check-ignore', path], root), path);
    }
    assert.equal(existsSync(join(root, 'Web UI')), false);
  } finally {f.cleanup()}
});

test('links an existing external Git repository without modifying it', async () => {
  const f = fixture();
  try {
    const external = join(f.root, 'external');
    mkdirSync(external);
    writeFileSync(join(external, 'AGENT.md'), '# Existing instructions\n');
    writeFileSync(join(external, 'keep.txt'), 'keep');
    git(['init', '--quiet'], external);
    const beforeAgent = readFileSync(join(external, 'AGENT.md'), 'utf8');
    const manifest = await createProjectFromPlan({location: f.root, name: 'linked', templateId: 'empty', resources: [
      {id: 'backend', name: 'Backend', mode: 'link', path: external},
    ]});
    const projectRoot = join(f.root, 'linked');
    const data = parse(readFileSync(manifest, 'utf8'));
    const local = parse(readFileSync(join(projectRoot, '.agent-project', 'local.yaml'), 'utf8'));
    const linked = data.resources.find(item => item.name === 'Backend');
    assert.equal(linked?.type, 'git');
    assert.equal(linked?.path, undefined);
    assert.equal(local.resources[linked.id], realpathSync(external));
    assert.equal(git(['check-ignore', '.agent-project/local.yaml'], projectRoot), '.agent-project/local.yaml');
    assert.match(git(['ls-files', '--others', '--exclude-standard'], projectRoot), /^\.agent-project\/\.gitignore$/m);
    assert.equal(readFileSync(join(external, 'AGENT.md'), 'utf8'), beforeAgent);
    assert.equal(existsSync(join(external, 'linked.agent-project')), false);
  } finally { f.cleanup(); }
});

test('clones a remote resource without adding project instructions to it', async () => {
  const f = fixture();
  try {
    const url = 'https://github.com/example/web.git';
    const manifest = await createProjectFromPlan({location: f.root, name: 'remote', templateId: 'empty', resources: [
      {id: 'web', name: 'Remote Web', role: 'web', mode: 'remote', url, path: 'remote-web'},
    ], runGit: cloneFixtureGit});
    const projectRoot = join(f.root, 'remote');
    const target = join(projectRoot, 'remote-web');
    const data = parse(readFileSync(manifest, 'utf8'));
    const resource = data.resources.find(item => item.id === 'web');
    assert.ok(existsSync(join(target, '.git')));
    assert.equal(existsSync(join(target, 'AGENT.md')), false);
    assert.deepEqual(resource, {id: 'web', name: 'Remote Web', type: 'git', path: 'remote-web', url});
    assert.match(readFileSync(join(projectRoot, '.gitignore'), 'utf8'), /\/remote-web\//);
  } finally { f.cleanup(); }
});

test('rejects unsafe remote resource URLs before creating a project', async () => {
  const f = fixture();
  try {
    await assert.rejects(createProjectFromPlan({location: f.root, name: 'unsafe', templateId: 'empty', resources: [
      {id: 'web', name: 'Unsafe Web', role: 'web', mode: 'remote', url: 'file:///tmp/repository', path: 'web'},
    ], runGit: cloneFixtureGit}), /URL is invalid/);
    assert.equal(existsSync(join(f.root, 'unsafe')), false);
  } finally { f.cleanup(); }
});

test('resource import preserves the chosen local type, Git origin and display name without changing the directory', async () => {
  const f = fixture();
  try {
    const external = join(f.root, 'existing'); mkdirSync(external);
    git(['init', '--quiet'], external);
    const url = 'https://example.com/team/library.git'; git(['remote', 'add', 'origin', url], external);
    writeFileSync(join(external, 'keep.txt'), 'unchanged');
    const before = readFileSync(join(external, '.git/config'), 'utf8');
    for (const type of ['local', 'git']) {
      const manifest = await createProjectFromPlan({location: f.root, name: type, resources: [
        {id: 'library', name: 'Shared / library', role: 'resource', mode: 'link', path: external, type, url},
      ]});
      const item = parse(readFileSync(manifest, 'utf8')).resources[1];
      assert.equal(item.name, 'Shared / library'); assert.equal(item.type, type);
      assert.equal(item.url, type === 'git' ? url : undefined);
      assert.equal(readFileSync(join(external, '.git/config'), 'utf8'), before);
      assert.equal(readFileSync(join(external, 'keep.txt'), 'utf8'), 'unchanged');
    }
    await assert.rejects(createProjectFromPlan({location: f.root, name: 'stale', resources: [
      {id: 'library', name: 'Library', mode: 'link', path: external, type: 'git', url: url + '-changed'},
    ]}), /resource-git-invalid/);
    assert.equal(existsSync(join(f.root, 'stale')), false);
  } finally {f.cleanup()}
});

test('resource import rejects overlapping and unsafe targets before creating anything', async () => {
  const f = fixture();
  try {
    for (const path of ['../escape', '/absolute', 'C:\\external', 'tasks/import', 'memory/import', 'Memory/import', 'resources/.git', '.agent-project/import']) {
      await assert.rejects(createProjectFromPlan({location: f.root, name: 'invalid', resources: [
        {id: 'one', name: 'Resource', mode: 'empty', path},
      ]}), /outside|relative|reserved/);
      assert.equal(existsSync(join(f.root, 'invalid')), false);
    }
    for (const path of ['resources/api', 'resources/API', 'resources/api/subfolder']) {
      await assert.rejects(createProjectFromPlan({location: f.root, name: 'conflict', resources: [
        {id: 'one', name: 'One', mode: 'empty', path: 'resources/api'},
        {id: 'two', name: 'Two', mode: 'empty', path},
      ]}), /target-exists/);
      assert.equal(existsSync(join(f.root, 'conflict')), false);
    }
  } finally {f.cleanup()}
});

test('rejects an occupied project target without changing it', async () => {
  const f = fixture();
  try {
    const target = join(f.root, 'occupied');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'keep');
    await assert.rejects(createProjectFromPlan({location: f.root, name: 'occupied', templateId: 'empty'}), /^Error: project-target-exists$/);
    assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'keep');
    assert.equal(existsSync(join(target, '.git')), false);
  } finally { f.cleanup(); }
});

test('legacy folder creation preserves existing files while initializing the root repository', async () => {
  const f = fixture();
  try {
    const target = join(f.root, 'existing');
    mkdirSync(target);
    writeFileSync(join(target, 'keep.txt'), 'keep');
    const manifest = await createProjectFromPlan({rootDirectory: target, name: 'existing', templateId: 'empty', allowExistingRoot: true});
    assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'keep');
    assert.ok(existsSync(join(target, '.git')));
    assert.equal(manifest, join(realpathSync(target), 'existing.agent-project'));
  } finally { f.cleanup(); }
});
