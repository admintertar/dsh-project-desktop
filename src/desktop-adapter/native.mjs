import {EventEmitter} from 'node:events';
import {dirname, join, basename} from 'node:path';
import {statSync} from 'node:fs';
import {startProjectHost} from './index.mjs';
import {loadDesktop, desktopRequire} from './stable/modules.mjs';
import {runtimePackage, lock} from './paths.mjs';
import {trustedSender, rendererHeaders, externalUrl} from '../windows/renderer-security.mjs';
import {visibleBounds, trackWindowState} from '../windows/window-state.mjs';
import {captureProjectCheckpoint} from './stable/recovery.mjs';
import {createProjectRestartRequest} from '../windows/project-restart.mjs';
import {productVersion, productName} from '../app/product.mjs';

function spawnUtility(electron, entry, args, options) {
  const child = electron.utilityProcess.fork(entry, args, {cwd: options.cwd, env: options.env, stdio: 'pipe', serviceName: 'DSH Project Host'});
  const bridge = new EventEmitter();
  Object.assign(bridge, {stdout: child.stdout, stderr: child.stderr, send: value => child.postMessage(value),
    kill: () => child.kill()});
  child.on('message', value => bridge.emit('message', value));
  child.on('exit', code => bridge.emit('exit', code));
  child.on('error', error => bridge.emit('error', error));
  return bridge;
}

export async function openNativeProject(electron, options) {
  const {BrowserWindow, nativeImage, dialog, shell, Notification} = electron;
  const {advancedWindowOptions} = await loadDesktop('window-options');
  const {createDesktopRendererActionDispatcher} = await loadDesktop('renderer-actions-dispatch');
  const {openDesktopTerminal} = await loadDesktop('desktop-terminal');
  const {exportDiagnosticsZip} = await loadDesktop('diagnostic-export');
  const {desktopRestartConfirmationCopy} = await loadDesktop('tray-locale');
  const {showDesktopMessageBox} = await loadDesktop('desktop-dialog-window');
  let window, host, specification, removeHeaders, removeSessionPolicies, chromiumSession;
  let disposed = false, quitting = false;
  let locale = options.locale;
  let healthTimer;
  let ready = false;
  let bootFailure;
  let failureStage = 'host-boot';
  let saveWindow;
  const failed = error => {
    if (disposed) return;
    error.failureStage ??= failureStage;
    if (!ready) {bootFailure = error; health.reject(error)}
    else options.onFailure?.(error);
  };
  const health = Promise.withResolvers();
  health.promise.catch(() => {});
  const contributions = new Map();
  const focus = () => {if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore(); window.show(); window.focus();
    options.onFocus?.(); options.onMenuChanged?.();
  }};
  const disabled = async () => {throw new Error('This operation is unavailable in Project Desktop')};
  const requestRestart = createProjectRestartRequest({getWindow: () => window, getLocale: () => locale,
    confirmationCopy: desktopRestartConfirmationCopy, showMessageBox: (owner, options) => showDesktopMessageBox(options, owner),
    isClosing: () => disposed || quitting, restart: () => options.restart(), recover: () => options.recover()});
  const runtime = {
    platform: process.platform, locale,
    updates: {isPackaged: false, canDownload: false, currentVersion: productVersion, statePath: join(options.stateDirectory, 'updates-disabled'),
      request: disabled, confirmDownload: disabled, showManualCheckResult: disabled, downloadAndOpen: disabled, notify() {}},
    schedule(spec) {
      if (spec.mode !== 'advanced' || specification) throw new Error('Invalid project window specification');
      specification = spec;
      return async () => {removeHeaders?.(); removeSessionPolicies?.(); if (window && !window.isDestroyed()) window.destroy()};
    },
    registerTrayItem(item) {const id = Symbol(); contributions.set(id, item); options.onMenuChanged?.();
      return {refresh: () => options.onMenuChanged?.(), dispose() {contributions.delete(id); options.onMenuChanged?.()}}},
    show: focus,
    notifyAttention(value) {if (!options.safeMode && !window?.isFocused() && Notification.isSupported()) {
      const notification = new Notification(value); notification.on('click', focus); notification.show();
    }},
    openTerminal() {
      if (options.safeMode) return disabled();
      if (!host) throw new Error('Project is still starting');
      openDesktopTerminal({platform: process.platform, appExecutable: process.execPath,
        dshBootstrapPath: join(runtimePackage, 'lib/desktop-cli.js'), pnpmBinPath: join(dirname(desktopRequire.resolve('pnpm')), 'bin/pnpm.mjs'),
        electronVersion: process.versions.electron, profileName: host.result.profileName, productVersion: lock.desktop.version,
        profileDir: host.result.profile, homeDir: host.result.homeDir, stateDir: join(options.stateDirectory, 'terminal')});
    },
    reloadRenderer() {window?.webContents.reload()},
    toggleDeveloperTools() {window?.webContents.toggleDevTools()},
    async exportDiagnostics() {
      const confirmation = await dialog.showMessageBox(window, {type: 'question',
        message: locale === 'zh' ? '导出当前项目的诊断日志？' : 'Export this project’s diagnostic logs?',
        buttons: locale === 'zh' ? ['取消', '导出'] : ['Cancel', 'Export'], defaultId: 0, cancelId: 0});
      if (confirmation.response !== 1) return;
      const path = await exportDiagnosticsZip(join(options.stateDirectory, 'logs'), options.stateDirectory,
        {appVersion: `${productName} ${productVersion} / Desktop ${lock.desktop.version}`});
      shell.showItemInFolder(path);
    },
    async pickDirectory() {const result = await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory']}); return result.canceled ? null : result.filePaths[0]},
    async validateDirectory(path) {try {return typeof path === 'string' && statSync(path).isDirectory()} catch {return false}},
    reportRendererBoot(report) {clearTimeout(healthTimer); report.status === 'healthy' ? health.resolve(report) : failed(new Error(JSON.stringify(report)))},
    setLocalePreference(value) {locale = value === 'zh' || value === 'en' ? value : options.locale; options.onMenuChanged?.()},
    // SharedTheme is the sole native appearance owner; no per-window override.
    setThemeSource() {},
    requestRestart: () => requestRestart(), requestRecoveryRestart: () => requestRestart('recovery'),
    prepareToQuit() {quitting = true}, openProfileCreateWindow: disabled,
  };
  const close = async () => {
    saveWindow?.(); disposed = true; clearTimeout(healthTimer);
    removeHeaders?.();
    removeSessionPolicies?.();
    if (window && !window.isDestroyed()) window.destroy();
    await host?.close();
    if (options.safeMode && chromiumSession) await chromiumSession.clearStorageData();
  };
  try {
    host = await startProjectHost({...options, onUnexpectedExit: error => {error.failureStage = 'host-boot'; failed(error)}, nativeRuntime: runtime, spawnHost: (...args) => spawnUtility(electron, ...args)});
    failureStage = 'renderer-startup';
    const preferences = advancedWindowOptions(specification, nativeImage.createFromPath(specification.iconPath), process.platform, join(runtimePackage, 'lib/preload.cjs'));
    preferences.webPreferences.partition = options.partition ?? `persist:project-${basename(options.stateDirectory)}`;
    if (options.hidden) preferences.webPreferences.backgroundThrottling = false;
    window = new BrowserWindow({...preferences, ...visibleBounds(options.windowState, electron.screen.getAllDisplays()), title: options.title});
    if (options.windowState?.maximized) window.maximize();
    if (options.windowState?.fullScreen) window.setFullScreen(true);
    saveWindow = trackWindowState(window, state => options.saveWindowState?.(state), options.onError);
    window.on('page-title-updated', event => {event.preventDefault(); window.setTitle(options.title)});
    window.on('close', event => {if (!disposed) {event.preventDefault(); options.close()}});
    window.on('focus', () => {options.onFocus?.(); options.onMenuChanged?.()});
    const contents = window.webContents;
    contents.on('console-message', event => {if (event.level === 'error') console.error('Project renderer:', event.message)});
    const origin = new URL(specification.url).origin;
    const session = contents.session;
    chromiumSession = session;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    const denyDownload = event => event.preventDefault();
    session.on('will-download', denyDownload);
    removeSessionPolicies = () => {
      session.removeListener('will-download', denyDownload);
      session.setPermissionRequestHandler(null); session.setPermissionCheckHandler(null);
    };
    const auth = await session.fetch(specification.authenticationUrl, {credentials: 'include', cache: 'no-store',
      headers: {[specification.rendererAccessHeader.name]: specification.rendererAccessHeader.value}});
    await auth.body?.cancel();
    if (auth.status !== 200) throw new Error(`Renderer authentication failed (${auth.status})`);
    session.webRequest.onBeforeSendHeaders({urls: ['<all_urls>']}, (details, callback) => {
      callback({requestHeaders: rendererHeaders(details, contents.id, origin, specification.rendererAccessHeader)});
    });
    removeHeaders = () => session.webRequest.onBeforeSendHeaders(null);
    const openExternal = value => {const url = externalUrl(value); if (url) void shell.openExternal(url).catch(options.onError)};
    contents.setWindowOpenHandler(({url}) => {openExternal(url); return {action: 'deny'}});
    contents.on('will-frame-navigate', (event, details) => {
      const target = details?.url ?? event.url;
      if (!target || new URL(target).origin !== origin) {event.preventDefault(); if (details?.isMainFrame ?? event.isMainFrame) openExternal(target)}
    });
    contents.on('will-redirect', (event, url) => {if (new URL(url).origin !== origin) event.preventDefault()});
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.on('render-process-gone', (_event, details) => failed(new Error(`Project renderer stopped: ${details.reason}`)));
    const dispatch = createDesktopRendererActionDispatcher({
      openTerminal: runtime.openTerminal, restart: runtime.requestRestart, restartToRecovery: runtime.requestRecoveryRestart,
      reload: runtime.reloadRenderer, developerTools: runtime.toggleDeveloperTools,
      checkForUpdates: () => options.checkForUpdates(window), exportDiagnostics: runtime.exportDiagnostics,
    }, message => options.onError(new Error(message)));
    contents.ipc.handle('dsh-desktop:renderer-action', (event, action) => {
      if (!trustedSender(event, contents, specification.url)) throw new Error('Untrusted renderer');
      return dispatch(action);
    });
    await options.connectTheme(host);
    healthTimer = setTimeout(() => health.reject(new Error('Project renderer boot timed out')), 45000);
    await window.loadURL(specification.url);
    await health.promise;
    if (!options.safeMode) try {await captureProjectCheckpoint(options.stateDirectory, host.result.profileName)} catch (error) {options.onWarning?.(error)}
    if (bootFailure) throw bootFailure;
    ready = true;
    runtime.setLocalePreference(specification.readLocalePreference?.());
    if (!options.hidden) focus();
    return {host, window, focus, close, get locale() {return locale}, contributions: () => [...contributions.values()],
      restart: runtime.requestRestart, recover: runtime.requestRecoveryRestart,
      terminal: runtime.openTerminal, diagnostics: runtime.exportDiagnostics};
  } catch (error) {
    error.failureStage ??= failureStage;
    try {await close()} catch (shutdown) {
      const failure = new AggregateError([error, shutdown], 'Project window failed and Host shutdown is unconfirmed');
      failure.projectResource = {close}; throw failure;
    }
    throw error;
  }
}
