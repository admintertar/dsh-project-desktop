import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {setImmediate as tick} from 'node:timers/promises';
import {watchOfficialAccount} from '../src/desktop-adapter/official/account-session.mjs';
import {installOfficialDeepLinks} from '../src/desktop-adapter/official/deep-links.mjs';
import {createOfficialHostEnvironment} from '../src/desktop-adapter/official/host-environment.mjs';
import {officialWindowOptions} from '../src/desktop-adapter/official/project-window.mjs';
import {installOfficialProjectIpc} from '../src/desktop-adapter/official/project-ipc.mjs';
import {installOfficialSessionEnd} from '../src/desktop-adapter/official/session-end.mjs';
import {installOfficialWindowsChrome} from '../src/desktop-adapter/official/windows-chrome.mjs';

function accountFixture(extra = {}) {
  const calls = [], errors = [];
  let listener, expired, stopped = 0, focused = 0, remembered = 0;
  const dispose = watchOfficialAccount({
    account: {watch(next, _failed, expiry) {listener = next; expired = expiry; return () => stopped++}},
    shell: {openExternal: async url => {calls.push(url)}}, nativeTheme: {shouldUseDarkColors: true},
    focus: () => focused++, rememberReturn: () => {remembered++; return () => remembered--}, onError: e => errors.push(e), ...extra,
  });
  return {calls, errors, dispose, expiry: () => expired(),
    emit: (phase, id = 'attempt-a') => listener({status: phase === 'succeeded' ? 'credential-stored' : 'signed-out',
      attempt: phase ? {id, phase, ...(phase === 'waiting-browser' ? {authorizeUrl:
        'https://platform.example/authorize?state=opaque&code_challenge=challenge&theme=light&redirect_uri=http%3A%2F%2F127.0.0.1%3A8123%2Foauth%2Fcallback'} : {})} : null}),
    get stopped() {return stopped}, get focused() {return focused}, get remembered() {return remembered}};
}

test('account opens each attempt once, preserves authorization fields, and returns only its own window', async () => {
  const a = accountFixture(), b = accountFixture();
  a.emit('waiting-browser'); a.emit('waiting-browser');
  assert.equal(a.calls.length, 1); assert.equal(b.calls.length, 0);
  const url = new URL(a.calls[0]);
  assert.equal(url.searchParams.get('theme'), 'dark');
  assert.equal(url.searchParams.get('state'), 'opaque');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:8123/oauth/callback');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge');
  a.emit('succeeded'); a.emit('succeeded');
  assert.equal(a.focused, 1); assert.equal(b.focused, 0);
  assert.equal(a.remembered, 1);
  a.emit(null); assert.equal(a.remembered, 0);
  a.dispose(); b.dispose();
});

test('cancellation, failure, expiry, reconnect snapshots and disposal do not reopen or steal other projects', () => {
  const a = accountFixture();
  a.emit('succeeded', 'previous-session'); assert.equal(a.focused, 0);
  a.emit('waiting-browser'); a.emit('cancelled'); assert.equal(a.remembered, 0);
  a.emit('waiting-browser', 'b'); a.emit('failed', 'b'); a.emit('failed', 'b');
  assert.equal(a.focused, 1); assert.equal(a.remembered, 0);
  a.emit('waiting-browser', 'c'); a.emit('expired', 'c'); assert.equal(a.focused, 2);
  a.expiry(); assert.equal(a.focused, 3);
  a.dispose(); a.dispose(); a.emit('waiting-browser', 'late'); a.expiry();
  assert.equal(a.calls.length, 3); assert.equal(a.stopped, 1); assert.equal(a.focused, 3);
});

test('browser launch failure is actionable without logging an authorization URL; late failures are ignored', async () => {
  const opening = Promise.withResolvers();
  const a = accountFixture({shell: {openExternal: () => opening.promise}});
  a.emit('waiting-browser'); opening.reject(new Error('secret state in URL')); await tick();
  assert.equal(a.focused, 1); assert.match(a.errors[0].message, /copy the login link/);
  assert.doesNotMatch(a.errors[0].message, /secret/); a.dispose();
  const late = Promise.withResolvers();
  const b = accountFixture({shell: {openExternal: () => late.promise}});
  b.emit('waiting-browser'); b.dispose(); late.reject(new Error('secret')); await tick();
  assert.equal(b.errors.length, 0); assert.equal(b.focused, 0);
});

test('dsh return queues before ready, accepts only official open URLs, and forgets closed login targets', async () => {
  const app = new EventEmitter(); const calls = [];
  app.setAsDefaultProtocolClient = () => assert.fail('Development must not take over the installed protocol');
  const links = installOfficialDeepLinks(app, {register: false, focusDefault: () => calls.push('default'), onError: assert.fail});
  assert.equal(links.handle('dsh://open?code=credential'), false);
  assert.equal(links.handle('dsh://open.evil'), false);
  assert.equal(links.handle('dsh://open/'), true); await tick(); assert.deepEqual(calls, []);
  const removeA = links.remember(() => calls.push('a'));
  const removeB = links.remember(() => calls.push('b'));
  links.ready(); await tick(); assert.deepEqual(calls, ['b']);
  removeB(); let prevented = false;
  app.emit('open-url', {preventDefault() {prevented = true}}, 'dsh://open'); await tick();
  assert.equal(prevented, true); assert.equal(calls.at(-1), 'a');
  removeA(); links.handle('dsh://open'); await tick(); assert.equal(calls.at(-1), 'default');
  links.dispose(); assert.equal(app.listenerCount('open-url'), 0); assert.equal(links.handle('dsh://open'), false);
});

test('explicit protocol registration matches official packaged/dev-app behavior', () => {
  const app = new EventEmitter(); let registered;
  app.setAsDefaultProtocolClient = scheme => {registered = scheme};
  const links = installOfficialDeepLinks(app, {register: true, focusDefault() {}, onError: assert.fail});
  assert.equal(registered, 'dsh'); links.dispose();
});

test('all Hosts share one official environment read and shutdown cancels the probe', async () => {
  let count = 0, signal;
  const probe = Promise.withResolvers(), base = {PATH: '/finder'};
  const environment = createOfficialHostEnvironment({
    resolveDesktopLoginShellConfig: env => {assert.equal(env, base); return {timeoutMs: 123}},
    readDesktopLoginShellEnvironment: (env, config, options) => {
      assert.equal(env, base); assert.equal(config.timeoutMs, 123); count++; signal = options.signal;
      return probe.promise;
    },
  }, base);
  const a = environment.read(), b = environment.read(); assert.equal(a, b); assert.equal(count, 1);
  environment.dispose(); assert.equal(signal.aborted, true);
  probe.resolve({environment: {PATH: '/login-shell'}});
  assert.deepEqual(await a, {PATH: '/login-shell'}); assert.deepEqual(base, {PATH: '/finder'});
  assert.throws(() => environment.read(), /abort/i);
});

test('Windows primary window uses official caption height and current palette without enabling node', () => {
  const options = officialWindowOptions({screen: {getAllDisplays: () => []}, nativeTheme: {shouldUseDarkColors: true}},
    {services: {WINDOWS_TITLEBAR_HEIGHT: 40}, preload: '/official/preload', partition: 'project-a'}, 'win32');
  assert.equal(options.titleBarStyle, 'hidden'); assert.deepEqual(options.titleBarOverlay,
    {height: 40, color: '#1b1b1c', symbolColor: '#f9fafb'});
  assert.equal(options.webPreferences.nodeIntegration, false); assert.equal(options.webPreferences.sandbox, true);
});

test('Windows caption IPC validates ownership, appearance, coordinates and dispatches editor keys', async () => {
  const ipc = new EventEmitter(), ipcMain = new EventEmitter(), handlers = new Map(), keys = [], colors = [];
  ipc.handle = (name, listener) => handlers.set(name, listener); ipc.removeHandler = name => handlers.delete(name);
  const webContents = {id: 1, ipc, mainFrame: {url: 'dsh-app://app/'}, getZoomFactor: () => 1.5};
  const window = {webContents, isDestroyed: () => false, setTitleBarOverlay: value => colors.push(value)};
  let menu, popup, language;
  const electron = {ipcMain, app: {getPreferredSystemLanguages: () => ['en']}, Menu: {
    buildFromTemplate(items) {menu = items; return {popup(value) {popup = value; value.callback()}}},
  }};
  const services = {
    resolveDesktopLocale(value) {language = value; return {messages: {undo: '撤销'}}},
    createWindowIpcScope: () => ({run: callback => callback(), dispose() {}}),
    installDesktopShortcuts: () => ({attach() {}, dispose() {}, sendEditingKey: (...args) => keys.push(args)}),
    installDesktopDirectoryPicker() {},
  };
  const bridge = installOfficialProjectIpc(electron, services, 'win32');
  const registration = bridge.register(window, {backend: {}, platformView: {}, browserGuests: {bind() {}},
    onError: assert.fail, getLocale: () => 'en', applicationItems: () => [{label: 'Open project'}]});
  const event = {sender: webContents, senderFrame: webContents.mainFrame};
  const request = (...args) => handlers.get('dsh-desktop:windows-menu')(event, ...args);
  assert.throws(() => handlers.get('dsh-desktop:windows-menu')({...event, senderFrame: {url: 'https://unowned/'}}, 'edit', 0, 0));
  for (const args of [['invalid', 1, 1], ['edit', NaN, 1], ['edit', 0, -1], ['edit', 0, 100001]]) await assert.rejects(request(...args), /invalid popup/);
  ipc.emit('dsh-desktop:windows-appearance', event, 'zh-CN', '#181818', 'rgba(255, 255, 255, 1)'); await tick();
  assert.equal(colors.length, 1);
  ipc.emit('dsh-desktop:windows-appearance', event, 'bad!', 'url(evil)', '#fff'); await tick();
  assert.equal(colors.length, 1);
  await request('edit', 10, 12); assert.equal(language, 'zh-CN'); assert.equal(popup.window, window);
  assert.equal(popup.x, 15); assert.equal(popup.y, 18);
  menu[0].click(); menu[6].click(); assert.deepEqual(keys, [['Z', ['control']], ['Delete', []]]);
  await request('application', 0, 0); assert.equal(menu[0].label, 'Open project');
  await registration.dispose(); await bridge.dispose(); assert.equal(handlers.size, 0);
});

test('closing a project dismisses native popups and releases pending Windows menu requests', async () => {
  const handlers = new Map(); let closed = 0;
  const window = {webContents: {getZoomFactor: () => 1}};
  const dispose = installOfficialWindowsChrome({window, shortcuts: {},
    context: {applicationItems: () => []}, services: {},
    handle: (name, callback) => handlers.set(name, callback), on() {},
    electron: {Menu: {buildFromTemplate: () => ({popup() {}, closePopup(owner) {assert.equal(owner, window); closed++}})}},
  });
  const pending = handlers.get('dsh-desktop:windows-menu')('application', 0, 0);
  dispose(); await pending; dispose(); assert.equal(closed, 1);
});

test('system shutdown bypass is definitive on Windows and clears after a cancelled macOS shutdown', () => {
  for (const platform of ['win32', 'darwin']) {
    const app = new EventEmitter(), powerMonitor = new EventEmitter(), a = new EventEmitter(), b = new EventEmitter();
    const state = installOfficialSessionEnd({app, powerMonitor}, platform);
    app.emit('browser-window-created', {}, a); app.emit('browser-window-created', {}, b);
    a.emit('query-session-end'); assert.equal(state.ending, false);
    if (platform === 'win32') {a.emit('session-end'); assert.equal(state.ending, true); b.emit('focus'); assert.equal(state.ending, true)}
    else {powerMonitor.emit('shutdown'); assert.equal(state.ending, true); b.emit('show'); assert.equal(state.ending, false)}
    a.emit('closed'); assert.equal(a.eventNames().length, 0);
    state.dispose(); assert.equal(app.eventNames().length, 0); assert.equal(powerMonitor.eventNames().length, 0); assert.equal(b.eventNames().length, 0);
  }
});
