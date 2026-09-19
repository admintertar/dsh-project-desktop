import {spawn} from 'node:child_process';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {join} from 'node:path';
// Exercise the same Electron-as-Node runtime used by the installed application's pnpm.
const child = spawn(desktopRequire('electron'), [join(repository, 'scripts/network-recovery-case.mjs')], {
  stdio: 'inherit', env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
});
child.on('error', error => {console.error(error); process.exitCode = 1});
child.on('exit', code => {process.exitCode = code ?? 1});
