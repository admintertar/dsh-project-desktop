import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadDesktop} from './stable/modules.mjs';
import {lock} from './paths.mjs';
import {claimProjectState} from '../app/project-state.mjs';
import {verifyRuntimeDependencies} from './stable/verify.mjs';
import {assertProjectRecoveryComplete} from './stable/recovery.mjs';
import {safeHostEnvironment} from './stable/safe-mode.mjs';
import {projectProfiles} from './stable/project-profiles.mjs';

/** One supervisor, with Node transport for headless checks and UtilityProcess for the app. */
export async function startProjectHost({manifestPath, projectRoot, stateDirectory, homeDir = join(stateDirectory, 'dsh'), safeMode = false, nativeRuntime, spawnHost = fork, windows = {}, onUnexpectedExit}) {
  verifyRuntimeDependencies();
  claimProjectState(stateDirectory, manifestPath);
  let profileName = 'desktop';
  if (!safeMode) {
    try {profileName = (await projectProfiles({stateDirectory, manifestPath, homeDir})).startup().name}
    catch (error) {error.failureStage = 'profile-selection'; throw error}
  }
  if (!safeMode) assertProjectRecoveryComplete(stateDirectory, profileName);
  const {HostRpc} = await loadDesktop('host-rpc');
  const {bindNativeRuntime, runtimeSnapshot} = await loadDesktop('host-runtime-bridge');
  let specification;
  const contributions = new Map();
  const runtime = nativeRuntime ?? {
    platform: process.platform, locale: 'en',
    updates: {isPackaged: false, canDownload: false, currentVersion: lock.desktop.version,
      statePath: join(stateDirectory, 'updates-disabled')},
    schedule(spec) {specification = spec; return async () => {}},
    registerTrayItem(item) {const key = Symbol(); contributions.set(key, item); return {refresh() {}, dispose() {contributions.delete(key)}}},
    setLocalePreference() {}, setThemeSource() {},
  };
  const boundRuntime = {...runtime, schedule(spec) {
    specification = spec;
    return runtime.schedule(spec);
  }};
  let errors = '';
  const themeObservers = new Set();
  const child = spawnHost(fileURLToPath(new URL('./stable/host-entry.mjs', import.meta.url)), [], {
    cwd: projectRoot, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'advanced',
    env: {...(safeMode ? safeHostEnvironment(process.env) : process.env), DSH_HOME: homeDir, DSH_AGENTS_HOME: join(homeDir, 'agents'),
      DSH_TELEMETRY_DISABLED: '1', ...(safeMode ? {DSH_PROJECT_SAFE_MODE: '1'} : {DSH_PROJECT_MANIFEST: manifestPath})},
  });
  child.stderr.on('data', data => {errors = (errors + String(data)).slice(-16000)});
  child.stdout.resume();
  let rpc;
  let release;
  let stopped;
  let ready = false;
  let stopping = false;
  const exited = new Promise(resolve => child.once('exit', resolve));
  let exitObserved = false;
  child.once('exit', code => {
    exitObserved = true;
    if (ready && !stopping) onUnexpectedExit?.(new Error(`Project Host stopped (${code})${errors ? '\n' + errors : ''}`));
  });
  child.on('error', error => {errors = (errors + '\n' + error.message).slice(-16000)});
  const close = () => stopped ??= (async () => {
    stopping = true;
    if (rpc && !exitObserved) await rpc.call('stop', [], AbortSignal.timeout(5000)).catch(() => {});
    if (!exitObserved) child.kill();
    const timeout = setTimeout(() => {if (!exitObserved) child.kill('SIGKILL')}, 2000);
    let deadline;
    try {await Promise.race([exited, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Host shutdown was not confirmed')), 7000);
    })])} finally {clearTimeout(timeout); clearTimeout(deadline)}
    await release?.();
    rpc?.close('Project Host stopped');
  })().catch(error => {stopped = undefined; throw error});
  try {
    const [message] = await Promise.race([once(child, 'message', {signal: AbortSignal.timeout(30000)}),
      exited.then(() => {throw new Error('Host exited before becoming ready')})]);
    if (!message?.ready) throw new Error('Host worker did not become ready');
    rpc = new HostRpc({send: data => child.send(data), listen: receive => {
      child.on('message', receive); return () => child.off('message', receive);
    }}, 30000);
    child.once('exit', () => rpc.close(errors || 'Host exited'));
    release = bindNativeRuntime(rpc, boundRuntime);
    rpc.handle('quit', () => windows.quit?.());
    rpc.handle('project:theme:changed', ([theme]) => {
      if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Invalid theme event');
      for (const observer of themeObservers) {
        void Promise.resolve().then(() => observer(theme)).catch(error => {errors += '\nTheme synchronization: ' + error.message});
      }
    });
    rpc.handle('project:windows:list', () => windows.list?.() ?? [{id: manifestPath, title: projectRoot, current: true}]);
    rpc.handle('project:windows:open', () => windows.open?.());
    rpc.handle('project:windows:focus', ([id]) => windows.focus?.(id));
    const result = await rpc.call('boot', [{manifestPath, stateDirectory, homeDir, safeMode, profileName}, runtimeSnapshot(runtime), randomBytes(32).toString('base64url')]);
    if (!specification) throw new Error('Official Host did not register its renderer');
    const headers = {[specification.rendererAccessHeader.name]: specification.rendererAccessHeader.value};
    const auth = await fetch(specification.authenticationUrl, {headers, redirect: 'manual'});
    await auth.body?.cancel();
    if (auth.status !== 303 || !auth.headers.get('set-cookie')) throw new Error('Official renderer authentication failed');
    headers.Cookie = auth.headers.get('set-cookie').split(';')[0];
    ready = true;
    return {result, url: specification.url, specification, stateDirectory,
      async request(path, init = {}) {
        const url = new URL(path, specification.url);
        if (url.origin !== new URL(specification.url).origin) throw new Error('Request is outside this project Host');
        return fetch(url, {...init, redirect: 'error', headers: {...init.headers, ...headers}});
      },
      getTheme: () => rpc.call('project:theme:get'), setTheme: theme => rpc.call('project:theme:set', [theme]),
      selectTheme: theme => rpc.call('project:theme:select', [theme]),
      updateShellSettings: (namespace, patch) => rpc.call('project:settings:update', [namespace, patch]),
      observeTheme(observer) {themeObservers.add(observer); return () => themeObservers.delete(observer)},
      menuLabels: () => [...contributions.values()].map(item => item.label()), close};
  } catch (cause) {
    try {await close()} catch (shutdown) {
      const error = new AggregateError([cause, shutdown], 'Host failed to start and shutdown is unconfirmed');
      error.projectResource = {close}; throw error;
    }
    throw new Error(`${cause.message}${errors ? '\nHost stderr:\n' + errors : ''}`, {cause});
  }
}
