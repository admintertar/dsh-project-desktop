import electron from 'electron';
import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {createProjectUpdates} from '../src/desktop-adapter/stable/project-updates.mjs';
import {productVersion} from '../src/app/product.mjs';
import {latestUpdateManifestUrl, parseUpdateManifest} from '../src/app/update-manifest.mjs';
import {verifyPublishedUpdate} from './verify-update-feed.mjs';

// Read-only live release check, in its own Electron/userData. No project Hosts,
// substituted responses, credentials, installer downloads or installation.
const {app, net, BrowserWindow} = electron;
assert.ok(process.env.DSH_PROJECT_DESKTOP_SMOKE_DATA);
const userData = resolve(process.env.DSH_PROJECT_DESKTOP_SMOKE_DATA);
app.setPath('userData', userData);
app.setName('DSH Project Update Check');
app.on('window-all-closed', () => {});
let updates;
const requests = [];
const request = async (url, init) => {
  assert.equal(new URL(url).hostname, 'github.com', 'Live update must not call the GitHub REST API');
  assert.equal(new Headers(init.headers).has('Authorization'), false);
  const response = await net.fetch(url, init);
  requests.push({url, status: response.status});
  return response;
};
// Electron waits for its ESM entry module before emitting ready. Keep that
// module synchronous instead of awaiting app.whenReady() at top level.
void app.whenReady().then(async () => {
  const response = await request(latestUpdateManifestUrl, {redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(20000)});
  assert.equal(response.status, 200);
  const manifest = parseUpdateManifest(await response.json());
  assert.equal(manifest.version, productVersion, 'Run against the currently published product version');
  if (process.env.DSH_PROJECT_UPDATE_COMMIT) assert.equal(manifest.sourceCommit, process.env.DSH_PROJECT_UPDATE_COMMIT);
  await verifyPublishedUpdate({version: productVersion, commit: manifest.sourceCommit, request,
    assets: manifest.assets.map(asset => ({...asset, digest: 'sha256:' + asset.sha256}))});
  updates = await createProjectUpdates(electron, {userData, locale: () => 'zh', request,
    policy: {enabled: false}, packaged: true});
  const pending = updates.checkNow();
  let window;
  const deadline = Date.now() + 30000;
  while (true) {
    window = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/native-ui/desktop-dialog.html'));
    if (window?.isVisible() && await window.webContents.executeJavaScript('Boolean(document.querySelector("footer button"))')) break;
    if (Date.now() > deadline) throw new Error('Live official update dialog did not open');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const options = JSON.parse(Buffer.from(new URL(window.webContents.getURL()).searchParams.get('state'), 'base64url').toString());
  assert.equal(options.type, 'info', options.detail);
  assert.ok(options.detail.includes(productVersion));
  assert.match(options.message, /最新版本/);
  await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  writeFileSync(join(userData, 'live-update-dialog.png'), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript('document.querySelector("footer button").click()');
  await pending;
  const result = {ok: true, platform: process.platform, arch: process.arch, version: productVersion, sourceCommit: manifest.sourceCommit,
    githubApiUsed: false, authenticated: false, realPublicNetwork: true, officialDialogRendered: true, requests};
  writeFileSync(join(userData, 'live-update-result.json'), JSON.stringify(result, null, 2));
  console.log('Live update checks passed:', JSON.stringify(result));
}).catch(error => {console.error(error); process.exitCode = 1})
  .finally(async () => {await updates?.dispose(); app.quit()});
