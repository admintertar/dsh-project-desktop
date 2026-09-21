import electron from 'electron';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {checkResourceStates} from './native-resource-state-checks.mjs';

// A fresh checkout has no .runtime directory, and mkdtemp only creates its leaf.
const runtime = join(repository, '.runtime');
mkdirSync(runtime, {recursive: true});
const userData = mkdtempSync(join(runtime, 'resource-states-'));
electron.app.setPath('userData', userData);
electron.app.on('window-all-closed', () => {});
void (async () => {
  let code = 0;
  try {
    await electron.app.whenReady();
    const details = await checkResourceStates({electron, userData});
    writeFileSync(join(userData, 'result.json'), JSON.stringify({ok: true, userData, ...details}, null, 2));
    console.log({ok: true, userData});
  } catch (error) {
    // Keep the failure inside the uploaded evidence instead of only in the job log.
    writeFileSync(join(userData, 'result.json'), JSON.stringify({ok: false, userData,
      error: error instanceof Error ? error.stack ?? error.message : String(error)}, null, 2));
    console.error(error); code = 1;
  }
  finally {electron.app.exit(code);}
})();
