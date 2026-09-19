import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectRestartRequest} from '../src/windows/project-restart.mjs';

function fixture() {
  const state = {closed: false, quitting: false, locale: 'zh', restarts: 0, recoveries: 0, dialogs: []};
  const window = {isDestroyed: () => state.closed};
  const request = createProjectRestartRequest({getWindow: () => window, getLocale: () => state.locale,
    isClosing: () => state.quitting,
    confirmationCopy: (locale, target) => ({title: `DSH Desktop ${target}`, message: `DSH Desktop ${locale}`,
      detail: 'Running operations may be interrupted.', confirm: 'Restart', cancel: 'Cancel'}),
    showMessageBox(owner, options) {const result = Promise.withResolvers(); state.dialogs.push({owner, options, ...result}); return result.promise},
    restart() {state.restarts++; return 'reopened'}, recover() {state.recoveries++; return 'recovery'},
  });
  return {state, window, request};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('cancel keeps the project running and the next request can prompt again', async () => {
  const {state, window, request} = fixture();
  const cancelled = request(); await tick();
  assert.equal(state.dialogs[0].owner, window);
  assert.equal(state.dialogs[0].options.defaultId, 1);
  assert.equal(state.dialogs[0].options.cancelId, 1);
  assert.match(state.dialogs[0].options.message, /当前项目/);
  state.dialogs[0].resolve({response: 1}); await cancelled;
  assert.equal(state.restarts, 0); assert.equal(state.recoveries, 0);
  const confirmed = request(); await tick();
  state.dialogs[1].resolve({response: 0});
  assert.equal(await confirmed, 'reopened'); assert.equal(state.restarts, 1);
});

test('concurrent normal and recovery requests share one confirmation and one operation', async () => {
  const {state, request} = fixture();
  const first = request(), second = request('recovery');
  assert.equal(first, second); await tick(); assert.equal(state.dialogs.length, 1);
  state.dialogs[0].resolve({response: 0}); await Promise.all([first, second]);
  assert.equal(state.restarts, 1); assert.equal(state.recoveries, 0);
});

test('recovery confirms separately and follows the current window language', async () => {
  const {state, request} = fixture(); state.locale = 'en';
  const result = request('recovery'); await tick();
  assert.match(state.dialogs[0].options.message, /this project en/);
  state.dialogs[0].resolve({response: 0}); assert.equal(await result, 'recovery');
  assert.equal(state.restarts, 0); assert.equal(state.recoveries, 1);
});

test('a project closed while confirmation is open cannot be resurrected', async () => {
  const {state, request} = fixture();
  const result = request(); await tick(); state.closed = true;
  state.dialogs[0].resolve({response: 0}); await result;
  await request(); assert.equal(state.dialogs.length, 1); assert.equal(state.restarts, 0);
});

test('quitting prevents prompts and dialog failure releases the pending request', async () => {
  const {state, request} = fixture(); state.quitting = true;
  await request(); assert.equal(state.dialogs.length, 0); state.quitting = false;
  const failure = request(); const rejected = assert.rejects(failure, /dialog failure/); await tick();
  state.dialogs[0].reject(new Error('dialog failure')); await rejected;
  const retry = request(); await tick(); state.dialogs[1].resolve({response: 1}); await retry;
  assert.equal(state.restarts, 0);
});
