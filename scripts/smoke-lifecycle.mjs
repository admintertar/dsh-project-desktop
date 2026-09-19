import {mkdtempSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';
mkdirSync(join(repository, '.runtime'), {recursive: true});
const root = mkdtempSync(join(repository, '.runtime/lifecycle-'));
for (const phase of ['seed', 'restore-two', 'restore-one', 'empty-history', 'partial-failure', 'safe-quit', 'safe-relaunch', 'safe-abandon', 'safe-cleanup']) {
  const env = {...process.env, DSH_PROJECT_DESKTOP_SMOKE_DATA: root, DSH_PROJECT_DESKTOP_TEST_PHASE: phase};
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(desktopRequire('electron'), [repository, '--lifecycle-test'], {env, stdio: 'inherit'});
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${phase} exited ${code}`)));
  });
  if (!JSON.parse(readFileSync(join(root, phase + '.json'), 'utf8')).ok) throw new Error('Missing lifecycle evidence');
}
console.log('Lifecycle evidence:', root);
