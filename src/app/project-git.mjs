import {spawn} from 'node:child_process';

/** Git runs outside the Electron event loop; cancellation stops its transport children too. */
export function runProjectGit(args, cwd, {signal, timeoutMs = 5 * 60 * 1000} = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      env: {...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes'}});
    const stdout = [], stderr = [];
    let bytes = 0, failure, stopping;
    const stop = error => {
      if (failure) return;
      failure = error;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        stopping = new Promise(done => {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {stdio: 'ignore', windowsHide: true});
          killer.once('error', () => {child.kill('SIGKILL'); done()});
          killer.once('close', done);
        });
      } else {
        // This group contains only this operation, including git-remote-https/ssh.
        try {process.kill(-child.pid, 'SIGKILL')} catch (error) {if (error.code !== 'ESRCH') child.kill('SIGKILL')}
      }
    };
    const abort = () => stop(signal.reason ?? new Error('Project creation cancelled'));
    const deadline = setTimeout(() => stop(new Error('Project Git operation timed out')), timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', data => {
      bytes += data.length;
      if (bytes > 1024 * 1024) stop(new Error('Project Git output exceeded its limit'));
      else chunks.push(data);
    });
    child.once('error', error => {failure ??= error});
    child.once('close', async (code, exitSignal) => {
      clearTimeout(deadline); signal?.removeEventListener('abort', abort);
      await stopping;
      // Only settle once the process and its pipes are closed, before rollback removes any files.
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`Git failed (${code ?? exitSignal}): ${Buffer.concat(stderr).toString('utf8').trim().slice(-8000)}`));
      else resolve(Buffer.concat(stdout).toString('utf8').trim());
    });
    if (signal?.aborted) abort();
  });
}
