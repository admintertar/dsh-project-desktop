import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {SessionState} from '../src/app/session-state.mjs';
import {ProjectWorkspace} from '../src/app/project-workspace.mjs';
import {visibleBounds} from '../src/windows/window-state.mjs';

function fixture(create, recovery) {
  const root = mkdtempSync(join(tmpdir(), 'project-workspace-'));
  const file = join(root, 'session.json');
  const session = new SessionState(file);
  let starts = 0;
  const workspace = new ProjectWorkspace({session, resolveProject: path => path,
    create: create ?? (async () => ({id: ++starts, close: async () => {}, focus() {}})), recovery});
  return {root, file, session, workspace};
}
const a = '/fixtures/Alpha.agent-project', b = '/fixtures/Bravo.agent-project';

test('safe mode stops normal ownership, is never auto-restored, and exits back to recovery', async () => {
  let normalStopped = 0, safeStopped = 0;
  const {workspace, session, file} = fixture(async (_path, _signal, {safeMode}) => ({safeMode, focus() {},
    close: async () => {safeMode ? safeStopped++ : normalStopped++}}));
  await workspace.open(a); await workspace.open(b);
  const safe = await workspace.safeMode(a);
  assert.equal(safe.safeMode, true); assert.equal(normalStopped, 1);
  assert.equal(session.get(a).phase, 'failed'); assert.equal(workspace.failures()[0].safeMode, true);
  assert.equal(await workspace.safeMode(a), safe);
  await workspace.exitSafeMode(a);
  assert.equal(safeStopped, 1); assert.equal(session.get(a).phase, 'failed');
  assert.ok(workspace.projects.has(b));
  await workspace.safeMode(a); await workspace.shutdown();
  assert.equal(new SessionState(file).get(a).phase, 'failed');
  assert.equal(new SessionState(file).get(b).phase, 'open');
});

test('application quit preserves open set; explicit project close removes only that project', async () => {
  const {workspace, session, file} = fixture();
  const [one, same, other] = await Promise.all([workspace.open(a), workspace.open(a), workspace.open(b)]);
  assert.equal(one, same); assert.notEqual(one, other);
  session.saveWindow(a, {x: 20, y: 30, width: 900, height: 700});
  await workspace.close(a);
  assert.deepEqual(session.list().map(item => item.path), [b]);
  assert.equal(session.window(a).width, 900, 'layout survives explicit close');
  await workspace.shutdown();
  assert.deepEqual(new SessionState(file).list().map(item => item.path), [b]);
  let restored = [];
  const next = new ProjectWorkspace({session: new SessionState(file), resolveProject: value => value,
    create: async path => {restored.push(path); return {close: async () => {}, focus() {}}}});
  await next.restore(); assert.deepEqual(restored, [b]); await next.close(b); await next.shutdown();
  assert.equal(new SessionState(file).list().length, 0);
});

test('one missing project does not prevent restoring another; interrupted startup waits for explicit retry', async () => {
  const {session} = fixture();
  session.update(a, {title: 'Alpha', phase: 'open'}); session.update(b, {title: 'Bravo', phase: 'open'});
  const c = '/fixtures/Interrupted.agent-project'; session.update(c, {title: 'Interrupted', phase: 'opening'});
  const started = [];
  const workspace = new ProjectWorkspace({session, resolveProject: path => {if (path === a) throw new Error('Missing file'); return path},
    create: async path => {started.push(path); return {close: async () => {}, focus() {}}}});
  await workspace.restore(); assert.deepEqual(started, [b]);
  assert.equal(workspace.failures().length, 2);
  await workspace.open(c); assert.deepEqual(started, [b, c]);
  await workspace.shutdown();
});

test('recovery waits for confirmed shutdown, serializes reopen and leaves other projects available', async () => {
  let allowStop = false;
  let stopped = 0, recovered = 0;
  const {workspace, session} = fixture(async path => ({focus() {}, close: async () => {
    if (path === a && !allowStop) throw new Error('Host still alive'); stopped++;
  }}), async () => {assert.ok(stopped); return {list: () => ['slot-1'], dispose() {}, restore: async () => {recovered++}}});
  await Promise.all([workspace.open(a), workspace.open(b)]);
  await assert.rejects(workspace.recover(a), /Host still alive/);
  assert.equal(recovered, 0); assert.ok(workspace.projects.has(b));
  allowStop = true;
  assert.deepEqual(await workspace.recover(a), ['slot-1']);
  assert.equal(session.get(a).phase, 'failed');
  await workspace.recover(a, 'restore', 'preview');
  assert.equal(recovered, 1); assert.equal(session.get(a).phase, 'open');
  await workspace.shutdown();
});

test('manual recovery is a persisted non-failure state and releases the queue while its window is open', async () => {
  let stops = 0, disposed = 0;
  const {workspace, session, file} = fixture(async () => ({focus() {}, close: async () => {stops++}}),
    async () => ({dispose() {disposed++}}));
  await workspace.open(a); await workspace.open(b);
  const recovery = await workspace.beginRecovery(a, {requested: true});
  assert.equal(session.get(a).phase, 'recovering'); assert.equal(workspace.errors.has(a), false);
  assert.equal(workspace.projects.has(a), false); assert.ok(workspace.projects.has(b));
  assert.equal(stops, 1);
  assert.equal(await workspace.beginRecovery(a, {requested: true}), recovery);
  assert.equal(new SessionState(file).get(a).phase, 'recovering');
  await workspace.open(a); assert.equal(disposed, 1); assert.equal(session.get(a).phase, 'open');
  await workspace.shutdown();
});

test('failed application quit allows close retry and new work without losing the restore set', async () => {
  let fail = true;
  const {workspace, session} = fixture(async () => ({focus() {}, close: async () => {if (fail) throw new Error('Cannot stop')}}));
  await workspace.open(a); await assert.rejects(workspace.shutdown());
  assert.equal(session.get(a).phase, 'failed');
  await assert.rejects(workspace.open(a), /Cannot stop/);
  fail = false; await workspace.open(a); await workspace.close(a); await workspace.open(b); await workspace.shutdown();
  assert.deepEqual(session.list().map(item => item.path), [b]);
});

test('an installer launch failure can resume every saved project after a successful shutdown', async () => {
  const {workspace, session} = fixture();
  const first = await workspace.open(a); await workspace.open(b);
  await workspace.shutdown();
  assert.equal(workspace.projects.size, 0);
  await workspace.resumeAfterShutdown();
  assert.deepEqual([...workspace.projects.keys()].sort(), [a, b]);
  assert.notEqual(workspace.projects.get(a), first);
  assert.deepEqual(session.list().map(item => item.phase), ['open', 'open']);
  await workspace.shutdown();
});

test('unreadable window records are preserved and do not prevent the welcome page', () => {
  const {root, file} = fixture(); writeFileSync(file, 'broken json');
  const state = new SessionState(file); assert.equal(state.warning, 'session-unreadable');
  assert.deepEqual(state.list(), []);
  const backup = readdirSync(root).find(name => name.includes('.unreadable-'));
  assert.equal(readFileSync(join(root, backup), 'utf8'), 'broken json');
});

test('off-screen windows are clamped to the current display without losing valid bounds', () => {
  const displays = [{workArea: {x: 0, y: 25, width: 1440, height: 875}}];
  assert.deepEqual(visibleBounds({x: 30, y: 40, width: 900, height: 700}, displays), {x: 30, y: 40, width: 900, height: 700});
  const bounds = visibleBounds({x: 5000, y: -1000, width: 2000, height: 2000}, displays);
  assert.deepEqual(bounds, {x: 0, y: 25, width: 1440, height: 875});
  assert.deepEqual(visibleBounds({x: 'bad'}, displays), {});
});
