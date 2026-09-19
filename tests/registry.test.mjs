import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProjectRegistry} from '../src/windows/project-registry.mjs';

test('concurrent opens share one Host and closing one project preserves the other', async () => {
  const registry = new ProjectRegistry();
  let opens = 0, closes = 0;
  const create = async () => {opens++; return {close: async () => {closes++}}};
  const [a, b] = await Promise.all([registry.open('a', create), registry.open('a', create)]);
  assert.equal(a, b); assert.equal(opens, 1);
  await registry.open('b', create);
  await registry.close('a');
  assert.deepEqual(registry.list(), [{id: 'b', phase: 'open'}]);
  await registry.closeAll(); assert.equal(closes, 2);
  await assert.rejects(registry.open('c', create), /closing/);
});
test('closing during startup disposes a late Host', async () => {
  const registry = new ProjectRegistry();
  let finish, closed = 0;
  const opening = registry.open('a', async () => new Promise(resolve => {finish = resolve}));
  const failed = assert.rejects(opening, {name: 'AbortError'});
  await Promise.resolve();
  const closing = registry.close('a');
  finish({close: async () => {closed++}});
  await Promise.all([failed, closing]);
  assert.equal(closed, 1); assert.deepEqual(registry.list(), []);
});
test('unconfirmed shutdown retains ownership until retry succeeds', async () => {
  const registry = new ProjectRegistry(); let attempt = 0;
  await registry.open('a', async () => ({close: async () => {if (++attempt === 1) throw new Error('Host still alive')}}));
  await assert.rejects(registry.close('a'), /still alive/);
  assert.deepEqual(registry.list(), [{id: 'a', phase: 'blocked'}]);
  await assert.rejects(registry.open('a', async () => {throw new Error('must not create')}), /unconfirmed/);
  await registry.close('a'); assert.deepEqual(registry.list(), []);
});
test('failed startup retains a partially created Host whose cleanup is unconfirmed', async () => {
  const registry = new ProjectRegistry(); let disposed = 0;
  const failure = new Error('Renderer boot failed; Host still alive');
  failure.projectResource = {close: async () => {disposed++}};
  await assert.rejects(registry.open('a', async () => {throw failure}), /still alive/);
  assert.deepEqual(registry.list(), [{id: 'a', phase: 'blocked'}]);
  await assert.rejects(registry.open('a', async () => {}), /unconfirmed/);
  await registry.close('a'); assert.equal(disposed, 1); assert.deepEqual(registry.list(), []);
});
