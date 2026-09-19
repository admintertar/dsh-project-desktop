import electron from 'electron';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {checkResourceStates} from './native-resource-state-checks.mjs';

const userData = mkdtempSync(join(repository, '.runtime/resource-states-'));
electron.app.setPath('userData', userData);
electron.app.on('window-all-closed', () => {});
void (async () => {
  let code = 0;
  try {
    await electron.app.whenReady();
    const details = await checkResourceStates({electron, userData});
    writeFileSync(join(userData, 'result.json'), JSON.stringify({ok: true, userData, ...details}, null, 2));
    console.log({ok: true, userData});
  } catch (error) {console.error(error); code = 1;}
  finally {electron.app.exit(code);}
})();
