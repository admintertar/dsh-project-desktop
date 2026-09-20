import assert from 'node:assert/strict';
import {createUpdateManifest, parseUpdateManifest, latestUpdateManifestUrl, versionUpdateManifestUrl} from '../src/app/update-manifest.mjs';

/** Exercise public release downloads without GitHub authentication or REST API calls. */
export async function verifyPublishedUpdate({version, commit, assets, request = fetch}) {
  const expected = createUpdateManifest(assets, version, commit);
  for (const url of [versionUpdateManifestUrl(version), latestUpdateManifestUrl]) {
    const response = await request(url, {redirect: 'follow', cache: 'no-store', headers: {Accept: 'application/json'},
      signal: AbortSignal.timeout(20000)});
    assert.equal(response.status, 200, `Public manifest unavailable: HTTP ${response.status}`);
    const text = await response.text();
    assert.ok(Buffer.byteLength(text) <= 16 * 1024, 'Public manifest exceeds its size limit');
    assert.deepEqual(parseUpdateManifest(JSON.parse(text)), expected, 'Public manifest differs from the verified release');
  }
  for (const asset of expected.assets) {
    const response = await request(asset.url + '.sha256', {redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(20000)});
    assert.equal(response.status, 200, `Public checksum unavailable: ${asset.name}`);
    assert.equal((await response.text()).trim(), `${asset.sha256}  ${asset.name}`);
  }
  return {ok: true, version, sourceCommit: commit, authenticated: false, githubApiUsed: false};
}
