import {loadDesktop, loadDependency} from './modules.mjs';

/**
 * Expose only the immutable active Profile identity consumed by dsh-market's
 * documented Desktop package-operation bridge. This is deliberately not a
 * Profile manager: the main process owns the project's native Profile chooser.
 */
export function createProjectMarketProfileIdentity(profile) {
  if (typeof profile?.name !== 'string' || typeof profile?.dir !== 'string') {
    throw new Error('Project market Profile identity is unavailable');
  }
  return Object.freeze({current: Object.freeze({name: profile.name, dir: profile.dir})});
}

/** Own composition: omit Desktop Profile/market/update controllers entirely. */
export async function bootProjectHost(options, runtime, browser, lan, bindHost, quit) {
  const {boot} = await loadDependency('@deepseek-ai/dsh-app-boot');
  const {provideCmdline} = await loadDependency('@deepseek-ai/dsh-cmdline');
  const {DSH_LAUNCH_ENVIRONMENT_KEY} = await loadDependency('@deepseek-ai/dsh-launch-environment');
  const {installProfilePackageResolver} = await loadDesktop('module-resolution');
  const {DesktopActionsService} = await loadDesktop('desktop-actions');
  const {LogFileSink} = await loadDesktop('log-files');
  const {FileExporter} = await loadDesktop('file-exporter');
  const release = installProfilePackageResolver(options.prepared.bareModuleBaseUrl);
  const sink = new LogFileSink(options.logDirectory, {maxFileBytes: 10 * 1024 * 1024, maxDirectoryBytes: 200 * 1024 * 1024});
  const fileExporter = new FileExporter(sink);
  try {
    const host = await boot('dsh-project-desktop', options.prepared.rootConfig, options.prepared.patches, async ctx => {
      ctx.loader.internal = undefined;
      bindHost(ctx);
      ctx.effect(() => () => sink.close(), 'project-desktop: log sink');
      ctx.effect(() => release, 'project-desktop: profile resolver');
      ctx.logger.exporter(fileExporter);
      ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.desktopLaunchEnvironment);
      ctx.provide('desktopBrowserAccess', browser);
      ctx.provide('desktopLanHttps', lan);
      ctx.provide('desktopRuntime', runtime);
      ctx.provide('desktopPnpmBootstrap', options.desktopPnpmBootstrap);
      // dsh-market feature-detects this read-only identity before choosing
      // Desktop's recoverable pnpm service instead of spawning a bare `dsh`.
      ctx.provide('desktopProfiles', createProjectMarketProfileIdentity(options.prepared.profile));
      await ctx.plugin(DesktopActionsService, {openTerminal: () => runtime.openTerminal(), requestRestart: () => runtime.requestRestart()});
      provideCmdline(ctx, {args: ['--port', String(options.prepared.port)], exit: quit});
    }, options.prepared.bareModuleBaseUrl);
    bindHost(host);
    fileExporter.setThreshold(host.settings.get('dsh-desktop')?.logLevel ?? 'info');
    host.on('settings/updated', (namespace, next) => {
      if (namespace === 'dsh-desktop') fileExporter.setThreshold(next.logLevel);
    });
  } catch (error) {release(); sink.close(); throw error}
}
