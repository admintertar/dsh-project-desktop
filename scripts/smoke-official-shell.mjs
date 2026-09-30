import {spawn} from 'node:child_process';
import {mkdtempSync, realpathSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {repository} from '../src/desktop-adapter/official/paths.mjs';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-official-shell-')));
console.log(`Official Shell evidence: ${root}`);
const mode = process.argv.includes('--close') ? '--official-close-smoke' : '--official-shell-smoke';
const child = spawn(process.execPath, [join(repository, 'scripts/start.mjs'), mode], {
  stdio: 'inherit', env: {...process.env, DSH_PROJECT_DESKTOP_SMOKE_DATA: root},
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => {console.error(error); process.exitCode = 1});
child.on('exit', code => {
  process.exitCode = code ?? 1;
  if (code === 0) {
    try {JSON.parse(readFileSync(join(root, mode === '--official-close-smoke' ? 'close-result.json' : 'result.json'), 'utf8'))}
    catch (error) {console.error('Official smoke did not produce its completion evidence:', error.message); process.exitCode = 1}
  }
});
