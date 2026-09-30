import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {installOfficialProjectIpc} from '../src/desktop-adapter/official/project-ipc.mjs';

test('project shutdown drains accepted theme events and metadata reads before releasing the Host', async () => {
  const ipc = new EventEmitter(), ipcMain = new EventEmitter(), handlers = new Map();
  ipc.handle = (name, listener) => handlers.set(name, listener);
  ipc.removeHandler = name => handlers.delete(name);
  const webContents = {id: 1, ipc, mainFrame: {url: 'dsh-app://app/'}};
  const window = {webContents, isDestroyed: () => false};
  const released = Promise.withResolvers();
  let notifications = 0, reads = 0;
  const services = {
    createWindowIpcScope: () => ({run: callback => callback(), dispose() {}}),
    installDesktopShortcuts: () => ({attach() {}, dispose() {}}), installDesktopDirectoryPicker() {},
  };
  const bridge = installOfficialProjectIpc({ipcMain, app: {getPreferredSystemLanguages: () => ['en']}}, services);
  const registration = bridge.register(window, {
    backend: {read: async () => {reads++; await released.promise; return {hasApiKey: false}}},
    platformView: {}, browserGuests: {bind() {}},
    onTheme: async () => {notifications++; await released.promise}, onError: assert.fail,
  });
  const event = {sender: webContents, senderFrame: webContents.mainFrame};
  ipc.emit('dsh-desktop:native-theme-set', event, 'dark');
  const metadata = handlers.get('dsh-desktop:onboarding-api-key')(event);
  let stopped = false;
  const stopping = registration.dispose().then(() => {stopped = true});
  await nextTurn();
  assert.equal(notifications, 1); assert.equal(reads, 1); assert.equal(stopped, false);
  assert.equal(bridge.owners.size, 0); assert.equal(handlers.size, 0);
  ipc.emit('dsh-desktop:native-theme-set', event, 'light');
  assert.equal(notifications, 1);
  released.resolve(); await stopping;
  assert.equal(await metadata, false); assert.equal(stopped, true);
  await bridge.dispose(); assert.equal(ipcMain.listenerCount('dsh-platform:bootstrap'), 0);
});
