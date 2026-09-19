import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SharedTheme} from '../src/app/shared-theme.mjs';

test('first project initializes the preference, reopened windows inherit it, failed save does not broadcast', async () => {
  const native = [], a = [], b = [], reopened = []; let fail = false;
  const theme = new SharedTheme({persist: async () => {if (fail) throw new Error('disk unavailable')}, applyNative: value => native.push(value)});
  const disconnect = await theme.connect('a', 'dark', value => a.push(value));
  await theme.connect('b', 'light', value => b.push(value));
  assert.deepEqual(b, ['dark']);
  await theme.select('light'); await disconnect();
  await theme.connect('a', 'dark', value => reopened.push(value));
  assert.deepEqual(reopened, ['light']);
  fail = true; await assert.rejects(theme.select('system'), /disk/);
  assert.equal(theme.value, 'light'); assert.deepEqual(native, ['dark', 'light']);
  await assert.rejects(theme.select('invalid'), /Invalid/);
});
test('one failed project does not prevent other projects receiving the preference', async () => {
  const applied = [];
  const theme = new SharedTheme({initial: 'dark', persist: async () => {}, applyNative: () => {}});
  await theme.connect('a', 'dark', value => {if (value === 'light') throw new Error('disconnected')});
  await theme.connect('b', 'dark', value => applied.push(value));
  await assert.rejects(theme.select('light'), AggregateError);
  assert.deepEqual(applied, ['dark', 'light']);
});
