import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reportPluginLoads, trackPluginLoads} from '../src/desktop-adapter/stable/plugin-load-trace.mjs';

// The values the tracker pins from vendor/cordis/src/fiber.ts (a `const enum`, so it has no runtime export).
const LOADING = 1;
const ACTIVE = 2;
const FAILED = 3;

/** A context stub that records the listeners this module registers, and a clock the case advances. */
function harness() {
  const listeners = new Map();
  const fibers = new Map();
  let clock = 0;
  const ctx = {on: (name, listener) => listeners.set(name, listener)};
  const tracker = trackPluginLoads(ctx, {now: () => clock, maximum: 2});
  return {
    tracker,
    /**
     * Advance the injected clock, then report a state transition for one named entry.
     * The same fiber object is reused per name, as Cordis does across a load.
     */
    transition(name, state, advance = 0) {
      clock += advance;
      const key = name ?? '(unnamed)';
      if (!fibers.has(key)) fibers.set(key, {state, entry: name === undefined ? undefined : {options: {name}}});
      const fiber = fibers.get(key);
      fiber.state = state;
      listeners.get('internal/status')(fiber);
    },
  };
}

test('a load records its own duration and the report ranks the slowest first', () => {
  const h = harness();
  h.transition('fast', LOADING);
  h.transition('fast', ACTIVE, 20);
  h.transition('slow', LOADING);
  h.transition('slow', ACTIVE, 900);
  h.transition('medium', LOADING);
  h.transition('medium', ACTIVE, 300);
  // `maximum` is 2, so the third-ranked entry is dropped rather than listed.
  assert.deepEqual(h.tracker.report(), {loaded: 3, failed: 0,
    slowest: [{name: 'slow', ms: 900}, {name: 'medium', ms: 300}]});
});

test('fibers without a Loader entry name are ignored', () => {
  const h = harness();
  h.transition(undefined, LOADING);
  h.transition(undefined, ACTIVE, 500);
  assert.deepEqual(h.tracker.report(), {loaded: 0, failed: 0, slowest: []});
});

test('a failed entry is counted and contributes no duration', () => {
  const h = harness();
  h.transition('broken', LOADING);
  h.transition('broken', FAILED, 700);
  assert.deepEqual(h.tracker.report(), {loaded: 0, failed: 1, slowest: []});
});

test('an entry that turns active without a load in flight is not timed', () => {
  const h = harness();
  h.transition('untracked', ACTIVE, 400);
  assert.deepEqual(h.tracker.report(), {loaded: 0, failed: 0, slowest: []});
});

test('the report names the tree and every entry over the slow threshold', () => {
  const calls = [];
  const trace = {stage: (label, detail) => calls.push(['stage', label, detail]), event: (label, detail) => calls.push(['event', label, detail])};
  reportPluginLoads(trace, {loaded: 4, failed: 1, slowest: [{name: 'slow', ms: 1400}, {name: 'ok', ms: 30}]});
  assert.deepEqual(calls, [
    ['stage', 'official plugin tree settled', 'loaded=4 failed=1 slowest=slow 1400 ms'],
    ['event', 'official plugin loads over 1000ms', 'slow 1400ms'],
  ]);
});

test('a healthy tree reports no failure and no slow line', () => {
  const calls = [];
  const trace = {stage: (label, detail) => calls.push(['stage', label, detail]), event: (label, detail) => calls.push(['event', label, detail])};
  reportPluginLoads(trace, {loaded: 2, failed: 0, slowest: [{name: 'ok', ms: 30}]});
  assert.deepEqual(calls, [['stage', 'official plugin tree settled', 'loaded=2 slowest=ok 30 ms']]);
});

test('a missing trace or report writes nothing', () => {
  const calls = [];
  const trace = {stage: (...args) => calls.push(args), event: (...args) => calls.push(args)};
  reportPluginLoads(trace, undefined);
  reportPluginLoads(undefined, {loaded: 1, failed: 0, slowest: []});
  assert.deepEqual(calls, []);
});