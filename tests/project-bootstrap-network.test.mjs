import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {assertProjectCreationReady, createProjectFromPlan} from '../src/app/project-bootstrap.mjs';
import {runProjectGit} from '../src/app/project-git.mjs';

// The loopback fixture must exercise the clone instead of an operator's Git proxy. A user-level
// http.proxy (a local proxy such as ClashX) hijacks 127.0.0.1, keeps the tunnel open after the
// killed Git process is gone, and the server then never observes the disconnect.
if (!process.env.GIT_CONFIG_GLOBAL) process.env.GIT_CONFIG_GLOBAL = '/dev/null';
if (!process.env.GIT_CONFIG_SYSTEM) process.env.GIT_CONFIG_SYSTEM = '/dev/null';

/** Bound every wait so a leaked Git transport can never leave this file, and `npm run check`, hanging. */
async function within(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally {clearTimeout(timer)}
}

/** Serve an actual Git repository over loopback HTTP, with a controllable network stall. */
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'project-clone-'));
  const seed = join(root, 'seed'); mkdirSync(seed);
  const git = (args, cwd = seed) => execFileSync('git', args, {cwd, stdio: 'pipe'});
  git(['init', '--quiet']);
  writeFileSync(join(seed, 'README.md'), 'Cloned over the test HTTP server.\n');
  git(['add', 'README.md']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  git(['clone', '--quiet', '--bare', seed, join(root, 'remote.git')]);
  git(['update-server-info'], join(root, 'remote.git'));
  const requested = Promise.withResolvers(), release = Promise.withResolvers(), disconnected = Promise.withResolvers();
  let first = true;
  const server = createServer(async (req, res) => {
    if (first) {
      first = false;
      res.once('close', disconnected.resolve);
      requested.resolve();
      await release.promise;
    }
    if (res.destroyed) return;
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/remote.git/') || path.includes('..')) {res.writeHead(404); res.end(); return}
    try {res.writeHead(200, {'content-type': 'application/octet-stream'}); res.end(readFileSync(join(root, path)))}
    catch {res.writeHead(404); res.end()}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve)});
  const url = 'https://fixture.invalid/remote.git';
  // The product still validates the HTTPS declaration; the test redirects only its transport to loopback.
  const runGit = async (args, cwd, options) => {
    if (!args.includes('clone')) return runProjectGit(args, cwd, options);
    const result = await runProjectGit(args.with(-2, `http://127.0.0.1:${server.address().port}/remote.git`), cwd, options);
    await runProjectGit(['remote', 'set-url', 'origin', url], args.at(-1), options);
    return result;
  };
  const plan = {location: root, name: 'project', resources: [{id: 'web', name: 'web', mode: 'remote', url}]};
  return {root, requested: requested.promise, disconnected: disconnected.promise, release: release.resolve, runGit, plan,
    /** The server noticed the client's transport close within a bounded window. */
    async expectDisconnected(ms = 8000) {
      await within(disconnected.promise, ms, `the clone transport stayed open for more than ${ms}ms after the client stopped`);
    },
    async cleanup() {release.resolve(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, {recursive: true, force: true})}};
}

test('a slow real clone leaves the event loop and other project creation responsive', {timeout: 15000}, async () => {
  const f = await fixture(), controller = new AbortController();
  const pending = createProjectFromPlan(f.plan, {runGit: f.runGit, signal: controller.signal});
  const observed = pending.then(value => ({value}), error => ({error}));
  try {
    await within(f.requested, 8000, 'the redirected clone never reached the fixture server');
    await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(createProjectFromPlan(f.plan), /still in progress/);
    assert.throws(() => assertProjectCreationReady(join(f.root, 'project/project.agent-project')), /still in progress/);
    const other = await createProjectFromPlan({location: f.root, name: 'other', templateId: 'empty'});
    assert.ok(existsSync(other), 'another project can finish while the clone is waiting');
    f.release();
    const {value: manifest, error} = await observed;
    assert.ifError(error);
    assertProjectCreationReady(manifest);
    assert.equal(readFileSync(join(f.root, 'project/resources/web/README.md'), 'utf8'), 'Cloned over the test HTTP server.\n');
    assert.equal(existsSync(join(f.root, 'project/web')), false);
    assert.equal(await createProjectFromPlan(f.plan), manifest, 'retry reuses the completed project');
  } finally {
    controller.abort(); f.release();
    await within(observed, 8000, 'the clone did not settle after cancellation').catch(() => {});
    await f.cleanup();
  }
});

test('cancelling a real clone closes its transport before rollback and preserves linked resources', {timeout: 15000}, async () => {
  const f = await fixture(), controller = new AbortController();
  const external = join(f.root, 'external'); mkdirSync(external); writeFileSync(join(external, 'keep.txt'), 'keep');
  f.plan.resources.unshift({id: 'external', name: 'External', mode: 'link', path: external});
  const pending = createProjectFromPlan(f.plan, {runGit: f.runGit, signal: controller.signal});
  const rejected = assert.rejects(pending, {name: 'AbortError'});
  try {
    await within(f.requested, 8000, 'the redirected clone never reached the fixture server');
    controller.abort();
    await within(rejected, 8000, 'the cancelled clone did not stop its Git transport');
    await f.expectDisconnected();
    assert.equal(existsSync(join(f.root, 'project')), false);
    assert.equal(readFileSync(join(external, 'keep.txt'), 'utf8'), 'keep');
    f.release();
    const manifest = await createProjectFromPlan(f.plan, {runGit: f.runGit});
    assert.ok(existsSync(manifest), 'retry succeeds after cancelled creation is rolled back');
  } finally {
    controller.abort(); f.release();
    await within(rejected, 8000, 'the cancelled clone did not stop its Git transport').catch(() => {});
    await f.cleanup();
  }
});

test('a stalled clone times out and removes only the unfinished project', {timeout: 15000}, async () => {
  const f = await fixture();
  const pending = createProjectFromPlan(f.plan, {runGit: (args, cwd, options) => f.runGit(args, cwd,
    {...options, ...(args.includes('clone') ? {timeoutMs: 500} : {})})});
  try {
    await within(assert.rejects(pending, /timed out/), 8000, 'the stalled clone did not time out');
    await f.expectDisconnected();
    assert.equal(existsSync(join(f.root, 'project')), false);
    assert.ok(existsSync(join(f.root, 'remote.git')));
  } finally {await f.cleanup()}
});
