import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'yaml';
import {claimProjectState} from '../../app/project-state.mjs';
import {officialPin, projectSource} from './paths.mjs';
import {sharedAccountProfile} from './account-profile.mjs';
import {officialCredentials} from './credential-runtime.mjs';

export function verifyProjectPlugin(source = projectSource) {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  const built = JSON.parse(readFileSync(join(source, 'lib/build.json'), 'utf8'));
  if (manifest.name !== 'dsh-plugin-project' || built.sourceCommit !== officialPin.commit
    || built.harness !== officialPin.version || built.desktop !== officialPin.version
    || !existsSync(join(source, 'lib/index.js')) || !existsSync(join(source, 'lib/client.js'))) {
    throw new Error('Project plugin must be built against the pinned official Desktop');
  }
  return realpathSync(source);
}

/** 只初始化本适配器拥有的 Home；现有 Stable 数据留给独立迁移流程。 */
export async function prepareOfficialProfile({runtimeDir, stateDirectory, manifestPath, accountStore, pluginSource = projectSource}) {
  const source = verifyProjectPlugin(pluginSource);
  const homeDir = join(stateDirectory, 'dsh');
  const marker = join(homeDir, 'official-shell.json');
  if (lstatSync(homeDir, {throwIfNoEntry: false})?.isSymbolicLink()) throw new Error('Official DSH Home cannot be a symlink');
  if (existsSync(homeDir) && !existsSync(marker)) {
    throw new Error('Existing Stable project data requires migration; it has been left unchanged');
  }
  if (existsSync(marker)) {
    const owner = JSON.parse(readFileSync(marker, 'utf8'));
    if (owner.schemaVersion !== 1 || owner.manifestPath !== realpathSync(manifestPath)
      || owner.sourceCommit !== officialPin.commit) throw new Error('Official project data has a different owner or runtime version');
  }
  claimProjectState(stateDirectory, manifestPath);
  mkdirSync(homeDir, {recursive: true, mode: 0o700});
  if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({schemaVersion: 1,
    manifestPath: realpathSync(manifestPath), sourceCommit: officialPin.commit}) + '\n', {flag: 'wx', mode: 0o600});
  const profileDir = join(homeDir, 'profiles', 'desktop');
  const boot = await import(pathToFileURL(join(runtimeDir, 'dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')).href);
  const fresh = !existsSync(join(profileDir, 'package.json'));
  boot.initProfile(profileDir, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-project']);
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  if (manifest.dsh?.profile?.bundles?.some(name => ['dsh-plugin-desktop', 'dsh-project-shell'].includes(name))) {
    throw new Error('Community Desktop bundles cannot run in an official project Profile');
  }
  const patchPath = join(profileDir, 'cordis.patch.yml');
  // 每个 Host 必须使用随机 loopback 端口。已有官方 Profile 的用户配置不做隐式覆盖。
  if (fresh) writeFileSync(patchPath, '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n', {mode: 0o600});
  const patch = parse(readFileSync(patchPath, 'utf8'));
  const servers = Array.isArray(patch) ? patch.filter(item => item?.id === 'webserver') : [];
  if (servers.length !== 1 || servers[0].config?.port !== 0 || servers[0].config?.host !== '127.0.0.1') {
    throw new Error('Official project Profile requires one loopback WebServer with port 0');
  }
  if (accountStore) {
    // The Host is stopped here. Change only the provider composition; preserve
    // user configuration, YAML tags and comments, and never patch a live Profile.
    const next = sharedAccountProfile(readFileSync(patchPath, 'utf8'), new URL('./shared-credentials-host.mjs', import.meta.url).href);
    if (next !== readFileSync(patchPath, 'utf8')) {
      const {writeFileAtomic} = await officialCredentials(runtimeDir);
      await writeFileAtomic(patchPath, next, {mode: 0o600});
    }
  }
  const target = join(profileDir, 'node_modules/dsh-plugin-project');
  const link = lstatSync(target, {throwIfNoEntry: false});
  if (link && !link.isSymbolicLink()) throw new Error('Refusing to replace an existing Project plugin installation');
  if (link) {
    try {if (realpathSync(target) === source) return {homeDir, profileDir}} catch (error) {if (error.code !== 'ENOENT') throw error}
  }
  if (link) unlinkSync(target);
  mkdirSync(join(profileDir, 'node_modules'), {recursive: true, mode: 0o700});
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
  return {homeDir, profileDir};
}
