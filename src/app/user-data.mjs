import {join, resolve} from 'node:path';

/**
 * Resolve this launch's application data directory.
 *
 * Testing modes always use the directory their harness supplied. A normal launch
 * uses the per-user default unless `DSH_PROJECT_DESKTOP_USER_DATA` names an
 * isolated directory. That override lets a developer run this build beside an
 * installed copy: both would otherwise share one directory, and the copy that
 * holds its single-instance lock makes the other quit at startup.
 */
export function resolveUserData({installationCheck = false, testing = false, environment = {}, appData, temporaryDirectory}) {
  if (installationCheck) return temporaryDirectory();
  if (testing) {
    const supplied = environment.DSH_PROJECT_DESKTOP_SMOKE_DATA;
    if (!supplied) throw new Error('Testing launches require DSH_PROJECT_DESKTOP_SMOKE_DATA');
    return resolve(supplied);
  }
  const isolated = environment.DSH_PROJECT_DESKTOP_USER_DATA;
  if (isolated) return resolve(isolated);
  return join(appData, 'dsh-project-desktop');
}
