// Only the adapter imports pinned Desktop implementation modules.
import {applyAdvancedShell, desktopWindowService, provideDesktopWindow, parseDesktopClientEnvironment,
  startRendererBootReporter} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/index.ts';
import {installSidebarFooterStyles} from '../../../.upstream/desktop/dsh-plugin-desktop/src/client/sidebar-footer-styles.ts';
import * as models from './models-client';
import {applyProjectSettings} from './settings-client';
import {applyShellTitlebar} from './shell-titlebar-client';
export const inject = ['slots', 'locale', 'connection', 'remote', 'configForms', 'sessions', 'theme', 'uiRenderer'];
export async function apply(ctx: any) {
  const environment = parseDesktopClientEnvironment(window.location.search);
  if (!environment || environment.mode !== 'advanced') throw new Error('Project Desktop requires advanced');
  ctx.effect(() => provideDesktopWindow(ctx, desktopWindowService(environment)), 'project-desktop: window geometry');
  ctx.effect(() => installSidebarFooterStyles(), 'project-desktop: official footer layout');
  ctx.effect(() => startRendererBootReporter(ctx.loader), 'project-desktop: renderer boot reporter');
  // The account plugin treats Desktop's preload bridge as a promise that a
  // first-run continuation slot exists. Project opens its workspace directly;
  // register that empty continuation so the upstream fallback loading screen
  // does not cover the already healthy project UI forever.
  ctx.slots.inject('onboarding.desktop.before', () => ctx.slots.register({name: 'onboarding.desktop.before'}, () => null));
  applyAdvancedShell(ctx, environment);
  // Windows/Linux never show a native menu bar on our window shape, so the project
  // commands live in a titlebar we draw ourselves (macOS keeps its system menu bar).
  applyShellTitlebar(ctx, environment);
  applyProjectSettings(ctx, environment);
  await ctx.plugin(models);
}
