import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createReadStream, readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createUpdateManifest, releaseRepository, updateManifestName} from '../src/app/update-manifest.mjs';
import {verifyPublishedUpdate} from './verify-update-feed.mjs';

export const releaseRepo = releaseRepository;
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function files(directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Release artifacts cannot contain symlinks');
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

/** Only the six checked distribution files are published, never CI paths/logs. */
export function collectReleaseAssets(root, version, commit) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.match(commit, /^[a-f0-9]{40}$/);
  const results = files(root).filter(path => basename(path) === 'package-result.json');
  assert.equal(results.length, 2, 'Both platform build records are required');
  const assets = [], platforms = new Set();
  for (const path of results) {
    const result = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(result.sourceCommit, commit);
    assert.equal(result.sourceHasLocalChanges, false, 'Release builds require a clean source checkout');
    assert.equal(result.validation.ok, true); assert.equal(result.validation.packaged, true);
    assert.ok(!platforms.has(result.platform)); platforms.add(result.platform);
    const entries = result.platform === 'darwin'
      ? [[`DSH-Project-Desktop-${version}-mac-universal.dmg`, result.bytes, result.sha256]]
      : result.platform === 'win32' ? [
        [`DSH-Project-Desktop-${version}-win-x64-Setup.exe`, result.bytes.installer, result.sha256.installer],
        [`DSH-Project-Desktop-${version}-win-x64-Portable.zip`, result.bytes.portable, result.sha256.portable],
      ] : [];
    assert.equal(result.arch, result.platform === 'darwin' ? 'universal' : 'x64');
    for (const [name, size, hash] of entries) {
      const file = join(dirname(path), name), checksum = file + '.sha256';
      assert.equal(statSync(file).size, size); assert.equal(sha256(file), hash);
      assert.equal(readFileSync(checksum, 'utf8').trim(), `${hash}  ${name}`);
      for (const asset of [file, checksum]) assets.push({path: asset, name: basename(asset), size: statSync(asset).size, digest: 'sha256:' + sha256(asset)});
    }
  }
  assert.deepEqual([...platforms].sort(), ['darwin', 'win32']); assert.equal(assets.length, 6);
  return assets;
}

/** Keep the previous release as a recoverable private draft during explicit republishing. */
export async function promoteRelease({api, candidate, existing, tag, commit, previousCommit, tagAlreadyTargetsCommit = previousCommit === commit}) {
  let archived = false, moved = false;
  try {
    if (existing) {
      await api(`/releases/${existing.id}`, 'PATCH', {draft: true, tag_name: `archived-${tag}-${existing.id}`});
      archived = true;
    }
    if (!previousCommit) await api('/git/refs', 'POST', {ref: `refs/tags/${tag}`, sha: commit});
    else if (!tagAlreadyTargetsCommit) {await api(`/git/refs/tags/${tag}`, 'PATCH', {sha: commit, force: true}); moved = true}
    return await api(`/releases/${candidate.id}`, 'PATCH', {tag_name: tag, target_commitish: commit, draft: false, prerelease: false, make_latest: 'true'});
  } catch (error) {
    // A publish request may have succeeded despite a lost response; confirm before rolling back.
    const observed = await api(`/releases/${candidate.id}`).catch(() => undefined);
    if (observed?.draft === false && observed.tag_name === tag) return observed;
    if (moved) await api(`/git/refs/tags/${tag}`, 'PATCH', {sha: previousCommit, force: true});
    if (archived) await api(`/releases/${existing.id}`, 'PATCH', {tag_name: tag, draft: false, make_latest: 'true'});
    throw error;
  }
}

async function main(root) {
  const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commit = process.env.GITHUB_SHA;
  assert.equal(process.env.GITHUB_REPOSITORY, releaseRepo);
  const assets = collectReleaseAssets(root, version, commit);
  const manifest = Buffer.from(JSON.stringify(createUpdateManifest(assets, version, commit), null, 2) + '\n');
  const uploads = [...assets, {name: updateManifestName, body: manifest, size: manifest.byteLength,
    digest: 'sha256:' + createHash('sha256').update(manifest).digest('hex')}];
  const token = process.env.GH_TOKEN; assert.ok(token, 'GitHub Actions token is required');
  const api = async (path, method = 'GET', body, optional = false) => {
    const response = await fetch(`https://api.github.com/repos/${releaseRepo}${path}`, {method,
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(30000)});
    if (optional && response.status === 404) return undefined;
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  };
  const tag = `v${version}`;
  const existing = await api(`/releases/tags/${tag}`, 'GET', undefined, true);
  const previous = await api(`/git/ref/tags/${tag}`, 'GET', undefined, true);
  let target = previous?.object;
  for (let depth = 0; target?.type === 'tag' && depth < 8; depth++) target = (await api(`/git/tags/${target.sha}`)).object;
  if (target) assert.equal(target.type, 'commit', 'Version tags must resolve to commits');
  const replace = process.env.RELEASE_REPLACE_EXISTING === 'true';
  if (existing && !replace) throw new Error('Release already exists; explicitly enable replace_existing to republish');
  if (target && target.sha !== commit && !replace) throw new Error('Existing tag points to a different source commit');
  if (existing?.immutable) throw new Error('The existing release is immutable and cannot be replaced');
  const notesPath = new URL(`../docs/releases/${version}.md`, import.meta.url);
  const description = existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : `DSH Project Desktop ${version}`;
  const notes = `${description.trim()}\n\n### Downloads / 下载\n\n${assets.filter(asset => !asset.name.endsWith('.sha256')).map(asset =>
    `- [${asset.name}](https://github.com/${releaseRepo}/releases/download/${tag}/${asset.name}) (${Math.round(asset.size / 1e6)} MB)`).join('\n')}\n\nEach download has a matching SHA-256 file. / 每个下载附带 SHA-256 校验文件。\n\nBuild / 构建: [${commit.slice(0, 7)}](https://github.com/${releaseRepo}/commit/${commit}) · [GitHub Actions](https://github.com/${releaseRepo}/actions/runs/${process.env.GITHUB_RUN_ID})\n`;
  // Upload and verify a private candidate before touching the public release.
  const candidate = await api('/releases', 'POST', {tag_name: `candidate-${tag}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
    target_commitish: commit, name: `DSH Project Desktop ${version}`, body: notes, draft: true, prerelease: false});
  const uploadBase = candidate.upload_url.split('{')[0]; assert.equal(new URL(uploadBase).hostname, 'uploads.github.com');
  for (const asset of uploads) {
    console.log('Uploading', asset.name);
    const response = await fetch(`${uploadBase}?name=${encodeURIComponent(asset.name)}`, {method: 'POST',
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'Content-Length': String(asset.size)},
      body: asset.body ?? createReadStream(asset.path), duplex: 'half', signal: AbortSignal.timeout(300000)});
    if (!response.ok) throw new Error(`Asset upload failed: ${asset.name}, HTTP ${response.status}`);
    const uploaded = await response.json();
    assert.equal(uploaded.state, 'uploaded'); assert.equal(uploaded.size, asset.size); assert.equal(uploaded.digest, asset.digest);
  }
  const staged = await api(`/releases/${candidate.id}`); assert.equal(staged.assets.length, uploads.length);
  const currentRef = await api(`/git/ref/tags/${tag}`, 'GET', undefined, true);
  assert.equal(currentRef?.object.sha, previous?.object.sha, 'The version tag changed during upload');
  const currentRelease = await api(`/releases/tags/${tag}`, 'GET', undefined, true);
  assert.equal(currentRelease?.id, existing?.id, 'The release changed during upload');
  const published = await promoteRelease({api, candidate, existing, tag, commit, previousCommit: previous?.object.sha, tagAlreadyTargetsCommit: target?.sha === commit});
  assert.equal(published.draft, false); assert.equal(published.assets.length, uploads.length);
  console.log('Published verified release:', published.html_url);
  // The mock feed cannot prove anonymous access. Allow CDN propagation, then
  // require both real public entry points and checksums to match this build.
  for (let attempt = 0; ; attempt++) {
    try {console.log('Public update verification:', await verifyPublishedUpdate({version, commit, assets})); break}
    catch (error) {
      if (attempt === 5) throw error;
      console.log('Waiting for public release files:', error.message);
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main(resolve(process.argv[2]));
