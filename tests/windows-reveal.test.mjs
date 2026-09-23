import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createWindowsRevealPath, explorerTarget, installRevealAdapter, WINDOWS_REVEAL_MARKER} from '../src/desktop-adapter/stable/windows-reveal.mjs';

const recording = (error = null) => {
  const calls = [];
  const run = (command, args, options, callback) => {
    calls.push({command, args, options});
    callback(error);
  };
  return {calls, run};
};

test('the explorer target is a file URI with commas escaped for explorer argument parsing', () => {
  assert.equal(explorerTarget('C:\\Users\\a b\\My File.txt'), 'file:///C:/Users/a%20b/My%20File.txt');
  // Explorer splits its own arguments on commas and would truncate a plain path.
  assert.equal(explorerTarget('C:\\tmp\\a,b.txt'), 'file:///C:/tmp/a%2Cb.txt');
});

test('reveal runs explorer without hiding the window it opens', async () => {
  const {calls, run} = recording();
  await createWindowsRevealPath({run})('C:\\tmp\\target.txt', undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'explorer.exe');
  assert.deepEqual(calls[0].args, ['/select,', 'file:///C:/tmp/target.txt']);
  // The whole point: the pinned official runner passes windowsHide:true, which creates the
  // revealed window hidden.
  assert.equal(calls[0].options.windowsHide, false);
});

test('explorer exit code 1 is the delegated handoff, every other failure rejects', async () => {
  const tolerated = recording(Object.assign(new Error('exit 1'), {code: 1}));
  await createWindowsRevealPath({run: tolerated.run})('C:\\tmp\\a.txt', undefined);

  const failure = Object.assign(new Error('spawn failed'), {code: 'ENOENT'});
  const rejected = recording(failure);
  await assert.rejects(createWindowsRevealPath({run: rejected.run})('C:\\tmp\\a.txt', undefined), /spawn failed/u);
});

test('the adapter replaces the controller reveal on Windows and keeps the abort signal', async () => {
  const {calls, run} = recording();
  const controller = {revealPath: async () => {throw new Error('official reveal must not run')}};
  assert.equal(installRevealAdapter(controller, {platform: 'win32', run}), true);
  assert.equal(controller.revealPath[WINDOWS_REVEAL_MARKER], true);
  const signal = AbortSignal.timeout(1000);
  await controller.revealPath('C:\\tmp\\x.txt', signal);
  assert.deepEqual(calls[0].args, ['/select,', 'file:///C:/tmp/x.txt']);
  assert.equal(calls[0].options.signal, signal);
  assert.equal(calls[0].options.windowsHide, false);
  // Installing twice must not wrap our own adapter into another layer.
  assert.equal(installRevealAdapter(controller, {platform: 'win32', run}), true);
  await controller.revealPath('C:\\tmp\\x.txt', signal);
  assert.equal(calls.length, 2);
});

test('platforms with a correct official reveal are left untouched', () => {
  const official = async () => {};
  for (const platform of ['darwin', 'linux']) {
    const controller = {revealPath: official};
    assert.equal(installRevealAdapter(controller, {platform}), false);
    assert.equal(controller.revealPath, official);
  }
});

test('a missing official field is reported instead of silently leaving the broken behaviour', () => {
  const reported = [];
  assert.equal(installRevealAdapter({}, {platform: 'win32', report: message => reported.push(message)}), false);
  assert.equal(installRevealAdapter(undefined, {platform: 'win32', report: message => reported.push(message)}), false);
  assert.equal(reported.length, 2);
  assert.match(reported[0], /sessionController\.revealPath is unavailable/u);
});
