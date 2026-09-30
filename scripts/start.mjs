import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {repository} from '../src/desktop-adapter/official/paths.mjs';
import {officialRuntimeTarget} from '../src/desktop-adapter/official/runtime-inputs.mjs';
import {verifyOfficialRuntimePayload} from '../src/desktop-adapter/official/runtime-payload.mjs';
const target = officialRuntimeTarget(process.platform, process.arch);
const configured = process.env.DSH_OFFICIAL_RUNTIME_DIR;
const official = resolve(configured || join(repository, '.cache/official-runtime', target));
const pin = JSON.parse(readFileSync(join(repository, 'official-source.lock.json'), 'utf8'));
if (!existsSync(official)) throw new Error(`Official runtime is missing. Run yarn run prepare:official-runtime -- /path/to/deepseek-harness first: ${official}`);
verifyOfficialRuntimePayload(official, pin, target);
const electron = join(official, 'electron', process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron');
const built = JSON.parse(readFileSync(join(repository, 'dist/build.json'), 'utf8'));
if (built.sourceCommit !== pin.commit || !Array.isArray(built.inputs)) {
  throw new Error('Shell assets are not built from the pinned official source; run yarn build');
}
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
if (existsSync(official)) env.DSH_OFFICIAL_RUNTIME_DIR = official;
// Windows GUI executables need explicit output pipes for main-process errors
// to reach the invoking terminal and Actions log.
const child = spawn(electron, [repository, ...process.argv.slice(2)], {stdio: ['inherit', 'pipe', 'pipe'], env});
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
// Also forward signals when launched through the Project plugin's Node wrapper.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => {console.error(error.message); process.exitCode = 1});
child.on('close', (code, signal) => {
  if (code !== 0) console.error(`Electron exited with ${code ?? signal}`);
  process.exitCode = code ?? 1;
});
