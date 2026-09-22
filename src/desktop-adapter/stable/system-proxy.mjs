import {connect} from 'node:net';

/**
 * A Git subprocess never inherits the Windows system proxy. WinINET keeps it in the
 * registry (`HKCU\...\Internet Settings`), only WinINET clients read it there, and Git for
 * Windows is libcurl + schannel, so an operator running Clash or a similar local proxy sees
 * `Failed to connect to github.com:443 after 21070 ms` while every browser works. Measured on
 * the 0.1.7 development machine: direct `git ls-remote` failed after 21.2s, the same command
 * with `http.proxy=http://127.0.0.1:7890` succeeded in 0.9s.
 *
 * The Shell already has the resolved answer through Chromium: `session.resolveProxy` reads the
 * Windows proxy configuration (including PAC) and, unlike a naive "use the proxy" rule, returns
 * DIRECT for loopback targets. Verified against the same machine: `resolveProxy('https://github.com/')`
 * returned `PROXY 127.0.0.1:7890` while `resolveProxy('https://127.0.0.1:9/')` returned `DIRECT`.
 *
 * Git is configured through the environment instead of `git config`, because a child process
 * environment (a) reaches every Git the project Host spawns, (b) reaches Git LFS, which reads
 * `HTTP_PROXY`/`HTTPS_PROXY` rather than `http.proxy`, and (c) never rewrites the operator's own
 * Git configuration.
 */

const CACHE_TTL_MS = 30_000;
const PRECHECK_TIMEOUT_MS = 500;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Private, link-local and loopback ranges stay out of the proxy for the same reason Chromium omits them. */
export const NO_PROXY = [
  'localhost', '127.0.0.1', '::1', '0.0.0.0',
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '169.254.0.0/16', 'fc00::/7', 'fe80::/10', '.local',
].join(',');

/** The probe result is cached per proxy address: a probe ran inside the Host boot budget. */
const cache = new Map();

/** Parse one `host:port`, `[::1]:port` or bare `host` entry from a resolveProxy result. */
function parseAddress(value, defaultPort = 80) {
  const text = value.trim();
  if (!text) return undefined;
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
  if (bracketed) return {host: bracketed[1], port: Number(bracketed[2] ?? defaultPort)};
  const separated = /^(.*):(\d+)$/.exec(text);
  if (separated && separated[1]) return {host: separated[1], port: Number(separated[2])};
  if (text.includes(':')) return undefined;
  return {host: text, port: defaultPort};
}

/**
 * Chromium answers with `DIRECT` or a PAC proxy list such as `PROXY 127.0.0.1:7890`,
 * `SOCKS5 127.0.0.1:7891; DIRECT`. Only entries that carry an address are usable;
 * a `DIRECT` fallback is not a decision to go through a proxy.
 */
export function parseProxyAnswer(answer) {
  const entries = [];
  for (const item of String(answer ?? '').split(';')) {
    const match = /^\s*(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(.+?)\s*$/i.exec(item);
    if (!match) continue;
    const scheme = match[1].toUpperCase();
    const address = parseAddress(match[2], scheme.startsWith('SOCKS') ? 1080 : 80);
    if (!address || !Number.isInteger(address.port) || address.port < 1 || address.port > 65_535) continue;
    // A URL needs a bare IPv6 host in brackets: `[::1]:7890`, not `::1:7890`.
    const host = address.host.includes(':') && !address.host.startsWith('[') ? `[${address.host}]` : address.host;
    entries.push({url: `${scheme.startsWith('SOCKS') ? 'socks5h' : 'http'}://${host}:${address.port}`, ...address});
  }
  return entries;
}

/** Loopback proxies are probed; a remote proxy is the operator's explicit infrastructure. */
function isLocal(address) {
  return LOCAL_HOSTS.has(address.host.toLowerCase()) || address.host === '::1';
}

function connectRefused(error) {
  return Boolean(error) && ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET'].includes(error.code);
}

/**
 * "Port open" is not "proxy works", but it is the cheap, side-effect-free signal: it catches a
 * stopped Clash before every Git operation spends its full timeout on a dead tunnel. When the
 * precheck fails we do not inject the proxy and the operation falls back to a direct connection.
 */
export function probeProxy(entry, {timeoutMs = PRECHECK_TIMEOUT_MS, now = Date.now, connect: connectTo = connect} = {}) {
  if (!isLocal(entry)) return Promise.resolve({usable: true, reason: 'remote'});
  const key = entry.url;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now()) return Promise.resolve(cached.result);
  return new Promise(resolve => {
    let settled;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      cache.set(key, {expiresAt: now() + CACHE_TTL_MS, result});
      resolve(result);
    };
    const socket = connectTo({host: entry.host, port: entry.port});
    const timer = setTimeout(() => finish({usable: false, reason: 'timeout'}), timeoutMs);
    socket.once('connect', () => finish({usable: true, reason: 'connected'}));
    socket.once('error', error => finish({usable: false, reason: connectRefused(error) ? 'refused' : 'unreachable'}));
  });
}

/** A proxy address is written to the log for diagnosis; keep it out of anything user-facing. */
export function redactProxy(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port}`;
  } catch {return 'the configured proxy';}
}

/**
 * Resolve this machine's proxy once per Host boot and prove a local one is actually listening.
 * Resolving alone is cheap, and the whole probe stays inside the documented Host boot budget that
 * already tolerates a 120s first-time dependency install.
 */
export async function detectSystemProxy({resolveProxy, probe, cache: probeCache = probeProxy} = {}) {
  if (typeof resolveProxy !== 'function') return {proxied: false, reason: 'no-resolver'};
  let answer;
  try {answer = await resolveProxy('https://github.com/')}
  catch {return {proxied: false, reason: 'resolve-failed'}}
  const entries = parseProxyAnswer(answer);
  if (!entries.length) return {proxied: false, reason: 'direct'};
  const decided = await Promise.all(entries.map(async entry => ({entry, result: await probeCache(entry)})));
  const usable = decided.filter(({result}) => result?.usable);
  if (!usable.length) return {proxied: false, reason: decided[0]?.result?.reason ?? 'unreachable'};
  // Git takes one proxy address per protocol; a PAC list can offer several. The first usable
  // entry is the one Chromium itself would pick, and the rest stay visible in the diagnostic.
  const [primary] = usable;
  return {proxied: true, proxy: primary.entry.url, alternatives: usable.slice(1).map(({entry}) => entry.url),
    reason: decided.some(({result}) => result?.reason === 'remote') ? 'remote' : 'connected'};
}

/**
 * The environment Git and its helpers inherit. Both letter cases are set: Git, curl and Git LFS
 * read the lowercase form, other bundled tools read the uppercase one, and Windows environment
 * blocks are case-insensitive, so one key would overwrite the other.
 */
export function proxyHostEnvironment(detection) {
  if (!detection?.proxied || !detection.proxy) return {};
  const {proxy} = detection;
  return {http_proxy: proxy, https_proxy: proxy, HTTP_PROXY: proxy, HTTPS_PROXY: proxy,
    // Explicitly keep the loopback and private targets the product talks to out of the proxy.
    no_proxy: NO_PROXY, NO_PROXY};
}
