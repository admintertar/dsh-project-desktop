import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadDesktop} from './modules.mjs';
import {canInitializeBundledLock, materializeProjectDependencies} from './materialize.mjs';
import {lock} from '../paths.mjs';

async function checkpoint(stateDirectory) {
  const homeDir = join(stateDirectory, 'dsh');
  const profileDir = join(homeDir, 'profiles/desktop');
  if (!existsSync(profileDir)) return;
  const {createDesktopProfileCheckpoint} = await loadDesktop('profile-checkpoint');
  return createDesktopProfileCheckpoint({userDataDir: stateDirectory, homeDir, profileDir,
    profileName: 'desktop', provider: 'disabled', appVersion: lock.desktop.version,
    desktopPackageName: 'dsh-project-desktop', releaseChannel: 'stable', dshVersion: lock.harness.version});
}

/** Called only after both the Host and the official advanced client report healthy. */
export async function captureProjectCheckpoint(stateDirectory) {
  return (await checkpoint(stateDirectory))?.captureHealthy();
}

/** Pre-Host recovery: caller holds the project's exclusive stopped ownership. */
export async function createProjectRecovery({stateDirectory, manifestPath, materialize}) {
  const unavailable = () => {throw new Error('No healthy checkpoint is available for this project')};
  if (!existsSync(join(stateDirectory, 'project-desktop.json'))) return {list: () => [], preview: unavailable, restore: unavailable, dispose() {}};
  const marker = JSON.parse(readFileSync(join(stateDirectory, 'project-desktop.json'), 'utf8'));
  if (marker.schemaVersion !== 1 || marker.manifestPath !== manifestPath) throw new Error('Recovery state belongs to another project');
  const store = await checkpoint(stateDirectory);
  if (!store) return {list: () => [], preview: unavailable, restore: unavailable, dispose() {}};
  const {DesktopStartupRecoveryController} = await loadDesktop('startup-recovery-controller');
  const generationId = randomUUID();
  let disposed = false;
  const controller = new DesktopStartupRecoveryController({
    pluginState: {profileName: 'desktop', homeDir: store.homeDir, statePath: join(stateDirectory, 'plugin-management/state.json')},
    generationId, currentGeneration: () => ({profileName: 'desktop', generationId: disposed ? 'disposed-generation' : generationId}),
    checkpoints: store,
    uninstallPlugin: async () => {throw new Error('Plugin removal is not exposed by this recovery surface')},
    openCheckpointDirectory: async () => {},
    async afterCheckpointRestore(result) {
      if (!result.dependencyMaterializationRequired) return;
      if (materialize) return materialize(result);
      // Early healthy checkpoints predate lockfile creation and contain only our bundled link.
      await materializeProjectDependencies({stateDirectory, homeDir: store.homeDir, profileDir: store.profileDir,
        cleanStore: true, updateLockfile: canInitializeBundledLock(store.profileDir)});
    },
  });
  const previews = new Map();
  return {
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
      const slot = previews.get(id);
      previews.delete(id);
      // An interrupted restore or failed dependency rebuild must never boot partial state.
      const pending = join(stateDirectory, 'project-recovery-pending.json');
      writeFileSync(pending + '.tmp', JSON.stringify({version: 1, slot}) + '\n', {mode: 0o600});
      renameSync(pending + '.tmp', pending);
      let result;
      try {result = await controller.executeCheckpointRestore(id)}
      catch (error) {error.message = await describeProjectError(error); throw error}
      unlinkSync(pending);
      return result;
    },
    dispose() {disposed = true; previews.clear(); controller.dispose()},
  };
}

export function assertProjectRecoveryComplete(stateDirectory) {
  if (existsSync(join(stateDirectory, 'project-recovery-pending.json'))) {
    throw new Error('Project recovery is incomplete. Select and restore a healthy checkpoint before reopening.');
  }
}

export async function describeProjectError(error) {
  const {maskSecrets} = await loadDesktop('mask-secrets');
  return maskSecrets([error.message ?? String(error), error.diagnosticDetail].filter(Boolean).join('\n\n')).slice(0, 12000);
}
