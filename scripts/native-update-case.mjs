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
  const updateMenuItem = () => electron.Menu.getApplicationMenu().getMenuItemById('project-check-for-updates');
  function checkApplicationMenu() {
    const menu = electron.Menu.getApplicationMenu();
    assert.equal(menu.items.some(item => ['Help', '帮助'].includes(item.label)), false);
    if (process.platform !== 'darwin') {assert.equal(updateMenuItem(), null); return}
    const application = menu.items[0];
    assert.equal(application.label, 'DSH Project Desktop');
    const items = application.submenu.items;
    const index = items.findIndex(item => item.id === 'project-check-for-updates');
    assert.ok(index > items.findIndex(item => item.role === 'about'));
    assert.ok(index < items.findIndex(item => item.role === 'services'));
    assert.equal(items[index - 1].type, 'separator');
    assert.equal(items[index + 1].type, 'separator');
    const item = updateMenuItem();
    assert.equal(item, items[index]);
    assert.equal(item.label, updates.label());
    assert.equal(item.enabled, !updates.busy);
    return item;
  }
  async function checkSettings() {
    await until(() => alpha.window.webContents.executeJavaScript('Boolean(document.querySelector(".dshDesktopNativeActions[data-placement=settings]"))'), 'official settings actions');
    assert.equal(await alpha.window.webContents.executeJavaScript('Boolean(document.querySelector(".dshDesktopFrameVersion, .dshDesktopVersionCheckButton"))'), false,
      'Settings must not add a version/update popover');
  }
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
  const failed = await dialog(guide); assert.equal(failed.options.type, 'warning');
  assert.match(failed.options.detail, /网络|network/); await failed.choose(0);
  fixture.state.offline = false;
  await until(() => !updates.busy, 'failed check completed');
  for (const status of [403, 429]) {
    fixture.state.status = status;
    const pending = updates.checkNow(guide);
    const failed = await dialog(guide);
    assert.match(failed.options.detail, new RegExp(`HTTP ${status}`));
    await failed.choose(0); await pending;
  }
  fixture.state.status = 200;
  checkApplicationMenu();
  // Installed startup/restoration may have no focused welcome window. In that
  // case menu refresh immediately reads the project's native locale.
  guide.hide();
  const paths = await Promise.all(['Update Alpha', 'Update Bravo'].map(name => {const path = join(userData, name); mkdirSync(path); return createProjectInDirectory(path)}));
  let [alpha, bravo] = await Promise.all(paths.map(open));
  await alpha.host.updateShellSettings('locale', {preference: 'system'});
  alpha = await workspace.restart(paths[0]);
  for (const project of [alpha, bravo]) assert.ok(['zh', 'en'].includes(project.locale), `Invalid native locale: ${project.locale}`);
  const pids = [alpha.host.result.pid, bravo.host.result.pid];
  electron.app.focus({steal: true}); alpha.focus();
  await until(() => alpha.window.webContents.executeJavaScript(`Boolean([...document.querySelectorAll('button')].find(button => ['Settings','设置'].includes(button.innerText.trim())))`), 'official settings entrance');
  await alpha.window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(button => ['Settings','设置'].includes(button.innerText.trim())).click()`);
  await checkSettings();
  if (process.platform === 'darwin') {
    const item = checkApplicationMenu();
    item.click(item, alpha.window, {});
  } else await alpha.window.webContents.executeJavaScript('void window.dshDesktopActions.invoke("check-for-updates"); true');
  await (await dialog(alpha.window)).choose(0);
  await until(() => !updates.busy, 'update menu re-enabled');
  checkApplicationMenu();
  for (const locale of ['en', 'zh']) for (const theme of ['light', 'dark']) {
    alpha.focus();
    await alpha.host.updateShellSettings('locale', {preference: locale});
    await alpha.host.selectTheme(theme);
    await until(() => alpha.locale === locale, 'native update locale');
    await checkSettings();
    await alpha.window.webContents.executeJavaScript('document.fonts.ready.then(() => true)'); await pause(200);
    writeFileSync(join(userData, `settings-${locale}-${theme}.png`), (await alpha.window.webContents.capturePage()).toPNG());
    checkApplicationMenu();
    writeFileSync(join(userData, `update-menu-${locale}-${theme}.json`), JSON.stringify(electron.Menu.getApplicationMenu().items.map(item =>
      ({label: item.label, children: item.submenu?.items.map(child => ({id: child.id, label: child.label, role: child.role, type: child.type, enabled: child.enabled}))})), null, 2));
    assert.equal(new URL(alpha.window.webContents.getURL()).searchParams.get('dsh-desktop-version'), productVersion);
    if (process.platform === 'darwin' && theme === 'dark') {
      const item = checkApplicationMenu(); item.click(item, alpha.window, {});
    } else await alpha.window.webContents.executeJavaScript('void window.dshDesktopActions.invoke("check-for-updates"); true');
    const latest = await dialog(alpha.window);
    checkApplicationMenu();
    const sameCheck = updates.checkNow(bravo.window);
    assert.equal(dialogWindows().length, 1, 'all project entrances share one dialog');
    assert.ok(latest.options.detail.includes(productVersion));
    latest.window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'});
    await until(() => latest.window.isDestroyed(), 'Escape cancels official update dialog');
    await sameCheck;
    checkApplicationMenu();
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
  // The same download in English and light theme: the welcome copy follows the active project locale.
  fixture.state.chunkSize = 128; fixture.state.chunkDelayMs = 500;
  await alpha.host.selectTheme('light');
  await alpha.host.updateShellSettings('locale', {preference: 'en'});
  await until(() => alpha.locale === 'en', 'english locale for the welcome download');
  guide = await showGuide(); guide.show();
  const englishPicker = electron.dialog.showSaveDialog;
  electron.dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  try {
    const englishDownload = updates.checkNow(guide);
    await (await dialog(guide)).choose(0);
    let english;
    await until(async () => {
      const text = await guide.webContents.executeJavaScript('document.querySelector("[data-check-updates]")?.innerText.trim() ?? ""');
      if (!/^Downloading \d+%$/u.test(text)) return false;
      english = text; return true;
    }, 'english welcome download progress');
    assert.match(english, /^Downloading \d+%$/u);
    writeFileSync(join(userData, 'updates-welcome-downloading-en-light.png'), (await guide.webContents.capturePage()).toPNG());
    await (await dialog(guide)).choose(0);
    await englishDownload;
  } finally {electron.dialog.showSaveDialog = englishPicker}
  assert.equal(updates.phase, 'idle');
  fixture.state.chunkSize = 0; fixture.state.chunkDelayMs = 0;
  await alpha.host.selectTheme('dark');
  await alpha.host.updateShellSettings('locale', {preference: 'zh'});
  await until(() => alpha.locale === 'zh', 'chinese locale restored');
  guide.hide();
  await Promise.all(paths.map(path => close(path)));
  guide = await showGuide(); guide.show();
  guide.setMinimumSize(360, 300); guide.setSize(420, 640);
  await until(() => guide.webContents.executeJavaScript('innerWidth <= 420 && Boolean(document.querySelector("[data-check-updates]"))'), 'narrow welcome');
  const geometry = await guide.webContents.executeJavaScript('({overflow:document.documentElement.scrollWidth>innerWidth,button:document.querySelector("[data-check-updates]").getBoundingClientRect().right,width:innerWidth})');
  assert.equal(geometry.overflow, false); assert.ok(geometry.button <= geometry.width);
  writeFileSync(join(userData, 'updates-welcome-narrow.png'), (await guide.webContents.capturePage()).toPNG());
  // A real download over the verified feed: the welcome button and the application menu must both
  // show the Shell-owned percentage while the official lifecycle is downloading.
  fixture.state.chunkSize = 128; fixture.state.chunkDelayMs = 500;
  const progressPicker = electron.dialog.showSaveDialog;
  electron.dialog.showSaveDialog = async () => ({canceled: false, filePath: target});
  try {
    const progressDownload = updates.checkNow(guide);
    await (await dialog(guide)).choose(0);
    let copy;
    await until(async () => {
      const text = await guide.webContents.executeJavaScript('document.querySelector("[data-check-updates]")?.innerText.trim() ?? ""');
      if (!/^(正在下载|Downloading) \d+%$/u.test(text)) return false;
      copy = text; return true;
    }, 'welcome button download progress');
    assert.match(copy, /^(正在下载|Downloading) \d+%$/u);
    assert.equal(updates.phase, 'downloading');
    if (process.platform === 'darwin') assert.equal(checkApplicationMenu().label, updates.label());
    const downloading = await guide.webContents.executeJavaScript('({overflow:document.documentElement.scrollWidth>innerWidth,button:document.querySelector("[data-check-updates]").getBoundingClientRect().right,width:innerWidth})');
    assert.equal(downloading.overflow, false); assert.ok(downloading.button <= downloading.width);
    writeFileSync(join(userData, 'updates-welcome-downloading.png'), (await guide.webContents.capturePage()).toPNG());
    await (await dialog(guide)).choose(process.platform === 'darwin' ? 0 : 1);
    await progressDownload;
  } finally {electron.dialog.showSaveDialog = progressPicker}
  assert.equal(updates.phase, 'idle');
  assert.equal(updates.progress, undefined);
  fixture.state.chunkSize = 0; fixture.state.chunkDelayMs = 0;
  const check = updates.checkNow(guide); await (await dialog(guide)).choose(1); await check;
  assert.equal(workspace.projects.size, 0);
  checkApplicationMenu();
  assert.ok(fixture.state.requests.every(url => new URL(url).hostname === 'github.com'), 'No anonymous REST API requests');
  assert.ok(fixture.state.requests.some(url => url.endsWith('/latest/download/update.json')));
  assert.ok(fixture.state.requests.some(url => url.endsWith(`/download/v${fixture.nextVersion}/update.json`)));
  const result = {ok: true, platform: process.platform, realDialogsRendered: captures, savePickerAndInstallerHandoffSubstituted: true,
    checks: ['welcome-without-host', 'offline-warning', 'system-locale-after-restart', 'settings-without-version-popover',
      ...(process.platform === 'darwin' ? ['official-application-menu-placement', 'application-menu-action-and-busy-state'] : ['no-extra-help-menu']),
      'static-manifest-no-rest-api', 'network-and-http-error-details', 'renderer-ipc', 'shared-multi-project-check', 'own-product-version', 'english-chinese-light-dark',
      'keyboard-cancel', 'download-confirmation-and-later', 'verified-download', 'welcome-download-progress', 'welcome-download-progress-english-light', 'normal-projects-unaffected', 'narrow-welcome', 'all-projects-closed-update']};
  writeFileSync(join(userData, 'updates-result.json'), JSON.stringify(result, null, 2));
  console.log('Update UI checks passed:', JSON.stringify(result));
}
