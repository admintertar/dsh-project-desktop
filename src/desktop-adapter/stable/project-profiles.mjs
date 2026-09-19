import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parse, stringify} from 'yaml';
import {loadDesktop} from './modules.mjs';

export const profileSelectionPath = stateDirectory => join(stateDirectory, 'profile-selection/state.json');

/** Only profiles created inside this project's owned Home acquire a project binding. */
function bindCreatedProfile(profile, manifestPath) {
  const patch = join(profile.dir, 'cordis.patch.yml');
  const entries = existsSync(patch) ? parse(readFileSync(patch, 'utf8')) ?? [] : [];
  if (!Array.isArray(entries)) throw new Error('Unexpected official Profile template');
  writeFileSync(patch, stringify([...entries, {id: 'project', config: {manifestPath, enabled: true}}]));
  writeFileSync(patch + '.project-desktop-owner', manifestPath + '\n', {flag: 'wx', mode: 0o600});
  return profile;
}

export function assertProjectProfileOwner(profileDir, manifestPath) {
  const marker = join(profileDir, 'cordis.patch.yml.project-desktop-owner');
  if (!existsSync(marker) || readFileSync(marker, 'utf8').trim() !== manifestPath) {
    throw new Error('Profile is not owned by this project');
  }
}

/** Official discovery/selection, with one selection file and Home per project. */
export async function projectProfiles({stateDirectory, manifestPath, homeDir = join(stateDirectory, 'dsh')}) {
  const api = await loadDesktop('profile-manager');
  const selection = profileSelectionPath(stateDirectory);
  const list = () => api.listDesktopProfiles(homeDir).map(profile => {
    try {assertProjectProfileOwner(profile.dir, manifestPath); return profile}
    catch (error) {return {...profile, problem: profile.problem ?? error.message}}
  });
  const current = () => api.readDesktopProfileState(selection).active;
  return {
    homeDir, selection, current, list,
    create(name) {
      mkdirSync(homeDir, {recursive: true, mode: 0o700});
      return bindCreatedProfile(api.createDesktopWebProfile(homeDir, name), manifestPath);
    },
    select(name) {
      const target = list().find(profile => profile.name === name);
      if (!target || target.problem || !target.webCapable) throw new Error('Profile is unavailable for this project');
      return api.selectDesktopProfile(selection, homeDir, name);
    },
    startup() {
      const before = api.listDesktopProfiles(homeDir);
      const result = api.beginDesktopProfileStartup(selection, homeDir);
      const profile = api.listDesktopProfiles(homeDir).find(item => item.name === result.profileName);
      if (!before.some(item => item.name === result.profileName)) bindCreatedProfile(profile, manifestPath);
      assertProjectProfileOwner(profile.dir, manifestPath);
      return {...profile, homeDir};
    },
  };
}
