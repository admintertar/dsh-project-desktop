import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

/**
 * The pinned official materializer allows a first-time Profile `pnpm install`
 * 120s (its own DEFAULT_TIMEOUT_MS), and that install runs inside the boot RPC.
 * A boot budget below that turns a normal cold start into the official
 * "DSH Host call cancelled or timed out" reject, which the recovery assistant
 * then reports as a failure at the 'host-boot' stage.
 */
const OFFICIAL_MATERIALIZATION_BUDGET_MS = 120_000;

const source = await readFile(new URL('../src/desktop-adapter/index.mjs', import.meta.url), 'utf8');

function constantValue(name) {
  const match = new RegExp(`${name}\\s*=\\s*([\\d_]+)\\s*;`).exec(source);
  assert.ok(match, `${name} must be declared in the Host supervisor`);
  return Number(match[1].replaceAll('_', ''));
}

test('the boot RPC gets its own budget, at least the official materialization budget', () => {
  const bootTimeout = constantValue('HOST_BOOT_TIMEOUT_MS');
  assert.ok(bootTimeout >= OFFICIAL_MATERIALIZATION_BUDGET_MS,
    `HOST_BOOT_TIMEOUT_MS (${bootTimeout}) must not be shorter than the `
    + `${OFFICIAL_MATERIALIZATION_BUDGET_MS}ms materializer budget`);
  assert.match(source, /rpc\.call\('boot',[^;]*undefined, HOST_BOOT_TIMEOUT_MS\)/,
    'the boot call must pass its budget as the fourth argument; the third argument is the AbortSignal, '
    + 'so an omitted fourth argument silently falls back to the 30s control-call default');
});

test('waiting for the Host ready message has its own cold-start budget', () => {
  const readyTimeout = constantValue('HOST_READY_TIMEOUT_MS');
  assert.ok(readyTimeout > 30_000,
    `HOST_READY_TIMEOUT_MS (${readyTimeout}) must exceed the control-call default to cover a cold module graph`);
  assert.match(source, /once\(child, 'message', \{signal: AbortSignal\.timeout\(HOST_READY_TIMEOUT_MS\)\}\)/,
    'the {ready:true} wait must use the ready budget instead of a literal');
});

test('unrelated control calls keep the short default so real hangs still surface', () => {
  // HostRpc is constructed with the original 30s default; only the two
  // cold-start waits above opt out of it.
  assert.match(source, /\}, 30000\);/,
    'the HostRpc control-call default must stay at 30s');
  for (const kept of ["rpc.call('stop', [], AbortSignal.timeout(5000))", "rpc.call('project:theme:get')"]) {
    assert.ok(source.includes(kept), `${kept} must keep its own timeout`);
  }
});
