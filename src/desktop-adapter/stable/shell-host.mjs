import {join} from 'node:path';
import {loadDesktop, loadDependency} from './modules.mjs';
import {repository, lock} from '../paths.mjs';
import {readProjectAgentInstructions} from '../../app/project-agent.mjs';

const {desktopRendererUrl, Config} = await loadDesktop('index');
const {handleRendererBootRequest, RENDERER_BOOT_REPORT_PATH} = await loadDesktop('renderer-boot');
const {effectiveDesktopWindowMaterial} = await loadDesktop('window-material');
const {default: z} = await loadDependency('@deepseek-ai/schemastery');
export {Config};
export const name = 'project-desktop-shell';
export const inject = ['webServer', 'webRuntime', 'appExit', 'settings', 'connection', 'desktopRuntime', 'systemPrompt'];

export function apply(ctx, config) {
  const runtime = ctx.desktopRuntime;
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
  // Market choice belongs to this project's Profile and is consumed before the next Host starts.
  ctx.settings.register('dsh-project-market', z.object({
    provider: z.union(['disabled', 'dsh-market']).default('dsh-market'),
  }), {applies: 'restart'});
  const material = effectiveDesktopWindowMaterial('advanced', runtime.platform, config.macosMaterial, config.windowsMaterial, runtime.windowsBuild);
  const url = desktopRendererUrl(ctx.webServer.port, 'advanced', runtime.platform, lock.desktop.version, material, runtime.windowsBuild)
    + (process.env.DSH_PROJECT_SAFE_MODE === '1' ? '&projectSafeMode=1' : '');
  ctx.effect(() => ctx.webServer.register({kind: 'exact', path: RENDERER_BOOT_REPORT_PATH, handler(req, res) {
    const rejected = ctx.connection.requestRejection(req);
    if (rejected !== undefined) {res.writeHead(rejected); res.end(); return}
    return handleRendererBootRequest(req, res, new URL(url).origin, report => runtime.reportRendererBoot(report));
  }}), 'project-desktop: official renderer boot report');
  ctx.on('settings/updated', (namespace, next) => {
    if (namespace === 'locale') runtime.setLocalePreference(next.preference);
  });
  ctx.effect(() => runtime.schedule({...config, mode: 'advanced', material, url,
    authenticationUrl: ctx.connection.authenticatedUrl(new URL(url).origin),
    rendererAccessHeader: ctx.desktopBrowserAccess.rendererHeader,
    productName: 'DSH Project Desktop', windowTitle: 'DSH Project Desktop',
    iconPath,
    trayIcons: {templatePath: join(trayRoot, 'tray-iconTemplate.png'), bluePath: join(trayRoot, 'tray-icon-blue.png')},
    readLocalePreference: () => ctx.settings.get('locale')?.preference,
    readThemeSource: () => ctx.settings.get('ui-theme').preference,
    requestQuit: code => ctx.appExit(code),
    requestModeChange: async () => {throw new Error('Project Desktop only supports project windows')},
  }), 'project-desktop: native project window');
}
