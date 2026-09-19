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
const child = spawn(desktopRequire('electron'), [join(repository, 'scripts/native-guide-case.mjs')], {env, stdio: 'inherit'});
child.on('error', error => {console.error(error); process.exitCode = 1});
child.on('exit', code => {process.exitCode = code ?? 1});
