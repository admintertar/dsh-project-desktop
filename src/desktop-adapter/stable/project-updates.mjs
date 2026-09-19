import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {loadDesktop} from './modules.mjs';
import {createProjectReleaseFeed, releasesPage} from './project-release-feed.mjs';
import {productName, productVersion} from '../../app/product.mjs';

const brand = text => text.replaceAll('DSH Desktop', productName);

/** Application-owned adapter for the unmodified official update lifecycle.
 * Native confirmation/save/install/cleanup follows electron-runtime.ts; those
 * private instance methods cannot own our multiple project windows or shutdown.
 */
export async function createProjectUpdates(electron, {userData, locale, getWindow, changed = () => {}, install,
  request = (url, init) => electron.net.fetch(url, init), policy = {}, packaged = electron.app.isPackaged,
  openPath = path => electron.shell.openPath(path), notify} = {}) {
  const {startDesktopUpdateLifecycle} = await loadDesktop('update-lifecycle');
  const {downloadDesktopUpdate, recordDesktopUpdateArtifact, pendingDesktopUpdateArtifact, resolveDesktopUpdateArtifact} = await loadDesktop('update-download');
  const {showDesktopMessageBox} = await loadDesktop('desktop-dialog-window');
  const {desktopNativeCopy} = await loadDesktop('native-dialog-copy');
  const platform = process.platform;
  const feed = createProjectReleaseFeed({request, platform});
  let registration, manual, requester, requestLocale, disposed = false, closing = false, cleanup, downloadController;
  const language = () => requestLocale ?? locale();
  const owner = () => requester && !requester.isDestroyed() ? requester : getWindow?.();
  const copy = () => Object.fromEntries(Object.entries(desktopNativeCopy(language())).map(([key, value]) =>
    [key, typeof value === 'function' ? (...args) => brand(value(...args)) : brand(value)]));
  const show = options => showDesktopMessageBox(options, owner());
  async function failure() {
    if (disposed) return;
    const t = copy();
    const result = await show({type: 'warning', title: language() === 'zh' ? '更新未完成' : 'Update not completed',
      message: language() === 'zh' ? '无法下载或打开更新安装包。' : 'The update installer could not be downloaded or opened.',
      detail: t.tryAgainLater, buttons: [language() === 'zh' ? '查看发布页面' : 'View releases', t.ok], defaultId: 1, cancelId: 1, noLink: true});
    if (result.response === 0 && !disposed) await electron.shell.openExternal(releasesPage);
  }
  const adapter = {
    isPackaged: packaged, canDownload: packaged && (platform === 'darwin' || (platform === 'win32' && process.arch === 'x64')),
    currentVersion: productVersion, releaseChannel: 'stable', statePath: join(userData, 'updates', 'state.json'),
    request: feed.versionRequest,
    async confirmDownload(version) {
      if (closing || disposed) return false;
      const t = copy();
      return (await show({type: 'info', title: t.updateAvailableTitle, message: t.updateAvailableMessage(version),
        detail: t.downloadUpdate, buttons: [t.download, t.later], defaultId: 1, cancelId: 1, noLink: true})).response === 0;
    },
    async showManualCheckResult(result) {
      if (closing || disposed) return;
      const t = copy();
      await show({type: result === null ? 'warning' : 'info',
        title: result === null ? t.updateCheckFailedTitle : result.status === 'up-to-date' ? t.upToDateTitle : t.updateAvailableTitle,
        message: result === null ? t.updateCheckFailedMessage : result.status === 'up-to-date' ? t.upToDateMessage : t.updateAvailableMessage(result.latestVersion),
        detail: result === null ? t.tryAgainLater : result.status === 'up-to-date' ? t.installedVersion(result.currentVersion) : t.installerUnavailable,
        buttons: [t.ok], defaultId: 0, noLink: true});
    },
    async downloadAndOpen(version, signal) {
      if (closing || disposed) return;
      downloadController = new AbortController();
      signal = AbortSignal.any([signal, downloadController.signal]);
      try {
        const t = copy();
        const filename = `DSH-Project-Desktop-${version}-${platform === 'darwin' ? 'mac-universal.dmg' : 'win-x64-Setup.exe'}`;
        const options = {title: t.saveInstallerTitle, defaultPath: join(electron.app.getPath('downloads'), filename),
          buttonLabel: t.saveAndDownload, filters: [{name: platform === 'darwin' ? t.diskImage : t.windowsInstaller, extensions: [platform === 'darwin' ? 'dmg' : 'exe']}],
          properties: ['createDirectory', 'showOverwriteConfirmation', 'dontAddToRecent']};
        const window = owner();
        const destination = await (window ? electron.dialog.showSaveDialog(window, options) : electron.dialog.showSaveDialog(options));
        if (destination.canceled || !destination.filePath || disposed || closing) return;
        signal.throwIfAborted();
        const path = await downloadDesktopUpdate({platform, version, destinationPath: destination.filePath, request: feed.downloadRequest, signal});
        signal.throwIfAborted();
        await recordDesktopUpdateArtifact(userData, {platform, version, path});
        if (platform === 'darwin') {
          const error = await openPath(path); if (error) throw new Error('Installer could not be opened');
          signal.throwIfAborted();
          await show({type: 'info', title: t.updateDownloadedTitle, message: t.updateReady(version), detail: t.macInstallInstructions,
            buttons: [t.ok], defaultId: 0, noLink: true});
        } else {
          const result = await show({type: 'info', title: t.updateDownloadedTitle, message: t.updateReady(version),
            detail: language() === 'zh' ? '将关闭所有项目并运行安装程序。已保存的项目会在下次启动时恢复。便携版也可从发布页面下载 ZIP 后手动替换。'
              : 'All projects will close before the installer runs. Saved projects will reopen next time. Portable users can also download a ZIP from the release page and replace it manually.',
            buttons: [t.restartAndInstall, t.later], defaultId: 1, cancelId: 1, noLink: true});
          if (result.response !== 0 || disposed) return;
          signal.throwIfAborted();
          await install(() => launchWindowsInstaller(path));
        }
      } catch (error) {
        if (!signal.aborted && !disposed) await failure();
      } finally {downloadController = undefined}
    },
    notify(value) {
      if (closing || disposed) return;
      changed();
      const message = {title: brand(value.title), body: brand(value.body)};
      if (notify) return notify(message);
      if (!electron.Notification.isSupported()) return;
      const notification = new electron.Notification(message);
      notification.once('click', () => {const window = getWindow?.(); window?.show(); window?.focus(); void service.checkNow(window)});
      notification.show();
    },
  };
  const lifecycle = startDesktopUpdateLifecycle({adapter,
    policy: {enabled: true, initialDelayMs: 60000, intervalMs: 6 * 60 * 60 * 1000, requestTimeoutMs: 15000, ...policy}, locale: language,
    registerTrayItem(item) {registration = item; return {refresh: changed, dispose() {registration = undefined; changed()}}},
  });
  const service = {
    label: () => registration ? brand(registration.label()) : (locale() === 'zh' ? '检查更新…' : 'Check for Updates…'),
    get busy() {return Boolean(manual)},
    checkNow(window) {
      if (disposed || closing) return Promise.reject(new Error('Application is closing'));
      if (manual) return manual;
      requester = window; requestLocale = locale();
      manual = lifecycle.checkNow().finally(() => {manual = undefined; requester = undefined; requestLocale = undefined; changed()});
      changed(); return manual;
    },
    prepareToQuit() {closing = true; downloadController?.abort()},
    resumeAfterQuit() {closing = false; changed()},
    showFailure: failure,
    offerCleanup() {
      if (cleanup) return cleanup;
      cleanup = (async () => {
        if (!adapter.canDownload) return;
        const artifact = await pendingDesktopUpdateArtifact(userData, productVersion, platform);
        if (!artifact || disposed) return;
        const t = copy();
        const result = await show({type: 'question', title: t.removeInstallerTitle, message: t.updateInstalled(artifact.version),
          detail: t.removeInstallerQuestion(artifact.path), buttons: [t.deleteInstaller, t.keepInstaller], defaultId: 1, cancelId: 1, noLink: true});
        if (!disposed) await resolveDesktopUpdateArtifact(userData, artifact, result.response === 0);
      })().catch(error => console.error('Update installer cleanup:', error.message));
      return cleanup;
    },
    async dispose() {disposed = true; await lifecycle.dispose()},
  };
  return service;
}

/** Official electron-runtime.ts installer flags and visible NSIS launch, after all project Hosts stop. */
export async function launchWindowsInstaller(path) {
  await new Promise((resolve, reject) => {
    const child = spawn(path, ['--updated', '--force-run'], {detached: true, stdio: 'ignore', shell: false, windowsHide: false});
    child.once('error', reject);
    child.once('spawn', () => {child.off('error', reject); child.on('error', error => console.error('Update installer:', error.message)); child.unref(); resolve()});
  });
}
