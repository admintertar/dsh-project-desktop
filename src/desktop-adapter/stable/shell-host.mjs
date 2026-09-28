import {join} from 'node:path';
import {loadDesktop, loadDependency} from './modules.mjs';
import {repository} from '../paths.mjs';
import {readProjectAgentInstructions} from '../../app/project-agent.mjs';
import {productVersion} from '../../app/product.mjs';

const {desktopRendererUrl} = await loadDesktop('index');
const {handleRendererBootRequest, RENDERER_BOOT_REPORT_PATH} = await loadDesktop('renderer-boot');
const {effectiveDesktopWindowMaterial} = await loadDesktop('window-material');
const {readUiLocalePreference, readUiThemeSource} = await loadDesktop('settings-bridge');
const {watchPlatformLogin} = await loadDesktop('platform-login');
const {default: z} = await loadDependency('@deepseek-ai/schemastery');
export const Config = z.object({
  mode: z.const('advanced').default('advanced').volatile(),
  port: z.const(0).default(0).volatile(),
  openBrowser: z.const(false).default(false).volatile(),
  networkExposure: z.const('loopback').default('loopback').volatile(),
  macosMaterial: z.union(['off', 'transparent']).default('transparent').volatile(),
  windowsMaterial: z.union(['off', 'acrylic', 'mica']).default('off').volatile(),
  linuxMaterial: z.union(['off', 'transparent']).default('off').volatile(),
  logLevel: z.union(['debug', 'info', 'warn', 'error']).default('info').volatile(),
  marketProvider: z.union(['disabled', 'dsh-market']).default('dsh-market').volatile(),
  width: z.number().step(1).min(800).default(1280),
  height: z.number().step(1).min(600).default(840),
  minWidth: z.number().step(1).min(640).default(900),
  minHeight: z.number().step(1).min(480).default(640),
});
export const name = 'project-desktop-shell';
export const inject = ['webServer', 'webRuntime', 'appExit', 'settings', 'connection', 'desktopRuntime', 'systemPrompt'];

// The pinned index.ts desktopLocalePreference helper is private. Keep the same
// narrowing before crossing the native bridge; system/custom locales use fallback.
const desktopLocalePreference = value => value === 'zh' || value === 'en' ? value : undefined;

export function apply(ctx, config) {
  const runtime = ctx.desktopRuntime;
  // Harness 0.1.7 fixes Windows reveal; retain the official controller.
  // Same watcher as Desktop index.ts; Project keeps ordinary browser access off.
  ctx.inject(['deepseekAccount'], accountCtx => {
    accountCtx.effect(() => {
      const lifetime = new AbortController();
      void watchPlatformLogin(accountCtx.get('deepseekAccount'), request => runtime.platformLogin(request),
        () => accountCtx.desktopBrowserAccess.ordinaryBrowserEnabled, lifetime.signal).catch(cause => {
        if (!lifetime.signal.aborted) accountCtx.logger.error(`Project sign-in watcher stopped: ${String(cause)}`);
      });
      return () => lifetime.abort();
    }, 'project-desktop: official platform sign-in hand-off');
  });
  ctx.systemPrompt.variable('project_agent_instructions', () => {
    const manifestPath = process.env.DSH_PROJECT_MANIFEST;
    if (!manifestPath) return '';
    try {return readProjectAgentInstructions(manifestPath);} catch (error) {
      console.error('Project AGENT.md context unavailable:', error.message);
      return '';
    }
  });
  ctx.systemPrompt.context({name: 'project-agent-instructions', order: 40, text: '{{project_agent_instructions}}'});
  // The official runtime snapshot only carries its public fields, so derive our app-owned icon in this process.
  const iconPath = join(repository, 'assets', runtime.platform === 'darwin' ? 'app-icon-mac.png' : 'app-icon.png');
  const trayRoot = join(repository, 'assets', 'tray');
  const current = () => ({mode: config.mode.get(), port: config.port.get(),
    openBrowser: config.openBrowser.get(), networkExposure: config.networkExposure.get(),
    macosMaterial: config.macosMaterial.get(), windowsMaterial: config.windowsMaterial.get(),
    linuxMaterial: config.linuxMaterial.get(), logLevel: config.logLevel.get(),
    marketProvider: config.marketProvider.get(), width: config.width, height: config.height,
    minWidth: config.minWidth, minHeight: config.minHeight});
  const startup = current();
  const material = effectiveDesktopWindowMaterial('advanced', runtime.platform, startup.macosMaterial);
  const url = desktopRendererUrl(ctx.webServer.port, 'advanced', runtime.platform, productVersion, material)
    + (process.env.DSH_PROJECT_SAFE_MODE === '1' ? '&projectSafeMode=1' : '');
  ctx.effect(() => ctx.webServer.register({kind: 'exact', path: RENDERER_BOOT_REPORT_PATH, handler(req, res) {
    const rejected = ctx.connection.requestRejection(req);
    if (rejected !== undefined) {res.writeHead(rejected); res.end(); return}
    return handleRendererBootRequest(req, res, new URL(url).origin, report => runtime.reportRendererBoot(report));
  }}), 'project-desktop: official renderer boot report');
  ctx.on('settings/document-updated', namespace => {
    if (String(namespace) === 'locale') runtime.setLocalePreference(desktopLocalePreference(readUiLocalePreference(ctx)));
  });
  // Adapt the official desktop-shell material watcher: save first, then ask the native runtime.
  // A cancelled restart leaves settings saved; unrelated live settings must not reopen the prompt.
  ctx.effect(() => {
    let previous = material, pending;
    const stop = ctx.on('loader/volatile-update', () => {
      const selected = effectiveDesktopWindowMaterial('advanced', runtime.platform, config.macosMaterial.get());
      if (selected === previous) return;
      previous = selected;
      if (pending) clearImmediate(pending);
      pending = undefined;
      if (selected !== material) pending = setImmediate(() => {
        pending = undefined;
        void runtime.requestRestart().catch(error => console.error('Project material restart:', error));
      });
    });
    return () => {stop(); if (pending) clearImmediate(pending)};
  }, 'project-desktop: confirm material restart');
  ctx.effect(() => runtime.schedule({...startup, mode: 'advanced', material, url,
    authenticationUrl: ctx.connection.authenticatedUrl(new URL(url).origin),
    rendererAccessHeader: ctx.desktopBrowserAccess.rendererHeader,
    productName: 'DSH Project Desktop', windowTitle: 'DSH Project Desktop',
    iconPath,
    trayIcons: {templatePath: join(trayRoot, 'tray-iconTemplate.png'), bluePath: join(trayRoot, 'tray-icon-blue.png')},
    readLocalePreference: () => desktopLocalePreference(readUiLocalePreference(ctx)),
    readThemeSource: () => readUiThemeSource(ctx),
    requestQuit: code => ctx.appExit(code),
    requestModeChange: async () => {throw new Error('Project Desktop only supports project windows')},
  }), 'project-desktop: native project window');
}
