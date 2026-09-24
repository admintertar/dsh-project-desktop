import {loadDesktop, loadDependency} from './modules.mjs';
import {trackPluginLoads} from './plugin-load-trace.mjs';

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

/**
 * Own composition: omit Desktop Profile/market/update controllers entirely.
 *
 * `official host boot requested` used to be a single number covering everything the official
 * `boot()` does — the Loader, the whole plugin tree and the loopback renderer server — which is
 * exactly where a slow launch spends its time: a 28 s Windows boot and a 3 s macOS boot read
 * alike. The stages below split that wait into the parts this process times itself, and the
 * plugin tree's slowest entries come back as a report for the caller to write after
 * `official host booted`, so that stage keeps the total it has always reported.
 */
export async function bootProjectHost(options, runtime, browser, lan, bindHost, quit) {
  const {trace} = options;
  const {boot} = await loadDependency('@deepseek-ai/dsh-app-boot');
  const {provideCmdline} = await loadDependency('@deepseek-ai/dsh-cmdline');
  const {DSH_LAUNCH_ENVIRONMENT_KEY} = await loadDependency('@deepseek-ai/dsh-launch-environment');
  const {installProfilePackageResolver} = await loadDesktop('module-resolution');
  const {DesktopActionsService} = await loadDesktop('desktop-actions');
  const {LogFileSink} = await loadDesktop('log-files');
  const {FileExporter} = await loadDesktop('file-exporter');
  // Resolving these modules is the first thing a cold Host does after Profile preparation, and
  // on Windows it is the half of the wait that no stage previously named.
  trace?.stage('official host modules resolved', 'app-boot, cmdline, launch-environment, log and actions modules');
  const release = installProfilePackageResolver(options.prepared.bareModuleBaseUrl);
  const sink = new LogFileSink(options.logDirectory, {maxFileBytes: 10 * 1024 * 1024, maxDirectoryBytes: 200 * 1024 * 1024});
  const fileExporter = new FileExporter(sink);
  trace?.stage('official host log sink ready');
  let loads;
  try {
    const host = await boot('dsh-project-desktop', options.prepared.rootConfig, options.prepared.patches, async ctx => {
      // Reached after the Loader is installed and before any config-tree entry mounts, so the
      // next stage is the plugin tree plus the renderer server it starts.
      trace?.stage('official loader mounted', 'plugin tree not mounted yet');
      loads = trackPluginLoads(ctx);
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
      trace?.stage('official runtime services provided');
      await ctx.plugin(DesktopActionsService, {openTerminal: () => runtime.openTerminal(), requestRestart: () => runtime.requestRestart()});
      trace?.stage('official actions service mounted');
      provideCmdline(ctx, {args: ['--port', String(options.prepared.port)], exit: quit});
      trace?.stage('official cmdline provided');
    }, options.prepared.bareModuleBaseUrl);
    bindHost(host);
    fileExporter.setThreshold(host.settings.get('dsh-desktop')?.logLevel ?? 'info');
    host.on('settings/updated', (namespace, next) => {
      if (namespace === 'dsh-desktop') fileExporter.setThreshold(next.logLevel);
    });
    return {pluginReport: loads.report()};
  } catch (error) {release(); sink.close(); throw error}
}