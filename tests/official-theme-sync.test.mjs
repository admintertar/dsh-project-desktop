import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficialThemeSync} from '../src/desktop-adapter/official/theme-sync.mjs';

test('a renderer change ahead of the official settings save eventually updates native/shared theme', async () => {
  let reads = 0;
  const applied = [];
  const sync = createOfficialThemeSync({
    read: async () => ++reads < 3 ? 'system' : 'dark',
    apply: value => applied.push(value), interval: 1,
  });
  await sync.notify('dark');
  assert.equal(reads, 3);
  assert.deepEqual(applied, ['dark']);
  sync.dispose();
});

test('a superseded boot/selection read cannot overwrite the latest selection', async () => {
  const firstRead = Promise.withResolvers();
  const started = Promise.withResolvers();
  const applied = [];
  let reads = 0;
  const sync = createOfficialThemeSync({
    read: () => {if (++reads === 1) {started.resolve(); return firstRead.promise} return 'dark'},
    apply: value => applied.push(value),
  });
  const old = sync.notify('system');
  await started.promise;
  await sync.notify('dark');
  firstRead.resolve('system');
  await old;
  assert.deepEqual(applied, ['dark']);
  sync.dispose();
});

test('closing cancels a pending theme read and accepts no later notifications', async () => {
  const started = Promise.withResolvers();
  let reads = 0;
  const applied = [];
  const sync = createOfficialThemeSync({
    read: signal => {reads++; started.resolve(); return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {once: true});
    })},
    apply: value => applied.push(value),
  });
  const pending = sync.notify('dark');
  await started.promise;
  sync.dispose();
  await pending;
  await sync.notify('light');
  assert.equal(reads, 1);
  assert.deepEqual(applied, []);
});

test('a preference never accepted by the Host times out without changing the shared theme', async () => {
  const applied = [];
  const sync = createOfficialThemeSync({read: async () => 'light', apply: value => applied.push(value), timeout: 20, interval: 1});
  await assert.rejects(sync.notify('dark'), error => ['AbortError', 'TimeoutError'].includes(error.name));
  assert.deepEqual(applied, []);
  sync.dispose();
});
