import {EventEmitter} from 'node:events';
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {lstat, mkdir, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseUpdateManifest, latestUpdateManifestUrl, versionUpdateManifestUrl} from '../../app/update-manifest.mjs';

const metadataLimit = 16 * 1024;
const packageLimit = 4 * 1024 ** 3;

/** AppUpdater's check/download event contract, backed exclusively by our published update.json. */
export class ProjectReleaseUpdater extends EventEmitter {
  constructor({directory, request, platform = process.platform, arch = process.arch, timeoutMs = 60000}) {
    super(); Object.assign(this, {directory, request, platform, arch, timeoutMs});
    this.lifetime = new AbortController();
  }
  async release(url, signal) {
    const response = await this.request(url, {method: 'GET', signal, redirect: 'follow', cache: 'no-store', headers: {Accept: 'application/json'}});
    if (!response.ok || !response.body) throw new Error('Update manifest is unavailable');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > metadataLimit) throw new Error('Update manifest exceeds its size limit');
        chunks.push(Buffer.from(value));
      }
    } finally {await reader.cancel().catch(() => {}); reader.releaseLock()}
    let manifest;
    try {manifest = parseUpdateManifest(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))))}
    catch {throw new Error('Invalid Project Desktop update manifest')}
    const suffix = this.platform === 'darwin' ? 'mac-universal.dmg' : this.platform === 'win32' && this.arch === 'x64' ? 'win-x64-Setup.exe' : undefined;
    if (!suffix) throw new Error('Unsupported Project Desktop update platform');
    const installer = manifest.assets.find(asset => asset.name === `DSH-Project-Desktop-${manifest.version}-${suffix}`);
    if (!installer || installer.size > packageLimit) throw new Error('Invalid Project Desktop installer');
    return {...manifest, installer};
  }
  async checkForUpdates() {
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(this.timeoutMs)]);
    const release = await this.release(latestUpdateManifestUrl, signal);
    this.candidate = release;
    // The official coordinator owns semantic version validation and downgrade prevention.
    return {isUpdateAvailable: true, updateInfo: {version: release.version}};
  }
  async downloadUpdate() {
    const candidate = this.candidate;
    if (!candidate) throw new Error('No confirmed Project Desktop update');
    const controller = new AbortController();
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal]);
    let deadline;
    const touch = () => {clearTimeout(deadline); deadline = setTimeout(() => controller.abort(new Error('ETIMEDOUT')), this.timeoutMs)};
    let temporary;
    try {
      touch();
      const release = await this.release(versionUpdateManifestUrl(candidate.version), signal);
      if (release.version !== candidate.version || release.sourceCommit !== candidate.sourceCommit
        || JSON.stringify(release.installer) !== JSON.stringify(candidate.installer)) throw new Error('The confirmed update changed; check again');
      await mkdir(this.directory, {recursive: true, mode: 0o700});
      if (!(await lstat(this.directory)).isDirectory()) throw new Error('Invalid update storage');
      const destination = join(this.directory, release.installer.name);
      const existing = await lstat(destination).catch(error => {if (error.code !== 'ENOENT') throw error});
      if (existing && !existing.isFile()) throw new Error('Invalid installer destination');
      temporary = destination + '.' + randomUUID() + '.part';
      const response = await this.request(release.installer.url, {signal, redirect: 'follow', cache: 'no-store'});
      if (!response.ok || !response.body) throw new Error('Installer download is unavailable');
      let transferred = 0, reportedPercent = -1, reportedAt = -Infinity;
      const hash = createHash('sha256'), total = release.installer.size;
      const progress = () => {
        const percent = Math.floor(transferred / total * 100), now = performance.now();
        if (percent === reportedPercent || (reportedPercent > 0 && percent < 100 && now - reportedAt < 250)) return;
        reportedPercent = percent; reportedAt = now;
        this.emit('download-progress', {percent, transferred, total});
      };
      progress();
      await pipeline(Readable.fromWeb(response.body), new Transform({transform(chunk, _encoding, callback) {
        touch(); transferred += chunk.length;
        if (transferred > total) {callback(new Error('Installer size mismatch')); return}
        hash.update(chunk); progress(); callback(null, chunk);
      }}), createWriteStream(temporary, {flags: 'wx', mode: 0o600}), {signal});
      if (transferred !== total || hash.digest('hex') !== release.installer.sha256) throw new Error('Installer SHA-256 mismatch');
      signal.throwIfAborted();
      await rename(temporary, destination); temporary = undefined;
      this.artifact = {path: destination, ...release.installer, version: release.version};
      this.emit('update-downloaded', {version: release.version});
      return [destination];
    } finally {clearTimeout(deadline); if (temporary) await rm(temporary, {force: true})}
  }
  async verifiedArtifact() {
    const artifact = this.artifact;
    if (!artifact) throw new Error('No verified installer is ready');
    const info = await lstat(artifact.path);
    if (!info.isFile() || info.size !== artifact.size) throw new Error('Installer changed after download');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(artifact.path)) hash.update(chunk);
    if (hash.digest('hex') !== artifact.sha256) throw new Error('Installer changed after download');
    return artifact;
  }
  // Published DMG/NSIS artifacts require the Shell's explicit, platform-specific handoff.
  quitAndInstall() {throw new Error('Use the Project Desktop installer handoff')}
  dispose() {this.lifetime.abort()}
}
