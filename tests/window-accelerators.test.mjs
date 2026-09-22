import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installWindowAccelerators, matchWindowAccelerator, WINDOW_ACCELERATOR_COMMANDS} from '../src/app/window-accelerators.mjs';

const chord = (key, extra = {}) => ({type: 'keyDown', key, control: true, shift: false, alt: false, meta: false, ...extra});

test('the three File chords map to their commands', () => {
  assert.equal(matchWindowAccelerator(chord('n', {shift: true})), WINDOW_ACCELERATOR_COMMANDS.newProject);
  assert.equal(matchWindowAccelerator(chord('N', {shift: true})), WINDOW_ACCELERATOR_COMMANDS.newProject);
  assert.equal(matchWindowAccelerator(chord('o')), WINDOW_ACCELERATOR_COMMANDS.openProject);
  assert.equal(matchWindowAccelerator(chord('w')), WINDOW_ACCELERATOR_COMMANDS.closeProject);
});

test('unrelated chords are left to the renderer', () => {
  for (const input of [chord('o', {shift: true}), chord('w', {shift: true}), chord('n'), chord('r'), chord('o', {alt: true}),
    chord('o', {meta: true}), chord('o', {control: false}), {type: 'keyUp', key: 'o', control: true}, null]) {
    assert.equal(matchWindowAccelerator(input), null, JSON.stringify(input));
  }
});

test('auto-repeat does not re-trigger a command', () => {
  assert.equal(matchWindowAccelerator(chord('o', {isAutoRepeat: true})), null);
});

function fakeWindow() {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.isDestroyed = () => false;
  return window;
}

function fakeApp() {
  const app = new EventEmitter();
  app.windows = [];
  return app;
}

test('Windows installs the bindings on current and future windows and prevents the default', () => {
  const app = fakeApp();
  const existing = fakeWindow();
  const seen = [];
  const attach = installWindowAccelerators({app, BrowserWindow: {getAllWindows: () => [existing]}, platform: 'win32',
    run: (command, window) => seen.push([command, window])});

  const created = fakeWindow();
  app.emit('browser-window-created', {}, created);

  for (const [window, key] of [[existing, 'o'], [created, 'n']]) {
    const prevented = [];
    window.webContents.emit('before-input-event', {preventDefault: () => prevented.push(true)},
      chord(key, key === 'n' ? {shift: true} : {}));
    assert.deepEqual(prevented, [true], `chord ${key} must be consumed`);
  }
  assert.deepEqual(seen, [[WINDOW_ACCELERATOR_COMMANDS.openProject, existing], [WINDOW_ACCELERATOR_COMMANDS.newProject, created]]);

  // re-attaching the same window must not double-fire
  attach(created);
  seen.length = 0;
  created.webContents.emit('before-input-event', {preventDefault: () => {}}, chord('w'));
  assert.deepEqual(seen, [[WINDOW_ACCELERATOR_COMMANDS.closeProject, created]]);
});

test('macOS keeps its menu-bar semantics: nothing is installed', () => {
  const app = fakeApp();
  const window = fakeWindow();
  const seen = [];
  installWindowAccelerators({app, BrowserWindow: {getAllWindows: () => [window]}, platform: 'darwin',
    run: command => seen.push(command)});
  app.emit('browser-window-created', {}, fakeWindow());
  window.webContents.emit('before-input-event', {preventDefault: () => {}}, chord('o'));
  assert.deepEqual(seen, []);
  assert.equal(window.webContents.listenerCount('before-input-event'), 0);
});
