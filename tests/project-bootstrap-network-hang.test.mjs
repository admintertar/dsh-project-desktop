import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {createProjectFromPlan} from '../src/app/project-bootstrap.mjs';
import {runProjectGit} from '../src/app/project-git.mjs';

/** Bound every wait so a leaked Git transport can never leave this file, and `npm run check`, hanging. */
async function within(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    })]);
  } finally {clearTimeout(timer)}
}

/**
 * Regression guard for the hang that made `npm run check` never terminate: the client stops but the
 * fixture server never observes the disconnect (the shape a killed transport or a keep-alive proxy
 * leaves behind). The bounded wait must report it in well under the test's 15s budget, so the file
 * settles and exits instead of keeping the port and the runner alive forever.
 */
async function leakyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'project-clone-leak-'));
  const seed = join(root, 'seed'); mkdirSync(seed);
  const git = (args, cwd = seed) => execFileSync('git', args, {cwd, stdio: 'pipe'});
  git(['init', '--quiet']);
  writeFileSync(join(seed, 'README.md'), 'Cloned over the test HTTP server.\n');
  git(['add', 'README.md']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  git(['clone', '--quiet', '--bare', seed, join(root, 'remote.git')]);
  git(['update-server-info'], join(root, 'remote.git'));
  const requested = Promise.withResolvers(), release = Promise.withResolvers();
  const never = Promise.withResolvers(); // Deliberately never resolves: the disconnect signal is missing.
  let first = true;
  const server = createServer(async (req, res) => {
    if (first) {first = false; requested.resolve(); await release.promise;}
    if (res.destroyed) return;
    const path = new URL(req.url, 'http://localhost').pathname;
    try {res.writeHead(200, {'content-type': 'application/octet-stream'}); res.end(readFileSync(join(root, path)))}
    catch {res.writeHead(404); res.end()}
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve)});
  const url = 'https://fixture.invalid/remote.git';
  const runGit = async (args, cwd, options) => {
    if (!args.includes('clone')) return runProjectGit(args, cwd, options);
    const result = await runProjectGit(args.with(-2, `http://127.0.0.1:${server.address().port}/remote.git`), cwd, options);
    await runProjectGit(['remote', 'set-url', 'origin', url], args.at(-1), options);
    return result;
  };
  const plan = {location: root, name: 'project', resources: [{id: 'web', name: 'web', mode: 'remote', url}]};
  return {root, requested: requested.promise, never: never.promise, release: release.resolve, runGit, plan,
    async cleanup() {release.resolve(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, {recursive: true, force: true})}};
}

test('a transparent client disconnect fails the check within its bound instead of hanging', {timeout: 15000}, async () => {
  const f = await leakyFixture(), controller = new AbortController();
  const pending = createProjectFromPlan(f.plan, {runGit: f.runGit, signal: controller.signal});
  const rejected = assert.rejects(pending, {name: 'AbortError'});
  try {
    await within(f.requested, 8000, 'the redirected clone never reached the fixture server');
    controller.abort();
    await within(rejected, 8000, 'the cancelled clone did not stop its Git transport');
    // The original suite awaited this observation without a bound and hung here forever.
    await assert.rejects(within(f.never, 1500, 'the clone transport stayed open after the client stopped'),
      /stayed open after the client stopped/);
  } finally {controller.abort(); f.release(); await f.cleanup()}
});
