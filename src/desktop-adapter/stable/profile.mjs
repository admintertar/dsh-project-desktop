import {cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {parse, stringify} from 'yaml';
import {repository, runtimePackage, projectPackage} from '../paths.mjs';
import {loadDesktop} from './modules.mjs';
import {canInitializeBundledLock, materializeProjectDependencies} from './materialize.mjs';

export const DEFAULT_PROJECT_MARKET = 'dsh-market';

/**
 * Time a dependency materialization. The first Profile preparation runs the bundled pnpm
 * install and the pinned official materializer allows it 120s; that single step is the
 * usual answer to "opening this project sometimes takes half a minute", so it is timed
 * instead of being folded into the profile stage around it.
 */
function materializeWithTrace(trace, label) {
  let count = 0;
  return args => {
    count += 1;
    const name = count === 1 ? label : `${label} #${String(count)}`;
    if (!trace) return materializeProjectDependencies(args);
    return trace.measure(name, () => materializeProjectDependencies(args));
  };
}

/**
 * Read the market selected for one isolated project before its Host exists.
 * Existing projects inherit the product default until they persist an override.
 */
export function readProjectMarketPreference(settingsPath) {
  if (!existsSync(settingsPath)) return DEFAULT_PROJECT_MARKET;
  const settings = parse(readFileSync(settingsPath, 'utf8')) ?? {};
  const value = settings?.['dsh-project-market']?.provider;
  if (value === undefined) return DEFAULT_PROJECT_MARKET;
  if (value === 'disabled' || value === 'dsh-market') return value;
  throw new Error('Project plugin market must be disabled or dsh-market');
}

/** Runs only in the project's isolated process, before its Host starts. */
export async function prepareProjectProfile(manifestPath, stateDirectory, {homeDir = join(stateDirectory, 'dsh'), safeMode = false, profileName = 'desktop', trace} = {}) {
  const {assertDesktopProfileName} = await loadDesktop('profile-manager');
  assertDesktopProfileName(profileName);
  trace?.stage('profile manager loaded');
  const profileDir = join(homeDir, 'profiles', profileName);
  const profileApi = await loadDesktop('profile');
  const {createDesktopWebProfile} = await loadDesktop('profile-manager');
  const fresh = !existsSync(join(profileDir, 'package.json'));
  trace?.stage('official profile api loaded', `fresh=${String(fresh)}`);
  const patch = join(profileDir, 'cordis.patch.yml');
  if (!fresh && !existsSync(patch + '.project-desktop-owner')) throw new Error('Refusing to overwrite an unowned Profile');
  if (fresh) createDesktopWebProfile(homeDir, profileName);
  if (existsSync(patch + '.project-desktop-owner') && readFileSync(patch + '.project-desktop-owner', 'utf8').trim() !== manifestPath) {
    throw new Error('Profile belongs to another project');
  }
  const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'));
  const projectLink = join(profileDir, 'node_modules/dsh-plugin-project');
  const projectWasRuntimeDependency = manifest.dependencies?.['dsh-plugin-project'] === 'link:./.project-plugin';
  const lockPath = join(profileDir, 'pnpm-lock.yaml');
  // Also inspect the lock so an interrupted first migration is retried on the next startup.
  const lockImporter = !safeMode && existsSync(lockPath) ? parse(readFileSync(lockPath, 'utf8'))?.importers?.['.'] : undefined;
  const projectLockWasRuntimeDependency = lockImporter?.dependencies?.['dsh-plugin-project'] !== undefined;
  if (!safeMode) {
    manifest.dependencies ??= {};
    // The product plugin is a development dependency so third-party market UIs cannot uninstall or toggle it.
    delete manifest.dependencies['dsh-plugin-project'];
    manifest.devDependencies ??= {};
    manifest.devDependencies['dsh-plugin-project'] = 'link:./.project-plugin';
    // Keep the audited stable Market bundle available; official preparation filters it unless selected.
    manifest.dsh.profile.bundles = [...new Set([...manifest.dsh.profile.bundles, 'dsh-plugin-project', 'dshmarket'])];
    manifest.dsh.profile.patchReload = 'startup';
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    const staged = join(profileDir, '.project-plugin');
    mkdirSync(staged, {recursive: true});
    for (const name of ['package.json', 'lib', 'cordis.patch.yml', 'THIRD_PARTY_NOTICES.md']) {
      cpSync(join(projectPackage, name), join(staged, name), {recursive: true});
    }
    const pluginManifest = JSON.parse(readFileSync(join(staged, 'package.json'), 'utf8'));
    for (const dependency of Object.keys(pluginManifest.dependencies)) {
      const target = join(staged, 'node_modules', dependency);
      mkdirSync(dirname(target), {recursive: true});
      runtimeLink(join(repository, '.cache/project-dependencies', dependency), target);
    }
    mkdirSync(join(profileDir, 'node_modules'), {recursive: true});
    runtimeLink(staged, projectLink);
  }
  mkdirSync(join(profileDir, 'node_modules'), {recursive: true});
  const shellLink = join(profileDir, 'node_modules/dsh-project-shell');
  runtimeLink(join(repository, '.cache/runtime/dsh-project-shell'), shellLink);
  if (!existsSync(patch + '.project-desktop-owner')) {
    const official = existsSync(patch) ? parse(readFileSync(patch, 'utf8')) ?? [] : [];
    if (!Array.isArray(official)) throw new Error('Unexpected official Profile template');
    writeFileSync(patch, stringify([...official,
      ...(!safeMode ? [{id: 'project', config: {manifestPath, enabled: true}}] : []),
      {id: 'desktop-updates', disabled: true},
      {id: 'desktop-profiles', disabled: true},
      {id: 'session-telemetry-otel', disabled: true},
    ]));
    writeFileSync(patch + '.project-desktop-owner', manifestPath + '\n', {flag: 'wx'});
  }
  const settingsPath = join(homeDir, 'settings.yaml');
  if (!existsSync(settingsPath)) writeFileSync(settingsPath, stringify({
    'dsh-desktop': {mode: 'advanced', port: 0, openBrowser: false, networkExposure: 'loopback', ...(safeMode ? {macosMaterial: 'off', windowsMaterial: 'off'} : {})},
    ...(!safeMode ? {'dsh-project-market': {provider: DEFAULT_PROJECT_MARKET}} : {}),
    ...(safeMode ? {'dsh-desktop-notifications': {enabled: false}, locale: {preference: 'system'}} : {}),
  }), {flag: 'wx', mode: 0o600});
  const requestedMarket = safeMode ? 'disabled' : readProjectMarketPreference(settingsPath);
  const materialize = materializeWithTrace(trace, 'profile prepare: pnpm dependencies');
  if ((projectWasRuntimeDependency || projectLockWasRuntimeDependency) && existsSync(lockPath)) {
    // One-time owned migration: keep the lock aligned before any Market package operation can run.
    await materialize({stateDirectory, homeDir, profileDir, updateLockfile: true});
    runtimeLink(join(profileDir, '.project-plugin'), projectLink);
    runtimeLink(join(repository, '.cache/runtime/dsh-project-shell'), shellLink);
  }
  await profileApi.healDesktopProfileModuleFallback(homeDir);
  const prepared = profileApi.prepareDesktopProfile('1', homeDir, process.platform, profileName,
    join(stateDirectory, 'plugin-management/state.json'),
    {requested: requestedMarket, effective: requestedMarket, legacyDefaulted: false},
    {lanAddresses: [], aaEnabled: false});
  if (prepared.market.effective !== requestedMarket) {
    throw new Error(prepared.marketFailure ?? `Selected plugin market ${requestedMarket} is unavailable`);
  }
  if (requestedMarket === 'dsh-market') {
    // dshmarket falls back to ordinary DSH without the omitted Desktop Profile service; bind it to this Profile explicitly.
    prepared.patches.push({id: 'dsh-market', config: {profile: prepared.profile.name, allowRestart: false}});
  }
  // Apply product policy last, after official normalization and user profile layers.
  prepared.patches.push({id: 'desktop-updates', disabled: true}, {id: 'desktop-profiles', disabled: true});
  // Every normal Profile belongs to the same project, regardless of user patch layers.
  if (!safeMode) prepared.patches.push({id: 'project', disabled: false, config: {manifestPath, enabled: true}});
  if (safeMode) prepared.patches.push({id: 'desktop-pnpm', disabled: true}, {id: 'desktop-terminal', disabled: true},
    {id: 'desktop-notifications', disabled: true}, {id: 'session-telemetry-otel', disabled: true});
  const shellConfig = prepared.patches.findLast(patch => patch.id === 'desktop-shell' && patch.config)?.config;
  if (!shellConfig) throw new Error('Official Profile did not prepare its shell configuration');
  prepared.patches.push({id: 'desktop-shell', disabled: true},
    {id: 'ui-settings-models', disabled: true},
    {insert: [{id: 'project-desktop-shell', name: 'dsh-project-shell', config: shellConfig}]});
  if (prepared.mode !== 'advanced' || prepared.openBrowser || prepared.networkExposure !== 'loopback') {
    throw new Error('This prototype requires advanced mode and local-only access');
  }
  await profileApi.healDesktopProfileModuleFallback(homeDir, prepared.profile);
  if (!safeMode && !existsSync(lockPath)) {
    // The initial Profile has only our bundled link. Never resolve arbitrary unpinned additions here.
    if (!canInitializeBundledLock(profileDir)) {
      throw new Error('Profile dependencies need an explicit lockfile before startup');
    }
    await materialize({stateDirectory, homeDir, profileDir, updateLockfile: true});
    runtimeLink(join(profileDir, '.project-plugin'), projectLink);
    runtimeLink(join(repository, '.cache/runtime/dsh-project-shell'), shellLink);
    await profileApi.healDesktopProfileModuleFallback(homeDir, prepared.profile);
  }
  trace?.stage('profile prepared');
  return {prepared, homeDir, profileDir, stateDirectory, runtimePackage};
}

// Only called before a Host starts. Refresh owned links when the app bundle moves.
function runtimeLink(source, target) {
  const stat = lstatSync(target, {throwIfNoEntry: false});
  if (stat && !stat.isSymbolicLink()) throw new Error(`Owned runtime link was replaced: ${target}`);
  if (stat) unlinkSync(target);
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
}
