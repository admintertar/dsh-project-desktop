import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {NO_PROXY, detectSystemProxy, hasExplicitProxyEnvironment, mergeNoProxy, parseProxyAnswer, probeProxy,
  proxyHostEnvironment, redactProxy} from '../src/desktop-adapter/stable/system-proxy.mjs';

/**
 * The measured production failure these tests guard: Git for Windows never reads the WinINET
 * system proxy, so `git push` reached github.com directly and failed after ~21s while every
 * browser on the same machine worked. The Shell resolves the proxy through Chromium and hands
 * the Host an environment Git obeys.
 */

/** A socket stub: `connect`, `refused` and `timeout` are the only outcomes probeProxy reacts to. */
function fakeSocket(outcome) {
  const socket = new EventEmitter();
  socket.destroy = () => {};
  setImmediate(() => {
    if (outcome === 'connect') socket.emit('connect');
    else if (outcome === 'refused') socket.emit('error', Object.assign(new Error('refused'), {code: 'ECONNREFUSED'}));
  });
  return socket;
}

const probe = outcome => entry => probeProxy(entry, {connect: () => fakeSocket(outcome), timeoutMs: 50});

test('a Chromium proxy answer is parsed into the addresses Git accepts', () => {
  assert.deepEqual(parseProxyAnswer('PROXY 127.0.0.1:7890').map(entry => entry.url), ['http://127.0.0.1:7890']);
  assert.deepEqual(parseProxyAnswer('SOCKS5 127.0.0.1:7891').map(entry => entry.url), ['socks5h://127.0.0.1:7891']);
  // A PAC answer can offer several proxies with a direct fallback; only addressed entries count.
  assert.deepEqual(parseProxyAnswer('PROXY proxy.corp:8080; SOCKS 127.0.0.1:1080; DIRECT').map(entry => entry.url),
    ['http://proxy.corp:8080', 'socks5h://127.0.0.1:1080']);
  assert.deepEqual(parseProxyAnswer('PROXY [::1]:7890').map(entry => entry.url), ['http://[::1]:7890']);
  assert.deepEqual(parseProxyAnswer('PROXY proxy.corp').map(entry => entry.url), ['http://proxy.corp:80']);
  assert.deepEqual(parseProxyAnswer('PROXY host:0'), [], 'an impossible port is not an address');
  for (const answer of ['DIRECT', '', undefined, null, 'garbage', 'PROXY']) {
    assert.deepEqual(parseProxyAnswer(answer), [], `${String(answer)} is not a proxy`);
  }
});

test('a listening local proxy is injected into the Host environment for every bundled tool', async () => {
  const detection = await detectSystemProxy({resolveProxy: async () => 'PROXY 127.0.0.1:7890', cache: probe('connect')});
  assert.equal(detection.proxied, true);
  assert.equal(detection.reason, 'connected');
  const environment = proxyHostEnvironment(detection);
  for (const name of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) {
    assert.equal(environment[name], 'http://127.0.0.1:7890',
      `${name} must point at the resolved proxy: Git and curl read the lowercase name, Git LFS and other bundled tools the uppercase one`);
  }
  assert.equal(environment.no_proxy, NO_PROXY);
  assert.equal(environment.NO_PROXY, NO_PROXY);
  for (const local of ['127.0.0.1', 'localhost', '::1', '192.168.0.0/16']) {
    assert.ok(NO_PROXY.includes(local), `${local} must stay out of the proxy`);
  }
});

test('a stopped local proxy is never injected, so Git keeps a direct connection', async () => {
  const refused = await detectSystemProxy({resolveProxy: async () => 'PROXY 127.0.0.1:7891', cache: probe('refused')});
  assert.deepEqual({proxied: refused.proxied, reason: refused.reason}, {proxied: false, reason: 'refused'});
  assert.deepEqual(proxyHostEnvironment(refused), {},
    'a dead proxy must not turn every Git operation into a full timeout');

  const silent = await detectSystemProxy({resolveProxy: async () => 'PROXY 127.0.0.1:7892', cache: probe('timeout')});
  assert.deepEqual({proxied: silent.proxied, reason: silent.reason}, {proxied: false, reason: 'timeout'});
  assert.deepEqual(proxyHostEnvironment(silent), {});
});

test('the probe result is cached and a remote proxy is trusted without probing', async () => {
  // probeProxy itself owns the cache and the local/remote decision: `sockets` counts real
  // connections, and a throwing probe would surface the moment a remote proxy were probed.
  let sockets = 0;
  const countingProbe = candidate => probeProxy(candidate, {connect: () => {sockets += 1; return fakeSocket('connect')}});
  const resolveProxy = async () => 'PROXY 127.0.0.1:7893';
  await detectSystemProxy({resolveProxy, cache: countingProbe});
  await detectSystemProxy({resolveProxy, cache: countingProbe});
  assert.equal(sockets, 1, 'a second Host boot must reuse the cached probe instead of connecting again');

  const entry = parseProxyAnswer('PROXY 127.0.0.1:7893')[0];
  const refused = await probeProxy(entry, {connect: () => {throw new Error('a cached probe must not open a socket')}});
  assert.equal(refused.usable, true, 'the cached connected result answers without a new socket');

  const remote = await detectSystemProxy({resolveProxy: async () => 'PROXY proxy.corp:8080',
    cache: candidate => probeProxy(candidate, {connect: () => {throw new Error(`a remote proxy must not be probed (${candidate.url})`)}}) });
  assert.equal(remote.reason, 'remote');
  assert.equal(proxyHostEnvironment(remote).http_proxy, 'http://proxy.corp:8080');
});

test('a PAC list uses the first usable entry and keeps the rest in the diagnostic', async () => {
  const detection = await detectSystemProxy({resolveProxy: async () => 'PROXY 127.0.0.1:7894; PROXY 127.0.0.1:7895',
    cache: probe('connect')});
  assert.equal(detection.proxy, 'http://127.0.0.1:7894');
  assert.deepEqual(detection.alternatives, ['http://127.0.0.1:7895']);
});

test('no proxy, no resolver or a failing resolver leave the environment untouched', async () => {
  for (const [name, resolveProxy] of [
    ['direct', async () => 'DIRECT'],
    ['no-resolver', undefined],
    ['resolve-failed', async () => {throw new Error('network service unavailable')}],
  ]) {
    const detection = await detectSystemProxy({resolveProxy});
    assert.equal(detection.proxied, false, name);
    assert.deepEqual(proxyHostEnvironment(detection), {}, name);
  }
});

test('the Host supervisor injects the proxy only outside Safe Mode', async () => {
  const source = await readFile(new URL('../src/desktop-adapter/index.mjs', import.meta.url), 'utf8');
  assert.match(source,
    /const proxy = safeMode \? \{proxied: false, reason: 'safe-mode'\} : await detectSystemProxy\(\{resolveProxy: nativeRuntime\?\.resolveProxy\}\)/,
    'Safe Mode must not detect a proxy: its environment is trimmed on purpose');
  assert.match(source, /const proxyEnvironment = proxyHostEnvironment\(proxy, process\.env\)/,
    'the inherited environment must be considered before a proxy is injected into the Host');
  assert.match(source, /env: \{\.\.\.\(safeMode \? safeHostEnvironment\(process\.env\) : process\.env\), \.\.\.proxyEnvironment/,
    'the resolved proxy environment must be spread after the inherited environment');
});

test('the proxy address is redacted before it reaches any diagnostic surface', () => {
  assert.equal(redactProxy('http://user:secret@proxy.corp:8080'), 'http://proxy.corp:8080');
  assert.equal(redactProxy('not a url'), 'the configured proxy');
});

/**
 * macOS runs the same code path with no platform branch, and a system proxy there usually carries
 * its own exception list (measured on the development machine: muyuan.do, timestamp.apple.com,
 * *.local) that Chromium applies but a Git child never sees. Overwriting `no_proxy` therefore
 * silently sent those targets through the local proxy. The operator's exclusions are a floor.
 */
test('operator exclusions survive the injection instead of being replaced by the defaults', async () => {
  const detection = await detectSystemProxy({resolveProxy: async () => 'PROXY 127.0.0.1:7890', cache: probe('connect')});
  const environment = proxyHostEnvironment(detection, {no_proxy: 'corp.example.com, .internal', NO_PROXY: 'muyuan.do'});
  const entries = environment.no_proxy.split(',');
  for (const kept of ['corp.example.com', '.internal', 'muyuan.do']) {
    assert.ok(entries.includes(kept), `${kept} must stay excluded from the proxy`);
  }
  for (const fallback of ['localhost', '127.0.0.0/8', '192.168.0.0/16', '.local']) {
    assert.ok(entries.includes(fallback), `${fallback} must still be excluded by default`);
  }
  assert.equal(environment.NO_PROXY, environment.no_proxy, 'both casings must carry the same merged list');
  assert.equal(environment.http_proxy, 'http://127.0.0.1:7890',
    'merging the exclusions must not drop the address Git is supposed to use');
});

test('an operator-exported proxy is kept and only the exclusions are enforced', async () => {
  const detection = await detectSystemProxy({resolveProxy: async () => 'PROXY 127.0.0.1:7890', cache: probe('connect')});
  for (const name of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY']) {
    const environment = proxyHostEnvironment(detection, {[name]: 'http://corp.example.com:3128'});
    assert.equal(environment.http_proxy, undefined, `${name} was exported by the operator: the resolved proxy must not replace it`);
    assert.equal(environment.HTTPS_PROXY, undefined, name);
    assert.ok(environment.no_proxy.includes('localhost'), `${name} must not disable the loopback exclusions`);
  }
  for (const [name, environment] of [
    ['nothing set', {}],
    ['blank value', {http_proxy: '   '}],
    ['unrelated variable', {no_proxy: 'corp.example.com'}],
  ]) {
    assert.equal(hasExplicitProxyEnvironment(environment), false, name);
  }
  for (const environment of [{http_proxy: 'http://corp.example.com:3128'}, {HTTPS_PROXY: 'http://corp.example.com:3128'}]) {
    assert.equal(hasExplicitProxyEnvironment(environment), true, JSON.stringify(environment));
  }
});

test('the default exclusions cover the whole loopback block, not just 127.0.0.1', () => {
  const entries = NO_PROXY.split(',');
  for (const entry of ['localhost', '127.0.0.1', '127.0.0.0/8', '::1', '[::1]']) {
    assert.ok(entries.includes(entry), `${entry} must be excluded by default`);
  }
  assert.equal(mergeNoProxy(), NO_PROXY, 'no inherited value must reproduce the previous default list exactly');
  assert.ok(mergeNoProxy({no_proxy: 'corp.example.com'}).endsWith('corp.example.com'),
    'an inherited exclusion is appended after the defaults');
  assert.equal(mergeNoProxy({no_proxy: 'LOCALHOST, Corp.Example.com'}), `${NO_PROXY},Corp.Example.com`,
    'duplicates are dropped by casing while the operator spelling is preserved');
});
