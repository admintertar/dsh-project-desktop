import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createProjectFile} from '../dist/project-files.mjs';

async function until(read, check, label) {
  let value;
  for (let n = 0; n < 200; n++) {value = await read(); if (check(value)) return value; await delay(75)}
  throw new Error('Update smoke timed out: ' + label + ' ' + JSON.stringify(value));
}
const evaluate = (window, code) => window.webContents.executeJavaScript(code);
async function click(window, expression) {
  window.show(); window.focus();
  await evaluate(window, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const point = await until(() => evaluate(window, `(()=>{const e=${expression};if(!e||e.disabled||e.closest('[inert]'))return null;const r=e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`), Boolean, expression);
  window.webContents.sendInputEvent({type: 'mouseDown', ...point, button: 'left', clickCount: 1});
  window.webContents.sendInputEvent({type: 'mouseUp', ...point, button: 'left', clickCount: 1});
}
async function escape(window) {
  window.show(); window.focus();
  await evaluate(window, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'});
  window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Escape'});
}
async function setLocale(window, preference) {
  await evaluate(window, `(async()=>{const rpc=async(method,args={})=>{const r=await fetch('/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:${JSON.stringify(randomUUID())},method,payload:{args}})});const v=await r.json();if(!v.result?.ok)throw new Error('Settings rejected');return v.result.value};const s=await rpc('settings/describe');await rpc('settings/update',{ns:'locale',patch:{preference:${JSON.stringify(preference)}},expectedRevision:s.namespaces.find(n=>n.ns==='locale').revision})})()`);
  await until(() => evaluate(window, 'document.documentElement.lang'), value => value.startsWith(preference), 'locale');
}
const status = window => evaluate(window, 'window.dshDesktop.updates.status()');
const indicator = pattern => `[...document.querySelectorAll('button[aria-label]')].find(e=>${pattern}.test(e.getAttribute('aria-label')))`;

export async function runOfficialShellSmoke({electron, open, close, restart, workspace, userData, updates, updateFixture: fixture}) {
  const captures = [];
  const capture = async (window, name) => {
    window.show(); window.focus();
    assert.ok(['dsh-app://app/', 'dsh-app://shell/update-dialog.html'].includes(window.webContents.getURL()));
    await evaluate(window, 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    writeFileSync(join(userData, name + '.png'), (await window.webContents.capturePage()).toPNG()); captures.push(name);
  };
  const dialog = pattern => until(async () => {
    const window = electron.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='dsh-app://shell/update-dialog.html');
    if (!window) return;
    const text = await evaluate(window, 'document.body.innerText');
    return pattern.test(text) && window.isVisible() ? window : undefined;
  }, Boolean, 'official update dialog ' + pattern);
  const make = name => {const directory = join(userData, name); mkdirSync(directory); return createProjectFile(join(directory, name + '.agent-project'))};
  const ma = make('updates-alpha'), mb = make('updates-beta');
  let a = await open(ma), b = await open(mb);
  try {
    a.focus();
    await setLocale(a.window, 'zh'); await setLocale(b.window, 'en');
    assert.equal((await status(a.window)).phase, 'idle');
    assert.equal(await evaluate(a.window, `!!(${indicator('/^(新版本|Update|安装并重启|Install and Restart)$/')})`), false);
    fixture.latest = fixture.current;
    const noUpdate = updates.open(a.window, true, 'zh');
    await escape(await dialog(/已是最新版本/)); await noUpdate;
    console.log('Update native: current-version cancellation passed');
    assert.equal((await status(a.window)).phase, 'idle');
    fixture.checkError = true;
    const failed = updates.open(a.window, true, 'zh');
    await escape(await dialog(/检查更新失败/)); await failed;
    for (const project of [a, b]) assert.equal((await status(project.window)).failure, 'check-network');
    fixture.checkError = false; fixture.latest = fixture.next;
    const pending = updates.open(a.window, true, 'zh');
    const confirm = await dialog(/发现新版本/);
    assert.equal(updates.open(b.window, true), pending, 'Two windows must share one prompt');
    await escape(confirm); await pending;
    console.log('Update native: shared confirmation cancellation passed');
    assert.equal(fixture.requests.some(url => url.endsWith('.dmg')), false);
    for (const project of [a, b]) {
      assert.equal((await status(project.window)).phase, 'available');
      await until(() => evaluate(project.window, `!!(${indicator('/^(新版本|Update)$/')})`), Boolean, 'official sidebar indicator');
    }
    await a.host.setTheme('dark');
    await until(() => evaluate(a.window, 'document.body.hasAttribute("data-ds-dark-theme")'), Boolean, 'dark theme');
    await capture(a.window, 'update-sidebar-zh-dark');
    console.log('Update native: sidebar geometry and theme passed');
    // Closing the prompt owner is cancellation, and the other project remains usable.
    const ownerClosing = updates.open(a.window, true, 'zh');
    await dialog(/发现新版本/);
    console.log('Update native: closing prompt owner');
    await close(ma, {showWelcome: false}); await ownerClosing;
    console.log('Update native: prompt owner closed');
    a = await open(ma);
    assert.equal((await status(a.window)).phase, 'available');
    assert.equal((await b.host.request('/api/project/snapshot')).status, 200);
    // Real sidebar click retries the failed download through the official bridge.
    fixture.downloadError = true;
    await click(b.window, indicator('/^Update$/'));
    await escape(await dialog(/Could not download/));
    await until(() => updates.state.phase, value => value === 'error', 'download error');
    await until(() => evaluate(b.window, `!!(${indicator('/^Retry update$/')})`), Boolean, 'retry indicator');
    fixture.downloadError = false; fixture.holdDownload = true;
    await click(b.window, indicator('/^Retry update$/'));
    await until(() => status(b.window), value => value.phase === 'downloading' && value.percent > 0, 'actual transfer progress');
    for (const project of [a, b]) {
      const state = await status(project.window); assert.equal(state.phase, 'downloading'); assert.ok(state.percent > 0);
    }
    await b.host.setTheme('light');
    await until(() => evaluate(b.window, 'document.body.hasAttribute("data-ds-dark-theme")'), value => !value, 'light theme');
    await capture(b.window, 'update-sidebar-en-progress');
    await until(() => fixture.releaseDownload, Boolean, 'paused fixture stream'); fixture.releaseDownload();
    const ready = await dialog(/ready to install/);
    await capture(ready, 'update-official-install-confirm');
    await escape(ready);
    await until(() => status(b.window), value => value.phase === 'ready', 'cancel keeps downloaded installer');
    assert.equal(fixture.installed.length, 0);
    // A fresh project renderer reads the same application-level ready state.
    a = await restart(ma);
    assert.equal((await status(a.window)).phase, 'ready');
    await click(b.window, indicator('/^Install and Restart$/'));
    const accepted = await dialog(/ready to install/);
    await click(accepted, `document.querySelector('#actions button:first-child')`);
    await until(() => fixture.installed.length, value => value === 1, 'confirmed handoff');
    assert.equal(workspace.projects.size, 2);
    assert.equal(fixture.installed[0].endsWith(fixture.next.name), true);
    // Narrow geometry uses the official collapsed presentation and remains operable.
    b.window.setSize(852, 672);
    await until(() => evaluate(b.window, 'innerWidth'), value => value === 852, 'narrow window');
    const entryVisible = await evaluate(b.window, `(()=>{const e=${indicator('/^Install and Restart$/')};if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`);
    if (!entryVisible) await click(b.window, indicator('/^Open sidebar$/'));
    await until(() => evaluate(b.window, `(()=>{const e=${indicator('/^Install and Restart$/')};if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`), Boolean, 'narrow sidebar update entry');
    assert.equal(await evaluate(b.window, 'document.documentElement.scrollWidth > innerWidth'), false);
    await close(ma, {showWelcome: false}); await close(mb, {showWelcome: false});
    writeFileSync(join(userData, 'updates-result.json'), JSON.stringify({platform: process.platform, arch: process.arch,
      officialVersion: '0.2.0-rc.2', originalOfficialSidebarAndDialog: true, ownReleaseFeed: true,
      idleHidden: true, currentVersionAndNetworkFailure: true, sharedAcrossWindows: true,
      manualDownloadCancellation: true, promptOwnerClosure: true, downloadRetryAndProgress: true,
      cancelledInstallStaysReady: true, reopenedWindowReadsReady: true, explicitInstallerHandoff: true,
      fixtureInstallerNotExecuted: true, chineseDarkEnglishLight: true, narrowNoOverflow: true, captures}, null, 2));
    console.log('Official update sidebar smoke passed.');
  } finally {
    fixture.releaseDownload?.(); updates.cancelPrompt();
    for (const path of workspace.projects.keys()) await close(path, {showWelcome: false});
  }
}
