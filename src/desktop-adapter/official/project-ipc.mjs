import {createOfficialWindowOwners} from './ipc-owners.mjs';

/** 官方的单窗口 IPC 按 WebContents 安装；各项目独立持有键位状态与目录对话框。 */
export function installOfficialProjectIpc(electron, services) {
  const owners = createOfficialWindowOwners();
  const platforms = new Set();
  const registrations = new Set();
  // Platform bootstrap 来自官方嵌入视图，由官方 helper 校验其主 Frame 身份。
  const bootstrap = event => {
    event.returnValue = null;
    for (const view of platforms) {
      try {event.returnValue = view.bootstrap(event); return} catch {}
    }
  };
  electron.ipcMain.on('dsh-platform:bootstrap', bootstrap);
  return {
    owners,
    register(window, context) {
      const unregister = owners.register(window, context);
      const ipc = window.webContents.ipc;
      const scope = services.createWindowIpcScope(ipc, event => owners.trusted(event));
      const handlers = [];
      const listeners = [];
      let shortcuts;
      const pending = new Set();
      const dispose = async () => {
        platforms.delete(context.platformView);
        unregister();
        if (shortcuts) {scope.run(() => shortcuts.dispose()); shortcuts = undefined}
        scope.dispose();
        for (const channel of handlers.splice(0)) ipc.removeHandler(channel);
        for (const [channel, listener] of listeners.splice(0)) ipc.removeListener(channel, listener);
        registrations.delete(dispose);
        // 先撤销新请求入口，等元数据请求及主题等单向通知完成，再允许 Host 停止。
        await Promise.allSettled([...pending]);
      };
      const track = callback => {
        const operation = Promise.resolve().then(callback);
        pending.add(operation);
        void operation.then(() => pending.delete(operation), () => pending.delete(operation));
        return operation;
      };
      const handle = (channel, callback) => {
        ipc.handle(channel, (event, ...args) => {
          owners.trusted(event);
          return track(() => callback(...args));
        });
        handlers.push(channel);
      };
      const on = (channel, callback) => {
        const listener = (event, ...args) => {
          try {owners.trusted(event)} catch {return}
          void track(() => callback(...args)).catch(context.onError);
        };
        ipc.on(channel, listener); listeners.push([channel, listener]);
      };
      try {
        const {backend, platformView, browserGuests} = context;
        const languages = electron.app.getPreferredSystemLanguages();
        shortcuts = scope.run(() => services.installDesktopShortcuts(() => window, context.stateDirectory,
          process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
          context.onMenuChanged, () => ({revision: 0, blocked: false})));
        scope.run(() => services.installDesktopDirectoryPicker(() => window));
        shortcuts.attach(window);
        browserGuests.bind(window, (guest, name) => shortcuts.attachGuest(window, guest, name));
        platforms.add(platformView);
        handle('dsh-desktop:boot', () => ({injections: context.injections, streamBaseUrl: new URL(context.hostUrl).origin}));
        handle('dsh-desktop:boot-failed', message => {
          if (typeof message !== 'string') throw new Error('Invalid Desktop boot failure');
          context.onFailure(new Error(message));
        });
        handle('dsh-desktop:locale-bootstrap', async () => ({languages, preference: await backend.readLocalePreference()}));
        handle('dsh-desktop:onboarding-api-key', async () => (await backend.read()).hasApiKey);
        handle('dsh-desktop:device-info', () => services.readDeviceInfo());
        // idle 是官方无进行中更新的状态。自动更新尚未接入；点击给出明确失败，不安装官方产品覆盖本壳。
        handle('dsh-desktop:updates-status', () => ({phase: 'idle'}));
        handle('dsh-desktop:updates-open', () => {throw new Error('Automatic updates are unavailable in this development Shell')});
        handle('dsh-desktop:browser-acquire', workspace => browserGuests.acquire(window.webContents, workspace));
        handle('dsh-desktop:browser-release', lease => browserGuests.release(window.webContents, lease));
        handle('dsh-platform:open', (page, bounds) => {
          if (page !== 'usage' && page !== 'top-up') throw new Error('Invalid Platform page');
          return services.withProjectSessionScope(context.sessionKey, () => platformView.open(window, page, services.platformBounds(bounds)));
        });
        handle('dsh-platform:bounds', bounds => platformView.setBounds(services.platformBounds(bounds)));
        handle('dsh-platform:close', () => platformView.close());
        on('dsh-desktop:locale-changed', value => {
          if (typeof value !== 'string') return;
          context.setLocale(services.resolveDesktopStartupLocale(value, languages).id);
          platformView.notifyLocaleChanged(); context.onMenuChanged();
        });
        on('dsh-desktop:native-theme-set', source => {
          if (['system', 'light', 'dark'].includes(source)) return context.onTheme?.(source);
        });
        on('dsh-desktop:onboarding-active', active => {
          if (typeof active !== 'boolean' || window.isDestroyed()) return;
          window.setMinimumSize(active ? 960 : 520, 600);
          const {width, height} = window.getBounds();
          if (active && width < 960) window.setSize(960, height);
        });
        registrations.add(dispose);
        return {shortcuts, dispose};
      } catch (error) {void dispose().catch(context.onError); throw error}
    },
    async dispose() {
      await Promise.all([...registrations].map(dispose => dispose()));
      electron.ipcMain.removeListener('dsh-platform:bootstrap', bootstrap);
    },
  };
}
