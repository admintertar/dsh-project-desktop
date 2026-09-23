import {join} from 'node:path';
import {loadDesktop, loadDependency} from './modules.mjs';
import {repository} from '../paths.mjs';
import {readProjectAgentInstructions} from '../../app/project-agent.mjs';
import {productVersion} from '../../app/product.mjs';
import {installRevealAdapter} from './windows-reveal.mjs';
import {hostTrace} from '../../app/boot-log.mjs';

const {desktopRendererUrl, Config} = await loadDesktop('index');
const {handleRendererBootRequest, RENDERER_BOOT_REPORT_PATH} = await loadDesktop('renderer-boot');
const {effectiveDesktopWindowMaterial} = await loadDesktop('window-material');
const {default: z} = await loadDependency('@deepseek-ai/schemastery');
export {Config};
export const name = 'project-desktop-shell';
export const inject = ['webServer', 'webRuntime', 'appExit', 'settings', 'connection', 'desktopRuntime', 'systemPrompt'];

// The pinned index.ts desktopLocalePreference helper is private. Keep the same
// narrowing before crossing the native bridge; system/custom locales use fallback.
const desktopLocalePreference = value => value === 'zh' || value === 'en' ? value : undefined;

export function apply(ctx, config) {
  const runtime = ctx.desktopRuntime;
  // Windows: the pinned official reveal runs explorer.exe through a runner that hides every
  // native command's window, so the revealed Explorer window is created hidden and the click
  // looks like it did nothing. Replace that one call, and only on Windows — Finder and the
  // Linux openers are correct as they are. `revealPath` is an official internal, so a missing
  // field is reported rather than silently leaving the broken behaviour in place.
  ctx.inject(['sessionController'], sessionCtx => {
    const trace = hostTrace('shell-host');
    const installed = installRevealAdapter(sessionCtx.sessionController, {
      report: message => console.error(`Project reveal adapter: ${message}`),
    });
    trace?.event('windows reveal adapter', installed ? 'installed' : 'not applicable on this platform');
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
  // Product policy is validated by the real settings service before persistence.
  ctx.settings.register('dsh-desktop', z.object({
    mode: z.const('advanced').default('advanced'),
    port: z.const(0).default(0), openBrowser: z.const(false).default(false),
    networkExposure: z.const('loopback').default('loopback'),
    macosMaterial: z.union(['off', 'transparent']).default('transparent'),
    windowsMaterial: z.union(['off', 'acrylic', 'mica']).default('off'),
    logLevel: z.union(['debug', 'info', 'warn', 'error']).default('info'),
  }), {applies: 'restart'});
  // Market choice is shared within this project's Home and consumed before the next Host starts.
  ctx.settings.register('dsh-project-market', z.object({
    provider: z.union(['disabled', 'dsh-market']).default('dsh-market'),
  }), {applies: 'restart'});
  const material = effectiveDesktopWindowMaterial('advanced', runtime.platform, config.macosMaterial, config.windowsMaterial, runtime.windowsBuild);
  const url = desktopRendererUrl(ctx.webServer.port, 'advanced', runtime.platform, productVersion, material, runtime.windowsBuild)
    + (process.env.DSH_PROJECT_SAFE_MODE === '1' ? '&projectSafeMode=1' : '');
  ctx.effect(() => ctx.webServer.register({kind: 'exact', path: RENDERER_BOOT_REPORT_PATH, handler(req, res) {
    const rejected = ctx.connection.requestRejection(req);
    if (rejected !== undefined) {res.writeHead(rejected); res.end(); return}
    return handleRendererBootRequest(req, res, new URL(url).origin, report => runtime.reportRendererBoot(report));
  }}), 'project-desktop: official renderer boot report');
  ctx.on('settings/updated', (namespace, next) => {
    if (namespace === 'locale') runtime.setLocalePreference(desktopLocalePreference(next.preference));
  });
  // Adapt the official desktop-shell material watcher: save first, then ask the native runtime.
  // A cancelled restart leaves settings saved; unrelated live settings must not reopen the prompt.
  ctx.effect(() => {
    let previous = material, pending;
    const stop = ctx.on('settings/updated', (namespace, next) => {
      if (namespace !== 'dsh-desktop') return;
      const selected = effectiveDesktopWindowMaterial('advanced', runtime.platform, next.macosMaterial, next.windowsMaterial, runtime.windowsBuild);
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
  ctx.effect(() => runtime.schedule({...config, mode: 'advanced', material, url,
    authenticationUrl: ctx.connection.authenticatedUrl(new URL(url).origin),
    rendererAccessHeader: ctx.desktopBrowserAccess.rendererHeader,
    productName: 'DSH Project Desktop', windowTitle: 'DSH Project Desktop',
    iconPath,
    trayIcons: {templatePath: join(trayRoot, 'tray-iconTemplate.png'), bluePath: join(trayRoot, 'tray-icon-blue.png')},
    readLocalePreference: () => desktopLocalePreference(ctx.settings.get('locale')?.preference),
    readThemeSource: () => ctx.settings.get('ui-theme').preference,
    requestQuit: code => ctx.appExit(code),
    requestModeChange: async () => {throw new Error('Project Desktop only supports project windows')},
  }), 'project-desktop: native project window');
}
