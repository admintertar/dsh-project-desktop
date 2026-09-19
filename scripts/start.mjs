import {spawn} from 'node:child_process';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {verifyUpstream} from './verify-upstream.mjs';
verifyUpstream();
const electron = desktopRequire('electron');
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [repository, ...process.argv.slice(2)], {stdio: 'inherit', env});
// Also forward signals when launched through the Project plugin's Node wrapper.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => {console.error(error.message); process.exitCode = 1});
child.on('exit', code => {process.exitCode = code ?? 1});
