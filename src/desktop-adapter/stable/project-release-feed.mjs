import {createHash} from 'node:crypto';
import {loadDesktop} from './modules.mjs';
import {parseUpdateManifest, latestUpdateManifestUrl, versionUpdateManifestUrl} from '../../app/update-manifest.mjs';
export {releaseRepository, releasesPage} from '../../app/update-manifest.mjs';

const {parseSemVer, DESKTOP_VERSION_ENDPOINT} = await loadDesktop('update-checker');
const {DESKTOP_DOWNLOAD_URLS, DESKTOP_TARGET_VERSION_HEADER, MAX_UPDATE_DOWNLOAD_BYTES} = await loadDesktop('update-download');
const maxMetadataBytes = 16 * 1024;

class UpdateFeedError extends Error {
  constructor(kind, status) {super(`Update manifest ${kind}${status ? ` (HTTP ${status})` : ''}`); this.kind = kind; this.status = status}
}

async function limitedText(response, limit) {
  if (!response.ok || !response.body) throw new Error('Release service is unavailable');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Release response is too large');
      chunks.push(Buffer.from(value));
    }
    return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
  } finally {await reader.cancel().catch(() => {}); reader.releaseLock()}
}

export function parseProjectRelease(value, platform) {
  const manifest = parseUpdateManifest(value);
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Unsupported update platform');
  const name = `DSH-Project-Desktop-${manifest.version}-${platform === 'darwin' ? 'mac-universal.dmg' : 'win-x64-Setup.exe'}`;
  const installer = manifest.assets.find(item => item.name === name);
  if (installer.size > MAX_UPDATE_DOWNLOAD_BYTES) throw new Error('Update installer exceeds the official download limit');
  return {version: manifest.version, url: manifest.releaseUrl, sourceCommit: manifest.sourceCommit, installer};
}

/** Adapt official request injection points; no traffic or installation identifiers go to upstream services. */
export function createProjectReleaseFeed({request, platform}) {
  let latest, etag, lastFailure;
  async function readRelease(url, signal, conditional = false) {
    let response;
    try {
      // Release assets redirect through GitHub's CDN; this path never calls the REST API.
      response = await request(url, {method: 'GET', signal, redirect: 'follow', cache: 'no-store',
        headers: {Accept: 'application/json', ...(conditional && etag ? {'If-None-Match': etag} : {})}});
    } catch {throw new UpdateFeedError(signal?.aborted ? 'timeout' : 'network')}
    if (conditional && response.status === 304 && latest) return latest;
    if (!response.ok) throw new UpdateFeedError('http', response.status);
    let text;
    try {text = await limitedText(response, maxMetadataBytes)}
    catch {throw new UpdateFeedError(signal?.aborted ? 'timeout' : 'invalid')}
    let release;
    try {release = parseProjectRelease(JSON.parse(text), platform)}
    catch {throw new UpdateFeedError('invalid')}
    if (conditional) {latest = release; etag = response.headers.get('etag')}
    return release;
  }
  return {
    get lastFailure() {return lastFailure},
    async versionRequest(url, init) {
      if (url !== DESKTOP_VERSION_ENDPOINT) throw new Error('Unexpected version request');
      lastFailure = undefined;
      try {
        const release = await readRelease(latestUpdateManifestUrl, init.signal, true);
        return new Response(JSON.stringify({version: release.version, channel: 'stable'}), {headers: {'Content-Type': 'application/json'}});
      } catch (error) {lastFailure = {kind: error.kind ?? 'invalid', status: error.status}; throw error}
    },
    async downloadRequest(url, init) {
      if (url !== DESKTOP_DOWNLOAD_URLS[platform]) throw new Error('Unexpected installer request');
      const version = new Headers(init.headers).get(DESKTOP_TARGET_VERSION_HEADER);
      const parsed = typeof version === 'string' ? parseSemVer(version) : null;
      if (!parsed || parsed.version !== version || parsed.prerelease.length) throw new Error('Invalid requested version');
      // Resolve the exact tag again: the asset identity/hash belongs to this confirmed version.
      const release = await readRelease(versionUpdateManifestUrl(version), init.signal);
      if (release.version !== version) throw new Error('The requested release changed');
      const response = await request(release.installer.url, {signal: init.signal, redirect: 'follow', cache: 'no-store'});
      if (!response.ok || !response.body) throw new Error('Installer download failed');
      const hash = createHash('sha256'); let size = 0;
      // Verify before the official downloader atomically replaces the destination.
      const body = response.body.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          size += chunk.byteLength;
          if (size > release.installer.size) throw new Error('Installer size mismatch');
          hash.update(chunk); controller.enqueue(chunk);
        },
        flush() {
          if (size !== release.installer.size || hash.digest('hex') !== release.installer.sha256) throw new Error('Installer SHA-256 mismatch');
        },
      }));
      return new Response(body, {status: 200, headers: {'Content-Length': String(release.installer.size)}});
    },
  };
}
