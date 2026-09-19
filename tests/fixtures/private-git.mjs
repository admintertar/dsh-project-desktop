import {execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {once} from 'node:events';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, sep} from 'node:path';

/** Real private HTTPS repository, local CA and fixed test-only credentials. No third-party services. */
export async function privateGitFixture() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'guide-private-git-')));
  const seed = join(root, 'seed'); mkdirSync(seed);
  const git = (args, cwd = seed) => execFileSync('git', args, {cwd, stdio: 'pipe', encoding: 'utf8'}).trim();
  git(['init', '--quiet', '--initial-branch=main']);
  writeFileSync(join(seed, 'README.md'), 'Default branch\n'); git(['add', '.']);
  const commit = () => git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  commit(); git(['checkout', '--quiet', '-b', 'feature/demo']);
  writeFileSync(join(seed, 'branch.txt'), 'Selected feature branch\n'); git(['add', '.']); commit();
  git(['checkout', '--quiet', 'main']);
  const bare = join(root, 'private.git'); git(['clone', '--bare', seed, bare]); git(['update-server-info'], bare);
  const cert = join(root, 'cert.pem'), key = join(root, 'key.pem'), config = join(root, 'cert.cnf');
  writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=127.0.0.1\n[ext]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-config', config], {stdio: 'ignore'});
  const credential = {kind: 'https', username: 'fixture-user', password: 'guide-private-test-token'};
  let requests = 0;
  const server = createServer({cert: readFileSync(cert), key: readFileSync(key)}, (req, res) => {
    requests++;
    if (req.headers.authorization !== `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`) {
      res.writeHead(401, {'www-authenticate': 'Basic realm="fixture"'}); res.end(); return;
    }
    const url = new URL(req.url, 'https://127.0.0.1');
    const path = resolve(bare, '.' + url.pathname.slice('/private.git'.length));
    try {
      if (!url.pathname.startsWith('/private.git/') || !path.startsWith(bare + sep) || !statSync(path).isFile()) throw new Error('missing');
      res.writeHead(200, {'content-type': 'application/octet-stream'}); res.end(readFileSync(path));
    } catch {res.writeHead(404); res.end();}
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return {root, git, credential, get requests() {return requests}, url: `https://127.0.0.1:${server.address().port}/private.git`,
    // Use Git for Windows' OpenSSL backend for this fixture's private CA,
    // independent of the machine certificate store. Verification stays enabled.
    run: base => (args, cwd, options) => base(['-c', `http.sslCAInfo=${cert}`,
      ...(process.platform === 'win32' ? ['-c', 'http.sslBackend=openssl'] : []),
      ...(!options?.auth ? ['-c', 'credential.helper='] : []), ...args], cwd, options),
    async close() {server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, {recursive: true, force: true})}};
}

export async function waitUntil(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 25))}
  throw new Error(`Timed out: ${label}`);
}
