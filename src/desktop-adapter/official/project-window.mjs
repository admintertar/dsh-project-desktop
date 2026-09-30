import {basename, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {visibleBounds, trackWindowState} from '../../windows/window-state.mjs';
import {externalUrl} from '../../windows/renderer-security.mjs';
import {officialPin, runtimeDirectory} from './paths.mjs';
import {officialHostSettings} from './host-settings.mjs';
import {createOfficialThemeSync} from './theme-sync.mjs';
import {prepareOfficialProfile} from './profile.mjs';
import {createOfficialHostRequest, projectDisposer} from './host-request.mjs';
import {configureOfficialProjectSession} from './web-session.mjs';
import {watchOfficialAccount} from './account-session.mjs';
import {hasRunningAccountTasks} from './shared-account-sessions.mjs';

/** 官方 createWindow 的原生窗口行为；Shell 增加逐项目 Session 和窗口状态。 */
export function officialWindowOptions(electron, {preload, partition, title, windowState, primary = true, services}, platform = process.platform) {
  return {width: 1280, height: 820, minWidth: 520, minHeight: 600, show: false, title,
    ...visibleBounds(windowState, electron.screen.getAllDisplays()),
    ...(platform === 'win32' && primary ? {titleBarStyle: 'hidden', autoHideMenuBar: true, titleBarOverlay: {
      height: services.WINDOWS_TITLEBAR_HEIGHT,
      color: electron.nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb',
      symbolColor: electron.nativeTheme.shouldUseDarkColors ? '#f9fafb' : '#0f1115',
    }} : {}),
    ...(platform === 'darwin' ? {titleBarStyle: 'hiddenInset', trafficLightPosition: {x: 16, y: 18},
      vibrancy: 'sidebar', visualEffectState: 'active', backgroundColor: '#00000000'} : {}),
    webPreferences: {preload, partition, nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: primary, devTools: true}};
}

export async function openOfficialProjectWindow(electron, options) {
  const runtimeDir = runtimeDirectory();
  const services = options.services;
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.startupTimeout ?? 60000)]);
  let host, window, projectSession, ipc, platformView, flushState, detachTheme, themeSync, stopAccount, accountSession;
  let closing = false, opened = false, fatal;
  let locale = options.locale ?? 'en';
  const onError = options.onError ?? console.error;
  const failure = Promise.withResolvers();
  void failure.promise.catch(() => {});
  // 启动期间的异步错误进入同一清理路径；成功后的错误只关闭本项目。
  const fail = error => {
    if (closing || fatal) return;
    fatal = error;
    if (opened) options.onFailure?.(error); else failure.reject(error);
  };
  const aborted = () => failure.reject(signal.reason);
  signal.addEventListener('abort', aborted, {once: true});
  const closeResources = projectDisposer([
    () => {stopAccount?.()},
    async () => {await accountSession?.dispose()},
    () => {themeSync?.dispose()},
    async () => {await detachTheme?.()},
    async () => {await ipc?.dispose(); ipc = undefined},
    () => {flushState?.(); if (window && !window.isDestroyed()) window.destroy()},
    () => {projectSession?.dispose()},
    async () => {await platformView?.dispose()},
    async () => {await host?.stop()},
  ]);
  const close = () => {closing = true; return closeResources()};
  const wait = work => Promise.race([work, failure.promise]);
  try {
    signal.throwIfAborted();
    const profile = await wait(prepareOfficialProfile({...options, runtimeDir}));
    signal.throwIfAborted();
    const hostModule = await import(pathToFileURL(join(runtimeDir, 'official/host-process.mjs')).href);
    const webModule = await import(pathToFileURL(join(runtimeDir, 'official/web-document.mjs')).href);
    platformView = new services.DesktopPlatformView(join(runtimeDir, 'desktop/preload-platform-account.cjs'),
      () => services.resolveDesktopLocale(locale).id, process.platform);
    const environment = await wait(options.hostEnvironment?.read() ?? process.env);
    signal.throwIfAborted();
    host = new hostModule.DesktopHostProcess(process.execPath, join(runtimeDir, 'dsh'), profile.profileDir, undefined,
      {...environment, DSH_HOME: profile.homeDir, DSH_TELEMETRY_MODE: 'DISABLED', DSH_CLIENT_VERSION: officialPin.version,
        DSH_PROJECT_OFFICIAL_RUNTIME: runtimeDir, DSH_PROJECT_ACCOUNT_STORE: options.accountStore ?? '',
        DSH_PROJECT_MANIFEST: options.manifestPath}, fail, join(runtimeDir, 'runtime/primary-runtime'),
      {pnpm: join(runtimeDir, 'runtime/pnpm/bin/pnpm.cjs'), nodeBin: join(runtimeDir, 'runtime/bin')},
      next => platformView.setSession(next));
    signal.throwIfAborted();
    const ready = await wait(host.start());
    const cookie = await wait(webModule.authenticateWebHost(ready.url));
    const send = createOfficialHostRequest(ready.url, cookie);
    const request = (path, init = {}) => send(path, {signal: AbortSignal.timeout(10000), ...init});
    const settings = officialHostSettings(request);
    themeSync = createOfficialThemeSync({read: signal => settings.getTheme(signal), apply: value => options.onTheme?.(value)});
    // 写入真实官方 settings，不经 native-theme IPC 回调，避免 SharedTheme 队列重入。
    detachTheme = await options.connectTheme?.(settings);
    signal.throwIfAborted();
    // Cookie 已由官方认证函数取得。再次连接元数据接口使用已认证的根页面，禁止跟随重定向。
    const backend = await wait(services.connectDesktopWelcome(new URL('/', ready.url).href, request, async () => cookie));
    accountSession = options.accountSessions?.connect(options.manifestPath,
      {account: backend.account, hasRunningTasks: () => hasRunningAccountTasks(request)});
    locale = services.resolveDesktopStartupLocale(await wait(backend.readLocalePreference()), electron.app.getPreferredSystemLanguages()).id;
    const partitionName = `persist:project-${basename(options.stateDirectory)}`;
    projectSession = configureOfficialProjectSession({electron, partitionName, hostUrl: ready.url, cookie,
      webDist: join(runtimeDir, 'desktop/web'), ...webModule, accountSession});
    window = new electron.BrowserWindow(officialWindowOptions(electron, {...options, partition: partitionName,
      preload: join(runtimeDir, 'desktop/preload-app.cjs')}));
    projectSession.bindWindow(window);
    services.installMicrophonePermissions(projectSession.partition, () => window.isDestroyed() ? undefined : window.webContents);
    const browserGuests = new services.DesktopBrowserGuests(() => ready.url);
    ipc = options.ipc.register(window, {...options, sessionKey: basename(options.stateDirectory), backend, platformView, browserGuests,
      hostUrl: ready.url, injections: ready.injections, onFailure: fail, onError,
      getLocale: () => locale,
      onTheme: preference => themeSync.notify(preference),
      setLocale: value => {locale = value; options.onLocale?.(value)}});
    flushState = trackWindowState(window, options.saveWindowState ?? (() => {}), onError);
    window.on('focus', () => {options.onFocus?.(); options.onMenuChanged?.()});
    window.on('close', event => {
      if (closing) return;
      event.preventDefault();
      // 系统注销/关机按整个应用收尾并保存恢复集合，不当作用户逐个关闭项目。
      if (options.sessionEnding?.()) {options.quitForSession?.(); return}
      options.close?.();
    });
    window.on('closed', () => {if (!closing) fail(new Error('Project window was destroyed'))});
    const contents = window.webContents;
    contents.on('page-title-updated', event => {event.preventDefault(); window.setTitle(options.title)});
    contents.on('preload-error', (_event, _path, error) => fail(error));
    contents.on('render-process-gone', (_event, details) => fail(new Error(`Project renderer stopped: ${details.reason}`)));
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) fail(new Error(`Official Web load failed: ${description}`));
    });
    const openExternal = url => {const value = externalUrl(url); if (value) void electron.shell.openExternal(value).catch(onError)};
    contents.setWindowOpenHandler(({url}) => {openExternal(url); return {action: 'deny'}});
    contents.on('will-navigate', (event, value) => {
      const url = new URL(value);
      if (url.protocol !== 'dsh-app:' || url.hostname !== 'app') {event.preventDefault(); openExternal(value)}
    });
    const fullscreen = () => {if (!window.isDestroyed()) contents.send('dsh-desktop:window-fullscreen', window.isFullScreen())};
    for (const event of ['enter-full-screen', 'leave-full-screen']) window.on(event, fullscreen);
    contents.on('did-finish-load', fullscreen);
    if (process.platform === 'darwin') {
      const backdrop = () => {
        if (window.isDestroyed()) return;
        const hidden = window.isMinimized() || !window.isVisible();
        window.setVibrancy(hidden ? null : 'sidebar');
        window.setBackgroundColor(hidden ? (electron.nativeTheme.shouldUseDarkColors ? '#191919' : '#f9fafb') : '#00000000');
      };
      for (const event of ['minimize', 'hide', 'restore', 'show']) window.on(event, backdrop);
    }
    contents.on('context-menu', (_event, {isEditable, selectionText, editFlags}) => {
      const items = isEditable ? ['undo', 'redo', null, 'cut', 'copy', 'paste', null, 'selectAll'] : selectionText ? ['copy'] : [];
      const messages = services.resolveDesktopLocale(locale).messages;
      if (items.length) electron.Menu.buildFromTemplate(items.map(role => role === null ? {type: 'separator'} : ({role, accelerator: '',
        ...(process.platform === 'win32' ? {label: messages[role]} : {}),
        enabled: editFlags[`can${role[0].toUpperCase()}${role.slice(1)}`]}))).popup({window});
    });
    await wait(window.loadURL('dsh-app://app/'));
    await wait(contents.executeJavaScript('globalThis.__DSH_BOOT_READY__?.promise'));
    // loadURL 只代表文档加载；官方模块初始化与 transport 必须真正完成。
    while (!await wait(contents.executeJavaScript('Boolean(globalThis.__DSH_BOOT_READY__ && globalThis.__DSH_TRANSPORT__?.ownsHost && !document.querySelector("[data-dsh-boot]") && document.body?.innerText.length > 0)'))) {
      await wait(delay(100));
    }
    if (options.windowState?.maximized) window.maximize();
    if (options.windowState?.fullScreen) window.setFullScreen(true);
    const focus = () => {if (!window.isDestroyed()) {if (window.isMinimized()) window.restore(); window.show(); window.focus()}};
    stopAccount = watchOfficialAccount({account: backend.account, shell: electron.shell, nativeTheme: electron.nativeTheme,
      focus, rememberReturn: options.rememberAccountReturn, onError});
    if (!options.hidden) focus();
    opened = true;
    return {window, close, focus, shortcuts: ipc.shortcuts, get locale() {return locale.startsWith('zh') ? 'zh' : 'en'},
      host: {request, ...settings, url: new URL('/', ready.url).href, inspectQuit: () => host.inspectQuit(),
        result: {profile: profile.profileDir, homeDir: profile.homeDir}}};
  } catch (error) {
    try {await close()} catch (cleanup) {
      const combined = new AggregateError([error, cleanup], `${error.message}; project cleanup is unconfirmed`);
      combined.projectResource = {close};
      throw combined;
    }
    throw error;
  } finally {signal.removeEventListener('abort', aborted)}
}
