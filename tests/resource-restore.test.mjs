import assert from 'node:assert/strict';
import {test} from 'node:test';
import {pendingResourceRestores, restoreMissingResources} from '../src/app/resource-restore.mjs';

const REVISION = 'a'.repeat(64);
const JOB = '9f0f1a2c-4c33-4b0e-9c39-7a1f9c2b0c11';
const missing = {id: 'demo', name: 'Demo', type: 'git', url: 'https://example.invalid/team/demo.git',
  declaredPath: 'resources/demo', path: '/project/resources/demo', status: 'missing', bound: false, external: false};

const body = value => new Response(JSON.stringify(value), {status: 200, headers: {'content-type': 'application/json'}});
function host(states, {onPost} = {}) {
  const calls = [];
  let index = 0;
  return {url: 'http://127.0.0.1:1234/', calls,
    async request(path, init) {
      calls.push({path, init});
      if (init?.method === 'POST') return onPost ? onPost(path, init) : body({operation: {id: JOB, resourceId: 'demo', status: 'cloning'}});
      return body(states[Math.min(index++, states.length - 1)]);
    }};
}

test('only a declared, unbound, missing Git resource without a clone job qualifies', () => {
  const snapshot = {resources: [
    missing,
    {...missing, id: 'branchy', branch: 'release'},
    {...missing, id: 'bound', bound: true},
    {...missing, id: 'external', external: true},
    {...missing, id: 'ready', status: 'ready'},
    {...missing, id: 'local', type: 'local'},
    {...missing, id: 'no-url', url: undefined},
    {...missing, id: 'no-declared-path', declaredPath: undefined},
    {...missing, id: 'attempted'},
  ], operations: [{id: 'job', resourceId: 'attempted', status: 'failed'}]};
  assert.deepEqual(pendingResourceRestores(snapshot), [
    {id: 'demo', name: 'Demo', url: missing.url, path: 'resources/demo'},
    {id: 'branchy', name: 'Demo', url: missing.url, path: 'resources/demo', branch: 'release'},
  ]);
  assert.deepEqual(pendingResourceRestores(undefined), []);
});

test('rebuilds through the Host clone API and waits for the job to finish', async () => {
  const host_ = host([
    {revision: REVISION, canClone: true, resources: [missing], operations: []},
    {revision: REVISION, canClone: true, resources: [missing], operations: [{id: JOB, resourceId: 'demo', status: 'cloning'}]},
    {revision: REVISION, canClone: true, resources: [missing], operations: [{id: JOB, resourceId: 'demo', status: 'completed'}]},
    {revision: REVISION, canClone: true, resources: [{...missing, status: 'ready'}], operations: [{id: JOB, resourceId: 'demo', status: 'completed'}]},
  ]);
  assert.deepEqual(await restoreMissingResources(host_, {delay: async () => {}}), {restored: ['demo'], failed: []});
  const posts = host_.calls.filter(call => call.init?.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].path, '/api/project/resources/clone');
  assert.equal(posts[0].init.headers.origin, 'http://127.0.0.1:1234');
  const sent = JSON.parse(posts[0].init.body);
  // The Host expects the declared project-relative path, never the resolved absolute one.
  assert.deepEqual({id: sent.id, name: sent.name, url: sent.url, path: sent.path},
    {id: 'demo', name: 'Demo', url: missing.url, path: 'resources/demo'});
  assert.equal(sent.expectedRevision, REVISION);
  assert.match(sent.requestId, /^[0-9a-f-]{36}$/);
});

test('does not touch resources the machine cannot clone or already tried', async () => {
  const disabled = host([{revision: REVISION, canClone: false, resources: [missing], operations: []}]);
  assert.deepEqual(await restoreMissingResources(disabled, {delay: async () => {}}), {restored: [], failed: []});
  assert.equal(disabled.calls.length, 1);

  const attempted = host([{revision: REVISION, canClone: true, resources: [missing], operations: [{id: JOB, resourceId: 'demo', status: 'failed'}]}]);
  assert.deepEqual(await restoreMissingResources(attempted, {delay: async () => {}}), {restored: [], failed: []});
  assert.equal(attempted.calls.filter(call => call.init?.method === 'POST').length, 0);
});

test('reports a refused or failed clone without throwing and without retrying it in the same opening', async () => {
  const errors = [];
  const refused = host([{revision: REVISION, canClone: true, resources: [missing], operations: []}],
    {onPost: () => new Response('{"error":"clone-busy"}', {status: 409})});
  const result = await restoreMissingResources(refused, {delay: async () => {}, onError: error => errors.push(error.message)});
  assert.equal(result.restored.length, 0);
  assert.equal(result.failed.length, 1);
  assert.match(errors[0], /409/);

  const stopped = host([{revision: REVISION, canClone: true, resources: [missing], operations: []}],
    {onPost: () => {throw new Error('Project Host stopped')}});
  const closing = await restoreMissingResources(stopped, {delay: async () => {}, onError: error => errors.push(error.message)});
  assert.deepEqual(closing, {restored: [], failed: [{id: 'demo', error: 'Project Host stopped'}]});
  assert.equal(errors.at(-1), 'Project Host stopped');

  // A job that never settles is reported as a failure instead of waiting forever.
  const stalled = host([
    {revision: REVISION, canClone: true, resources: [missing], operations: []},
    {revision: REVISION, canClone: true, resources: [missing], operations: [{id: JOB, resourceId: 'demo', status: 'cloning'}]},
  ]);
  assert.deepEqual(await restoreMissingResources(stalled, {delay: async () => {}, settleTimeoutMs: -1, onError: error => errors.push(error.message)}),
    {restored: [], failed: [{id: 'demo', error: 'Resource clone for demo did not complete (timeout)'}]});
});
