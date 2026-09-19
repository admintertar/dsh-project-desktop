import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {loadDesktop} from './modules.mjs';

/** The caller must own a confirmed-stopped project before resetting this tree. */
export async function prepareSafeMode(stateDirectory) {
  const {resetDesktopSafeModeEnvironment, cleanupDesktopSafeModeEnvironment} = await loadDesktop('safe-mode');
  const paths = resetDesktopSafeModeEnvironment(stateDirectory);
  const projectRoot = join(paths.rootDir, 'workspace');
  mkdirSync(projectRoot, {mode: 0o700});
  const manifestPath = join(projectRoot, 'Safe Mode.agent-project');
  writeFileSync(manifestPath, 'name: Safe Mode\n', {flag: 'wx', mode: 0o600});
  return {safeMode: true, manifestPath, projectRoot, stateDirectory: paths.userDataDir, homeDir: paths.homeDir,
    partition: `project-safe-${randomUUID()}`,
    cleanup: () => cleanupDesktopSafeModeEnvironment(stateDirectory)};
}

export async function cleanupSafeMode(stateDirectory) {
  const {cleanupDesktopSafeModeEnvironment} = await loadDesktop('safe-mode');
  return cleanupDesktopSafeModeEnvironment(stateDirectory);
}

/** Allow only process essentials. Do not inherit API keys, proxies, npm hooks or DSH overrides. */
export function safeHostEnvironment(environment) {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'LANG', 'LC_ALL'];
  return Object.fromEntries(names.filter(name => typeof environment[name] === 'string').map(name => [name, environment[name]]));
}
