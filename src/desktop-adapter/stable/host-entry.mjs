import {dirname, join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {loadDesktop, loadDependency, desktopRequire} from './modules.mjs';
import {prepareProjectProfile} from './profile.mjs';
import {runtimePackage} from '../paths.mjs';
import {verifyRuntimeDependencies} from './verify.mjs';
import {bootProjectHost} from './project-bootstrap.mjs';

// The parent sets DSH_HOME/cwd before any DSH import. No process-wide switching between projects.
if (!process.send && !process.parentPort) throw new Error('Start this Host through the Project Desktop supervisor');
const {HostRpc} = await loadDesktop('host-rpc');
const {createHostRuntime} = await loadDesktop('host-runtime-bridge');
const {createDesktopBrowserAccess} = await loadDesktop('desktop-browser-access');
const {DesktopLanHttpsRuntime} = await loadDesktop('lan-https-runtime');
const {installDesktopPnpmRuntime} = await loadDesktop('desktop-runtime-environment');
const {loadLayeredEnv} = await loadDependency('@deepseek-ai/dsh-app-boot');
const {withDesktopDshHome} = await loadDesktop('launch-environment');
const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send(message);
const rpc = new HostRpc({send, listen: receive => {
  if (process.parentPort) {
    const listener = event => receive(event.data);
    process.parentPort.on('message', listener); return () => process.parentPort.off('message', listener);
  }
  process.on('message', receive); return () => process.off('message', receive);
}}, 30_000);
let host;
let lan;
let pnpm;
let starting = false;
let stopping = false;
rpc.handle('stop', async () => {
  stopping = true;
  await host?.fiber.dispose();
  await lan?.stop();
  pnpm?.dispose();
});
rpc.handle('boot', async ([request, snapshot, rendererToken]) => {
  if (starting || stopping) throw new Error('Host already started or stopped');
  starting = true;
  const launch = await prepareProjectProfile(request.manifestPath, request.stateDirectory, request);
  const {prepared, homeDir} = launch;
  const runtime = createHostRuntime(rpc, snapshot);
  // Extension of our supplied runtime; the official bridge and source stay untouched.
  runtime.workspaceWindows = {
    list: () => rpc.call('project:windows:list'), open: () => rpc.call('project:windows:open'),
    focus: id => rpc.call('project:windows:focus', [id]), presentation: async () => 'project',
  };
  const browser = createDesktopBrowserAccess(false, rendererToken);
  lan = new DesktopLanHttpsRuntime({addresses: [], requestedPort: 0, prepareCertificate: async () => ({failureCode: 'project-local-only'})});
  const pnpmBinPath = join(dirname(desktopRequire.resolve('pnpm')), 'bin/pnpm.mjs');
  const electronVersion = JSON.parse(readFileSync(desktopRequire.resolve('electron/package.json'), 'utf8')).version;
  pnpm = installDesktopPnpmRuntime({platform: process.platform, appExecutable: process.execPath,
    pnpmBinPath, electronVersion, stateDir: join(request.stateDirectory, 'commands'), environment: process.env});
  await bootProjectHost({prepared,
    desktopLaunchEnvironment: withDesktopDshHome(loadLayeredEnv('dsh-project-desktop'), homeDir),
    desktopPnpmBootstrap: {activeProfileName: prepared.profile.name, activeProfileDir: prepared.profile.dir,
      homeDir, appExecutable: process.execPath, pnpmBinPath, electronVersion,
      nodeBinDir: pnpm.nodeBinDir, nodeShimPath: pnpm.nodeShimPath, clearEnvironmentPath: pnpm.clearEnvironmentPath,
      dshBootstrapPath: join(runtimePackage, 'lib/desktop-cli.js')},
    logDirectory: join(request.stateDirectory, 'logs'),
  }, runtime, browser, lan, value => {host = value}, code => {void rpc.call('quit', [code])});
  if (stopping) {await host.fiber.dispose(); throw new Error('Host stopped during startup')}
  let applyingSharedTheme = false;
  const validateTheme = preference => {
    if (!['system', 'light', 'dark'].includes(preference)) throw new Error('Invalid theme');
  };
  host.on('settings/updated', (namespace, next, previous) => {
    if (namespace === 'ui-theme' && !applyingSharedTheme && next.preference !== previous.preference) {
      void rpc.call('project:theme:changed', [next.preference]).catch(error => host.logger.error(error));
    }
  });
  rpc.handle('project:theme:get', () => host.settings.get('ui-theme').preference);
  rpc.handle('project:theme:set', async ([preference]) => {
    validateTheme(preference);
    applyingSharedTheme = true;
    try {await host.settings.update('ui-theme', {preference})}
    finally {applyingSharedTheme = false}
  });
  rpc.handle('project:theme:select', async ([preference]) => {
    validateTheme(preference); await host.settings.update('ui-theme', {preference});
  });
  // A narrow Shell-facing API; the settings service enforces the product schema.
  rpc.handle('project:settings:update', async ([namespace, patch]) => {
    if (!['dsh-desktop', 'dsh-project-market', 'locale', 'dsh-desktop-notifications'].includes(namespace)) throw new Error('Unsupported Shell setting');
    await host.settings.update(namespace, patch);
  });
  await runtime.mountScheduled();
  const pluginRequire = request.safeMode ? undefined : createRequire(join(prepared.profile.dir, '.project-plugin/package.json'));
  const projectSessionVersion = pluginRequire ? JSON.parse(readFileSync(pluginRequire.resolve('@deepseek-ai/dsh-session/package.json'), 'utf8')).version : null;
  const profileIdentity = host.get('desktopProfiles');
  return {pid: process.pid, homeDir, profile: prepared.profile.dir, profileName: prepared.profile.name, ...verifyRuntimeDependencies(), projectSessionVersion,
    safeMode: Boolean(request.safeMode),
    tools: host.tools.schemas().map(tool => tool.name),
    policy: {
      profileManagement: typeof profileIdentity?.select === 'function',
      marketProfileIdentity: profileIdentity?.current?.name === prepared.profile.name
        && profileIdentity.current.dir === prepared.profile.dir,
      settingsController: Boolean(host.get('desktopSettingsController')),
    }};
});
process.on('disconnect', () => {process.exitCode = 1; void host?.fiber.dispose().finally(() => process.exit(1))});
send({ready: true});
