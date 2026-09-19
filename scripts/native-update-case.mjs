import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createProjectInDirectory} from '../src/app/project-files.mjs';
import {productVersion} from '../src/app/product.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (!await check()) {if (Date.now() > deadline) throw new Error('Timed out: ' + label); await pause(50)}
}

/** Real Shell entrances and official dialogs, with a deterministic release feed.
 * The save picker and OS installer launch are substituted for synthetic artifacts.
 */
export async function runUpdateCase({electron, open, close, showGuide, updates, userData, workspace, fixture}) {
  let captures = 0;
  const dialogWindows = () => electron.BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes('/native-ui/desktop-dialog.html'));
  async function dialog(parent) {
    let window;
    await until(async () => {
      window = dialogWindows()[0];
      return window?.isVisible() && await window.webContents.executeJavaScript('Boolean(document.querySelector("footer button"))');
    }, 'official update dialog');
    assert.equal(window.getParentWindow(), parent);
    assert.equal(window.isModal(), true);
    const options = JSON.parse(Buffer.from(new URL(window.webContents.getURL()).searchParams.get('state'), 'base64url').toString());
    assert.doesNotMatch(options.title, /(?<!Project )DSH Desktop/);
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)'); await pause(200);
    const layout = await window.webContents.executeJavaScript('({overflow:document.body.scrollWidth>innerWidth,bottom:document.querySelector("footer").getBoundingClientRect().bottom,height:innerHeight})');
    assert.equal(layout.overflow, false); assert.ok(layout.bottom <= layout.height);
    writeFileSync(join(userData, `update-dialog-${++captures}.png`), (await window.webContents.capturePage()).toPNG());
    return {window, options, async choose(index) {
      await window.webContents.executeJavaScript(`document.querySelectorAll('footer button')[${index}].click()`);
      await until(() => window.isDestroyed(), 'dialog closed');
    }};
  }
  let guide = await showGuide(); guide.show();
  await until(() => guide.webContents.executeJavaScript('Boolean(document.querySelector("[data-check-updates]"))'), 'welcome update button');
  fixture.state.offline = true;
  await guide.webContents.executeJavaScript('document.querySelector("[data-check-updates]").click()');
  const failed = await dialog(guide); assert.equal(failed.options.type, 'warning'); await failed.choose(0);
  fixture.state.offline = false;
  const paths = await Promise.all(['Update Alpha', 'Update Bravo'].map(name => {const path = join(userData, name); mkdirSync(path); return createProjectInDirectory(path)}));
  const [alpha, bravo] = await Promise.all(paths.map(open));
  const pids = [alpha.host.result.pid, bravo.host.result.pid];
  alpha.focus();
  await until(() => alpha.window.webContents.executeJavaScript(`Boolean([...document.querySelectorAll('button')].find(button => ['Settings','设置'].includes(button.innerText.trim())))`), 'official settings entrance');
  await alpha.window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(button => ['Settings','设置'].includes(button.innerText.trim())).click()`);
  await until(() => alpha.window.webContents.executeJavaScript('Boolean(document.querySelector(".dshDesktopFrameVersion"))'), 'official version control');
  const anchor = await alpha.window.webContents.executeJavaScript('(() => {const el=document.querySelector(".dshDesktopFrameVersion"),r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),text:el.textContent}})()');
  assert.equal(anchor.text, 'v' + productVersion);
  alpha.window.webContents.sendInputEvent({type: 'mouseMove', x: anchor.x, y: anchor.y});
  await until(() => alpha.window.webContents.executeJavaScript('Boolean(document.querySelector(".dshDesktopVersionCheckButton"))'), 'official version popover');
  await pause(200);
  writeFileSync(join(userData, 'official-version-popover.png'), (await alpha.window.webContents.capturePage()).toPNG());
  await alpha.window.webContents.executeJavaScript('document.querySelector(".dshDesktopVersionCheckButton").click()');
  await (await dialog(alpha.window)).choose(0);
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) {
    alpha.focus();
    await alpha.host.updateShellSettings('locale', {preference: locale});
    await alpha.host.selectTheme(theme);
    await until(() => alpha.locale === locale, 'native update locale');
    assert.equal(new URL(alpha.window.webContents.getURL()).searchParams.get('dsh-desktop-version'), productVersion);
    await alpha.window.webContents.executeJavaScript('void window.dshDesktopActions.invoke("check-for-updates"); true');
    const latest = await dialog(alpha.window);
    const sameCheck = updates.checkNow(bravo.window);
    assert.equal(dialogWindows().length, 1, 'all project entrances share one dialog');
    assert.ok(latest.options.detail.includes(productVersion));
    latest.window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'});
    await until(() => latest.window.isDestroyed(), 'Escape cancels official update dialog');
    await sameCheck;
  }
  fixture.state.version = fixture.nextVersion;
  const pending = updates.checkNow(alpha.window);
  const available = await dialog(alpha.window);
  assert.ok(available.options.message.includes(fixture.nextVersion)); assert.equal(available.options.defaultId, 1);
  await available.choose(1); await pending;
  assert.equal(fixture.state.opened.length, 0, 'Later must not download or install');
  const originalPicker = electron.dialog.showSaveDialog;
  const target = join(userData, process.platform === 'darwin' ? 'fixture.dmg' : 'fixture.exe');
  electron.dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  try {
    const downloading = updates.checkNow(alpha.window);
    await (await dialog(alpha.window)).choose(0);
    const ready = await dialog(alpha.window);
    assert.ok(existsSync(target));
    assert.ok(ready.options.message.includes(fixture.nextVersion));
    await ready.choose(process.platform === 'darwin' ? 0 : 1);
    await downloading;
    if (process.platform === 'darwin') assert.deepEqual(fixture.state.opened, [target]);
  } finally {electron.dialog.showSaveDialog = originalPicker}
  assert.deepEqual([alpha.host.result.pid, bravo.host.result.pid], pids);
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
  await Promise.all(paths.map(path => close(path)));
  guide = await showGuide(); guide.show();
  guide.setMinimumSize(360, 300); guide.setSize(420, 640);
  await until(() => guide.webContents.executeJavaScript('innerWidth <= 420 && Boolean(document.querySelector("[data-check-updates]"))'), 'narrow welcome');
  const geometry = await guide.webContents.executeJavaScript('({overflow:document.documentElement.scrollWidth>innerWidth,button:document.querySelector("[data-check-updates]").getBoundingClientRect().right,width:innerWidth})');
  assert.equal(geometry.overflow, false); assert.ok(geometry.button <= geometry.width);
  writeFileSync(join(userData, 'updates-welcome-narrow.png'), (await guide.webContents.capturePage()).toPNG());
  const check = updates.checkNow(guide); await (await dialog(guide)).choose(1); await check;
  assert.equal(workspace.projects.size, 0);
  const result = {ok: true, platform: process.platform, realDialogsRendered: captures, savePickerAndInstallerHandoffSubstituted: true,
    checks: ['welcome-without-host', 'offline-warning', 'official-version-popover', 'renderer-ipc', 'shared-multi-project-check', 'own-product-version', 'english-chinese-light-dark',
      'keyboard-cancel', 'download-confirmation-and-later', 'verified-download', 'normal-projects-unaffected', 'narrow-welcome', 'all-projects-closed-update']};
  writeFileSync(join(userData, 'updates-result.json'), JSON.stringify(result, null, 2));
  console.log('Update UI checks passed:', JSON.stringify(result));
}
