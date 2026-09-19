import {dirname, join} from 'node:path';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {loadDesktop, desktopRequire} from './modules.mjs';

export function canInitializeBundledLock(profileDir) {
  if (existsSync(join(profileDir, 'pnpm-lock.yaml'))) return false;
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  const dependencies = manifest.dependencies ?? {};
  const development = manifest.devDependencies ?? {};
  const projectLinks = [dependencies['dsh-plugin-project'], development['dsh-plugin-project']].filter(Boolean);
  return projectLinks.length === 1 && projectLinks[0] === 'link:./.project-plugin'
    && Object.keys(dependencies).every(key => key === 'dsh-plugin-project')
    && Object.keys(development).every(key => key === 'dsh-plugin-project')
    && ['optionalDependencies', 'peerDependencies'].every(key => Object.keys(manifest[key] ?? {}).length === 0);
}

/** Run the bundled package manager; keep its process-tree timeout and bounded diagnostics. */
export async function materializeProjectDependencies({stateDirectory, homeDir, profileDir, updateLockfile = false, cleanStore = false, timeoutMs}) {
  const {installDesktopPnpmRuntime} = await loadDesktop('desktop-runtime-environment');
  const {materializeProfile, formatProfileMaterializationFailure} = await loadDesktop('profile-materializer');
  const {maskSecrets} = await loadDesktop('mask-secrets');
  const pnpmBinPath = join(dirname(desktopRequire.resolve('pnpm')), 'bin/pnpm.mjs');
  const electronVersion = JSON.parse(readFileSync(desktopRequire.resolve('electron/package.json'), 'utf8')).version;
  const runtime = installDesktopPnpmRuntime({platform: process.platform, appExecutable: process.execPath,
    pnpmBinPath, electronVersion, stateDir: join(stateDirectory, 'recovery-commands'), environment: {...process.env}});
  let store;
  try {
    if (cleanStore) {
      mkdirSync(join(stateDirectory, 'rebuild-stores'), {recursive: true, mode: 0o700});
      store = mkdtempSync(join(stateDirectory, 'rebuild-stores/fresh-'));
    }
    return await materializeProfile({appExecutable: process.execPath, pnpmBinPath, electronVersion,
      clearEnvironmentPath: runtime.clearEnvironmentPath, nodeBinDir: runtime.nodeBinDir,
      nodeShimPath: runtime.nodeShimPath, homeDir, profileDir, updateLockfile, timeoutMs,
      // Use the official embedder seam to add CLI policy; no shared pnpm configuration changes.
      ...(store ? {spawn: (executable, args, options) => spawn(executable,
        [...args, '--store-dir', store, '--force', '--package-import-method=copy'], options)} : {})});
  } catch (cause) {
    throw new Error(maskSecrets(formatProfileMaterializationFailure(cause)), {cause});
  } finally {runtime.dispose(); if (store) rmSync(store, {recursive: true, force: true})}
}
