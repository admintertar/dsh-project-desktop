import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {isWithin} from './package-common.mjs';

/** A fresh relocated app must finish the real two-project installation diagnostic. */
export async function verifyPackagedLaunch(executable, root) {
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const log = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--verify-installation'], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', timedOut = false;
    const record = data => {output += data.toString(); process.stdout.write(data)};
    child.stdout.on('data', record); child.stderr.on('data', record);
    const deadline = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {stdio: 'ignore'});
        killer.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    }, 180000);
    child.on('error', error => {clearTimeout(deadline); reject(error)});
    child.on('close', code => {
      clearTimeout(deadline); writeFileSync(join(root, 'launch.log'), output);
      code === 0 && !timedOut ? resolve(output) : reject(new Error(`Relocated packaged launch failed (${timedOut ? 'timeout' : code}); ${root}/launch.log`));
    });
  });
  const line = log.split(/\r?\n/).find(line => line.startsWith('INSTALLATION_CHECK='));
  if (!line) throw new Error('Packaged application did not finish its installation check');
  const result = JSON.parse(line.slice('INSTALLATION_CHECK='.length));
  if (!result.ok || !result.packaged || !isWithin(root, result.appPath)) throw new Error('Installation check did not use the relocated bundle');
  if (result.platform !== process.platform || result.arch !== process.arch) throw new Error('Packaged runtime architecture differs from the runner');
  return result;
}
