import {createHash, randomUUID} from 'node:crypto';
import {existsSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {loadDesktop, desktopRequire} from './modules.mjs';
import {canInitializeBundledLock, materializeProjectDependencies} from './materialize.mjs';
import {lock, runtimePackage} from '../paths.mjs';
import {assertProjectProfileOwner, profileSelectionPath} from './project-profiles.mjs';

async function checkpoint(stateDirectory, profileName = 'desktop') {
  const {assertDesktopProfileName} = await loadDesktop('profile-manager');
  assertDesktopProfileName(profileName);
  const homeDir = join(stateDirectory, 'dsh');
  const profileDir = join(homeDir, 'profiles', profileName);
  if (!existsSync(profileDir)) return;
  const {createDesktopProfileCheckpoint} = await loadDesktop('profile-checkpoint');
  return createDesktopProfileCheckpoint({userDataDir: stateDirectory, homeDir, profileDir,
    profileName, provider: 'disabled', appVersion: lock.desktop.version,
    desktopPackageName: 'dsh-project-desktop', releaseChannel: 'stable', dshVersion: lock.harness.version});
}

/** Called only after both the Host and the official advanced client report healthy. */
export async function captureProjectCheckpoint(stateDirectory, profileName = 'desktop') {
  return (await checkpoint(stateDirectory, profileName))?.captureHealthy();
}

// Keep the original desktop journal readable; other Profiles have independent repair state.
const pendingPath = (stateDirectory, profileName) => join(stateDirectory, profileName === 'desktop'
  ? 'project-recovery-pending.json'
  : `project-recovery-pending-${createHash('sha256').update(profileName).digest('hex')}.json`);

async function removePlugin({stateDirectory, profileName, homeDir, profileDir, packageName}) {
  const {installDesktopPnpmRuntime} = await loadDesktop('desktop-runtime-environment');
  const {removeRecoveryPlugin, formatRecoveryPluginRemoveFailure} = await loadDesktop('recovery-plugin-uninstall');
  const pnpmBinPath = join(dirname(desktopRequire.resolve('pnpm')), 'bin/pnpm.mjs');
  const electronVersion = JSON.parse(readFileSync(desktopRequire.resolve('electron/package.json'), 'utf8')).version;
  const runtime = installDesktopPnpmRuntime({platform: process.platform, appExecutable: process.execPath,
    pnpmBinPath, electronVersion, stateDir: join(stateDirectory, 'recovery-commands'), environment: {...process.env}});
  try {
    await removeRecoveryPlugin({appExecutable: process.execPath, dshBootstrapPath: join(runtimePackage, 'lib/desktop-cli.js'),
      profileName, homeDir, profileDir, packageName, electronVersion,
      nodeBinDir: runtime.nodeBinDir, nodeShimPath: runtime.nodeShimPath, pnpmBinDir: runtime.pathDir});
  } catch (cause) {throw new Error(await describeProjectError(new Error(formatRecoveryPluginRemoveFailure(cause))), {cause})}
  finally {runtime.dispose()}
}

/** Pre-Host recovery: caller holds the project's exclusive stopped ownership. */
export async function createProjectRecovery({stateDirectory, manifestPath, profileName = 'desktop', materialize, openDirectory}) {
  const unavailable = () => {throw new Error('No healthy checkpoint is available for this project')};
  const empty = {profileName, list: () => [], preview: unavailable, restore: unavailable, waitIdle: async () => {}, dispose() {}};
  if (!existsSync(join(stateDirectory, 'project-desktop.json'))) return empty;
  const marker = JSON.parse(readFileSync(join(stateDirectory, 'project-desktop.json'), 'utf8'));
  if (marker.schemaVersion !== 1 || marker.manifestPath !== manifestPath) throw new Error('Recovery state belongs to another project');
  let store;
  try {store = await checkpoint(stateDirectory, profileName)} catch (error) {
    // The native assistant must still offer Profile selection and diagnostics for a damaged tree.
    return {...empty, error: await describeProjectError(error)};
  }
  if (!store) return empty;
  assertProjectProfileOwner(store.profileDir, manifestPath);
  const {DesktopStartupRecoveryController} = await loadDesktop('startup-recovery-controller');
  const {readDesktopProfileState} = await loadDesktop('profile-manager');
  const generationId = randomUUID();
  let disposed = false;
  const controller = new DesktopStartupRecoveryController({
    pluginState: {profileName, homeDir: store.homeDir, statePath: join(stateDirectory, 'plugin-management/state.json')},
    generationId, currentGeneration: () => ({profileName: existsSync(profileSelectionPath(stateDirectory))
      ? readDesktopProfileState(profileSelectionPath(stateDirectory)).active : profileName,
      generationId: disposed ? 'disposed-generation' : generationId}),
    checkpoints: store,
    uninstallPlugin: packageName => removePlugin({stateDirectory, profileName, homeDir: store.homeDir, profileDir: store.profileDir, packageName}),
    openCheckpointDirectory: async path => {
      if (openDirectory) return openDirectory(path);
      throw new Error('Opening folders is unavailable outside the desktop application');
    },
    async afterCheckpointRestore(result) {
      if (!result.dependencyMaterializationRequired) return;
      if (materialize) return materialize(result);
      // Early healthy checkpoints predate lockfile creation and contain only our bundled link.
      await materializeProjectDependencies({stateDirectory, homeDir: store.homeDir, profileDir: store.profileDir,
        cleanStore: true, updateLockfile: canInitializeBundledLock(store.profileDir)});
    },
  });
  const previews = new Map();
  const pendingOperations = new Set();
  const track = action => {
    if (disposed) return Promise.reject(new Error('Recovery session expired'));
    const task = Promise.resolve().then(action);
    pendingOperations.add(task);
    void task.finally(() => pendingOperations.delete(task)).catch(() => {});
    return task;
  };
  const recovery = {
    profileName,
    list() {
      if (disposed) throw new Error('Recovery session expired');
      return store.listSlots().filter(slot => slot.snapshotExists).map(slot => ({id: slot.slotId,
        capturedAt: slot.manifest.capturedAt, version: slot.manifest.appVersion, files: slot.manifest.files.filter(file => file.present).length}));
    },
    async preview(id) {
      const preview = await controller.previewCheckpointRestore(id);
      const inspection = store.inspectSlot(id);
      previews.set(preview.previewId, id);
      return {...preview, changedFiles: inspection.changedFiles};
    },
    async restore(id) {
      if (!previews.has(id)) throw new Error('Recovery confirmation expired');
      if (disposed || (existsSync(profileSelectionPath(stateDirectory))
        && readDesktopProfileState(profileSelectionPath(stateDirectory)).active !== profileName)) {
        throw new Error('Recovery Profile changed');
      }
      const slot = previews.get(id);
      previews.delete(id);
      // An interrupted restore or failed dependency rebuild must never boot partial state.
      const pending = pendingPath(stateDirectory, profileName);
      writeFileSync(pending + '.tmp', JSON.stringify({version: 1, profileName, slot}) + '\n', {mode: 0o600});
      renameSync(pending + '.tmp', pending);
      let result;
      try {result = await controller.executeCheckpointRestore(id)}
      catch (error) {error.message = await describeProjectError(error); throw error}
      unlinkSync(pending);
      return result;
    },
    waitIdle: () => Promise.allSettled([...pendingOperations]),
    dispose() {disposed = true; previews.clear(); controller.dispose()},
  };
  // Keep the official preview/confirmation/execution contract; add only the embedder's repair journal.
  recovery.controller = {
    snapshot: () => track(() => controller.snapshot()),
    previewCheckpointRestore: id => track(() => recovery.preview(id)),
    executeCheckpointRestore: id => track(() => recovery.restore(id)),
    previewUninstall: id => track(() => controller.previewUninstall(id)),
    executeUninstall: id => track(() => controller.executeUninstall(id)),
    openCheckpoint: id => track(() => controller.openCheckpoint(id)),
  };
  return recovery;
}

export function assertProjectRecoveryComplete(stateDirectory, profileName = 'desktop') {
  if (existsSync(pendingPath(stateDirectory, profileName))) {
    throw new Error('Project recovery is incomplete. Select and restore a healthy checkpoint before reopening.');
  }
}

export async function describeProjectError(error) {
  const {maskSecrets} = await loadDesktop('mask-secrets');
  return maskSecrets([error.message ?? String(error), error.diagnosticDetail].filter(Boolean).join('\n\n')).slice(0, 12000);
}
