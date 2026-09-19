import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {verifyUpstream} from './verify-upstream.mjs';

verifyUpstream();
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(desktopRequire('electron'), [fileURLToPath(new URL('./native-resource-state-case.mjs', import.meta.url))], {env, stdio: 'inherit'});
child.on('error', error => {console.error(error); process.exitCode = 1;});
child.on('exit', code => {process.exitCode = code ?? 1;});
