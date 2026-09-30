import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedAccountSessions} from '../src/desktop-adapter/official/shared-account-sessions.mjs';

const client = {version: '0.2.0-rc.2', locale: 'en', timezoneOffsetSeconds: 0};
function rpc(action) {
  const body = {type: 'client-request', rpcId: 'fixture', method: 'account/' + action, payload: {args: {client}}};
  return new Request('dsh-app://app/api/account/' + action,
    {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
}
const response = value => Response.json({type: 'server-response', rpcId: 'fixture', result: {ok: true, value}});
function backend({running = false, attempt = null, cancel = async () => {}, signOut = async () => {}} = {}) {
  return {hasRunningTasks: async () => running, account: {state: async () => ({attempt}), cancel, signOut}};
}

test('the unchanged official sign-out dialog receives running-task impact from all projects', async () => {
  const sessions = new SharedAccountSessions();
  const a = sessions.connect('a', backend()), b = sessions.connect('b', backend({running: true}));
  const result = await a.forward(rpc('hasRunningAccountTasks'), async () => response(false));
  assert.equal((await result.json()).result.value, true);
  await b.dispose();
  assert.equal((await (await a.forward(rpc('hasRunningAccountTasks'), async () => response(false))).json()).result.value, false);
  await a.dispose();
});

test('logout settles a peer login commit, then removes it before admitting another login', async () => {
  const events = [], hold = Promise.withResolvers();
  const sessions = new SharedAccountSessions();
  const a = sessions.connect('a', backend({signOut: async () => events.push('final-removal')}));
  sessions.connect('b', backend({attempt: {id: 'peer', phase: 'committing'},
    cancel: async () => {events.push('cancel'); await hold.promise; events.push('settled')},
    signOut: async () => events.push('peer-removal')}));
  const logout = a.forward(rpc('signOut'), async () => {events.push('official-removal'); return response({status: 'signed-out'})});
  const next = a.forward(rpc('startSignIn'), async () => {events.push('next-login'); return response({status: 'signed-out'})});
  while (!events.includes('cancel')) await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.includes('next-login'), false);
  hold.resolve();
  assert.equal((await logout).status, 200);
  await next;
  assert.deepEqual(events.slice(0, 6), ['official-removal', 'cancel', 'settled', 'peer-removal', 'final-removal', 'next-login']);
});

test('failed official validation never affects another project; failed peer inspection stays unknown', async () => {
  const sessions = new SharedAccountSessions();
  let touched = 0;
  const a = sessions.connect('a', backend());
  sessions.connect('b', {account: {state: () => {touched++; throw new Error('not called')}},
    hasRunningTasks: async () => {throw new Error('private diagnostic')}});
  const rejected = Response.json({type: 'server-response', rpcId: 'fixture', result: {ok: false}});
  assert.equal(await a.forward(rpc('signOut'), async () => rejected), rejected);
  assert.equal(touched, 0);
  const result = await a.forward(rpc('hasRunningAccountTasks'), async () => response(false));
  assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /private diagnostic/);
});

test('closing a Host drains its in-flight request and rejects queued mutations', async () => {
  const sessions = new SharedAccountSessions(), hold = Promise.withResolvers();
  const a = sessions.connect('a', backend());
  let started;
  const ready = new Promise(resolve => {started = resolve});
  const pending = a.forward(rpc('startSignIn'), async () => {started(); await hold.promise; return response({status: 'signed-out'})});
  await ready;
  const closing = a.dispose();
  hold.resolve();
  await pending; await closing;
  assert.equal((await a.forward(rpc('signOut'), async () => {throw new Error('closed Host called')})).status, 410);
});
