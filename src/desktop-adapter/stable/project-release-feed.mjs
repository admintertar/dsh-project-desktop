import {createHash} from 'node:crypto';
import {loadDesktop} from './modules.mjs';

const {parseSemVer, DESKTOP_VERSION_ENDPOINT} = await loadDesktop('update-checker');
const {DESKTOP_DOWNLOAD_URLS, DESKTOP_TARGET_VERSION_HEADER, MAX_UPDATE_DOWNLOAD_BYTES} = await loadDesktop('update-download');
export const releaseRepository = 'admintertar/dsh-project-desktop';
export const releasesPage = `https://github.com/${releaseRepository}/releases`;
const api = `https://api.github.com/repos/${releaseRepository}/releases`;
const maxMetadataBytes = 1024 * 1024;

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
  const version = typeof value?.tag_name === 'string' ? parseSemVer(value.tag_name) : null;
  if (!version || version.prerelease.length || value.tag_name !== `v${version.version}`
    || value.draft !== false || value.prerelease !== false || !value.published_at
    || value.html_url !== `${releasesPage}/tag/${value.tag_name}` || !Array.isArray(value.assets)) {
    throw new Error('Invalid stable Project Desktop release');
  }
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Unsupported update platform');
  const name = `DSH-Project-Desktop-${version.version}-${platform === 'darwin' ? 'mac-universal.dmg' : 'win-x64-Setup.exe'}`;
  const asset = filename => {
    const matches = value.assets.filter(item => item.name === filename);
    if (matches.length !== 1) throw new Error('The release is missing an unambiguous installer or checksum');
    const item = matches[0];
    if (item.state !== 'uploaded' || !Number.isSafeInteger(item.id) || item.id <= 0
      || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > MAX_UPDATE_DOWNLOAD_BYTES
      || item.browser_download_url !== `https://github.com/${releaseRepository}/releases/download/${value.tag_name}/${filename}`) {
      throw new Error('Invalid Project Desktop release asset');
    }
    return {id: item.id, name: filename, size: item.size, url: item.browser_download_url, digest: item.digest};
  };
  const installer = asset(name), checksum = asset(name + '.sha256');
  if (checksum.size > 256) throw new Error('Invalid release checksum size');
  return {version: version.version, url: value.html_url, installer, checksum};
}

/** Adapt official request injection points; no traffic or installation identifiers go to upstream services. */
export function createProjectReleaseFeed({request, platform}) {
  let latest, etag;
  async function readRelease(url, signal, conditional = false) {
    const response = await request(url, {method: 'GET', signal, redirect: 'error', cache: 'no-store',
      headers: {Accept: 'application/vnd.github+json', ...(conditional && etag ? {'If-None-Match': etag} : {})}});
    if (conditional && response.status === 304 && latest) return latest;
    const release = parseProjectRelease(JSON.parse(await limitedText(response, maxMetadataBytes)), platform);
    if (conditional) {latest = release; etag = response.headers.get('etag')}
    return release;
  }
  return {
    async versionRequest(url, init) {
      if (url !== DESKTOP_VERSION_ENDPOINT) throw new Error('Unexpected version request');
      const release = await readRelease(api + '/latest', init.signal, true);
      return new Response(JSON.stringify({version: release.version, channel: 'stable'}), {headers: {'Content-Type': 'application/json'}});
    },
    async downloadRequest(url, init) {
      if (url !== DESKTOP_DOWNLOAD_URLS[platform]) throw new Error('Unexpected installer request');
      const version = new Headers(init.headers).get(DESKTOP_TARGET_VERSION_HEADER);
      const parsed = typeof version === 'string' ? parseSemVer(version) : null;
      if (!parsed || parsed.version !== version || parsed.prerelease.length) throw new Error('Invalid requested version');
      // Resolve the exact tag again: the asset identity/hash belongs to this confirmed version.
      const release = await readRelease(api + '/tags/v' + version, init.signal);
      if (release.version !== version) throw new Error('The requested release changed');
      const checksum = await request(release.checksum.url, {signal: init.signal, redirect: 'follow', cache: 'no-store'});
      const text = (await limitedText(checksum, 256)).trim();
      const match = /^([a-f0-9]{64})  (.+)$/.exec(text);
      if (!match || match[2] !== release.installer.name
        || (release.installer.digest && release.installer.digest !== 'sha256:' + match[1])) throw new Error('Release checksums do not agree');
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
          if (size !== release.installer.size || hash.digest('hex') !== match[1]) throw new Error('Installer SHA-256 mismatch');
        },
      }));
      return new Response(body, {status: 200, headers: {'Content-Length': String(release.installer.size)}});
    },
  };
}
