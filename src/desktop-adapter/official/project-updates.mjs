import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ProjectReleaseUpdater} from './project-release-updater.mjs';

/** Official status, scheduling, download coordination and modal UI; our feed and installer handoff. */
export async function createProjectUpdates(electron, {directory, output, version, productName, locale, getWindow,
  installArtifact, request = (url, init) => electron.net.fetch(url, init), automatic = electron.app.isPackaged,
  changed = () => {}, platform = process.platform, arch = process.arch}) {
  const official = await import(pathToFileURL(join(output, 'services.mjs')).href);
  const backend = new ProjectReleaseUpdater({directory, request, platform, arch});
  const overlays = new official.DesktopUpdateOverlays();
  let requester, requestLocale, operation, disposed = false, checking, promptCancelled = false, current = {phase: 'idle'};
  const windows = new Set();
  const language = () => official.resolveDesktopLocale(requestLocale ?? locale());
  const dialog = new official.DesktopUpdateDialog(join(output, 'preload.cjs'), language, overlays);
  // The official overlay has its own default Session, never a project's authenticated Host bridge.
  const shellAssets = new Set(['/update-dialog.html', '/update-dialog.js', '/update-dialog.css', '/update-close.svg']);
  electron.session.defaultSession.protocol.handle('dsh-app', request => {
    const url = new URL(request.url);
    return url.hostname === 'shell' && shellAssets.has(url.pathname) && request.method === 'GET'
      ? official.serveWebDocument(request, output) : new Response(null, {status: 404});
  });
  const publish = state => {
    if (disposed) return state;
    current = state;
    const value = official.presentDesktopUpdate(state);
    for (const window of windows) if (!window.isDestroyed()) window.webContents.send('dsh-desktop:updates-presentation', value);
    changed(); return state;
  };
  const coordinator = new official.DesktopUpdateCoordinator(publish,
    () => {throw new Error('Project installers use the Shell handoff')}, backend, () => true, () => version);
  const schedule = new official.DesktopUpdateSchedule(coordinator, {intervalMs: 6 * 60 * 60 * 1000,
    maxBackoffMs: 24 * 60 * 60 * 1000, jitter: 0.2});
  const parent = () => requester && !requester.isDestroyed() ? requester : undefined;
  const show = options => {
    const window = parent();
    return !disposed && window ? dialog.show(window, options) : Promise.resolve({response: options.cancelId ?? 0});
  };
  const failure = state => show({type: 'error', title: language().messages.updateFailedTitle,
    message: official.desktopUpdateErrorSummary(state, language().messages)});
  const check = async (manual = false) => {
    if (disposed) throw new Error('Project updates are closed');
    if (manual && !['downloading', 'verifying', 'ready', 'installing'].includes(current.phase)) publish({phase: 'checking'});
    const state = await schedule.check(manual);
    if (manual) publish(state);
    return state;
  };
  const offerInstall = async () => {
    if (!parent() || disposed) return;
    const {messages: t, id} = language();
    const target = coordinator.state.version;
    const ready = official.desktopUpdateReadyConfirmation(t, target ?? '', platform);
    // Our published macOS payload is a DMG, so opening it must not promise an automatic restart.
    const mac = platform === 'darwin';
    const response = await show({type: 'info', title: productName + (id === 'zh' ? ' 更新' : ' Update'),
      message: ready.message,
      detail: mac ? (id === 'zh' ? `打开磁盘映像后，将 ${productName} 拖入“应用程序”完成安装。替换应用前请退出当前应用。`
        : `Open the disk image and drag ${productName} into Applications. Quit the running app before replacing it.`) : ready.detail,
      buttons: [mac ? (id === 'zh' ? '打开安装包' : 'Open installer') : t.installAndRestart, t.updateLater], defaultId: 1, cancelId: 1});
    if (response.response !== 0 || !parent() || disposed) return;
    publish({phase: 'installing', version: target});
    try {
      const artifact = await backend.verifiedArtifact();
      if (disposed) return;
      await installArtifact(artifact.path);
      publish({phase: 'ready', version: target});
    } catch {
      const state = publish({phase: 'error', version: target, failedOperation: 'install'});
      await failure(state);
    }
  };
  const open = (window, manual = false, preferredLocale = locale()) => {
    if (disposed) return Promise.reject(new Error('Project updates are closed'));
    if (operation) {parent()?.show(); dialog.focus(); return operation}
    requester = window ?? getWindow(); requestLocale = preferredLocale; promptCancelled = false;
    operation = Promise.resolve().then(async () => {
      let state = current;
      if (['downloading', 'verifying', 'installing'].includes(state.phase)) return;
      if (state.phase === 'ready' || (state.phase === 'error' && state.failedOperation === 'install')) {await offerInstall(); return}
      if (manual || state.phase === 'idle' || state.phase === 'checking' || (state.phase === 'error' && state.failedOperation === 'check')) {
        const t = language().messages;
        const controller = new AbortController(); checking = controller;
        let cancelled = false;
        const progress = show({title: t.updateCheckTitle, message: t.updateChecking, buttons: [t.updateLater], cancelId: 0,
          signal: controller.signal}).then(() => {if (!controller.signal.aborted) cancelled = true});
        try {state = await check(true)} finally {controller.abort(); await progress; checking = undefined}
        if (cancelled || promptCancelled || !parent() || disposed) return;
      }
      const t = language().messages;
      if (state.phase === 'idle') {
        await show({title: t.updateCheckTitle, message: t.updateCurrent,
          detail: official.formatDesktopMessage(t.updateCurrentDetail, {version})}); return;
      }
      if (state.phase === 'error' && state.failedOperation !== 'download') {await failure(state); return}
      if (state.phase !== 'available' && state.failedOperation !== 'download') return;
      if (manual) {
        const result = await show({title: t.updateCheckTitle,
          message: official.formatDesktopMessage(t.updateAvailable, {version: state.version ?? ''}), detail: t.updateDetail,
          buttons: [t.updateDownload, t.updateLater], cancelId: 1});
        if (result.response !== 0 || !parent() || disposed) return;
      }
      state = await coordinator.download(state.version);
      if (state.phase === 'error') await failure(state);
      else if (state.phase === 'ready') await offerInstall();
    }).catch(async () => {
      if (!disposed) await failure(publish({phase: 'error', failedOperation: 'check'}));
    }).finally(() => {operation = undefined; requester = undefined; requestLocale = undefined});
    return operation;
  };
  const automaticCheck = () => {if (!disposed) void check().catch(() => {})};
  const timer = automatic ? setTimeout(automaticCheck, 60000) : undefined;
  if (automatic) electron.powerMonitor.on('resume', automaticCheck);
  return {
    open, check,
    get state() {return current},
    presentation: () => official.presentDesktopUpdate(current),
    input: window => overlays.input(window),
    attach(window) {
      windows.add(window);
      return () => {
        windows.delete(window);
        // Official Desktop quits as a whole; our individual project close must
        // explicitly settle its non-modal child prompt before destroying the parent.
        if (requester === window) {promptCancelled = true; checking?.abort(); dialog.cancel()}
      };
    },
    cancelPrompt() {promptCancelled = true; checking?.abort(); dialog.cancel()},
    dispose() {
      if (disposed) return;
      disposed = true; clearTimeout(timer); schedule.dispose(); backend.dispose(); coordinator.dispose(); dialog.dispose();
      windows.clear(); electron.powerMonitor.off('resume', automaticCheck);
      electron.session.defaultSession.protocol.unhandle('dsh-app');
    },
  };
}
