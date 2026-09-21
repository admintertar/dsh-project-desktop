import {mkdtempSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';

mkdirSync(join(repository, '.runtime'), {recursive: true});
const root = mkdtempSync(join(repository, '.runtime/guide-frame-'));
const env = {...process.env, DSH_PROJECT_DESKTOP_SMOKE_DATA: root};
delete env.ELECTRON_RUN_AS_NODE;
console.log('Guide frame evidence:', root);
// Flags pass through to the case: --focused runs only the create-guide flow,
// which needs no real window focus and is what Windows CI verifies.
const child = spawn(desktopRequire('electron'), [join(repository, 'scripts/native-guide-case.mjs'), ...process.argv.slice(2)], {env, stdio: 'inherit'});
child.on('error', error => {console.error(error); process.exitCode = 1});
child.on('exit', code => {process.exitCode = code ?? 1});
