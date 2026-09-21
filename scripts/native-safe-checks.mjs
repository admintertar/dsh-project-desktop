import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (!await check()) {if (Date.now() > deadline) throw new Error('Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 50))}
}
export async function checkNativeSafeMode({electron, workspace, manifests, userData, bravo, session}) {
  const original = workspace.projects.get(manifests[0]);
  const originalSession = original.window.webContents.session;
  await original.host.updateShellSettings('locale', {preference: 'zh'});
  electron.app.focus({steal: true}); original.focus();
  // macOS keeps the quit item in the leading application menu; Windows closes the
  // window instead and has no quit entry, so the localized labels below are the
  // portable part of this check.
  if (process.platform !== 'win32') {
    const hasQuit = menu => menu.items.some(item => (item.label ?? '').includes('退出') || Boolean(item.submenu && hasQuit(item.submenu)));
    await until(() => hasQuit(electron.Menu.getApplicationMenu()), 'all native menu labels follow Chinese');
  }
  const menu = electron.Menu.getApplicationMenu();
  for (const label of ['编辑', '视图', '窗口']) {
    const entry = menu.items.find(item => item.label === label); assert.ok(entry, label);
    for (const item of entry.submenu.items.filter(item => item.role)) assert.match(item.label, /[\u4e00-\u9fff]/);
  }
  writeFileSync(join(userData, 'native-menu-zh.json'), JSON.stringify(menu.items.map(item => ({label: item.label,
    children: item.submenu?.items.map(child => ({label: child.label, role: child.role}))})), null, 2));
  await workspace.recover(manifests[0]);
  const settingsPath = join(original.host.result.homeDir, 'settings.yaml');
  const settings = readFileSync(settingsPath); writeFileSync(settingsPath, 'broken-for-safe-mode: [');
  const safe = await workspace.safeMode(manifests[0]);
  safe.window.showInactive();
  assert.equal(safe.safeMode, true); assert.notEqual(safe.window.webContents.session, originalSession);
  assert.equal(safe.window.webContents.session.isPersistent(), false);
  assert.equal(session.get(manifests[0]).phase, 'failed');
  assert.equal(safe.host.result.projectSessionVersion, null);
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
  await safe.host.updateShellSettings('locale', {preference: 'zh'});
  await until(async () => (await safe.window.webContents.executeJavaScript('document.body.innerText')).includes('安全模式'), 'safe mode notice');
  writeFileSync(join(userData, 'safe-mode-zh.png'), (await safe.window.webContents.capturePage()).toPNG());
  const temporary = safe.host.stateDirectory;
  await workspace.exitSafeMode(manifests[0]);
  assert.equal(existsSync(temporary), false);
  assert.equal(readFileSync(settingsPath, 'utf8'), 'broken-for-safe-mode: [');
  writeFileSync(settingsPath, settings);
  const reopened = await workspace.open(manifests[0]);
  assert.equal(reopened.safeMode, false); assert.equal((await reopened.host.request('/api/project/snapshot')).status, 200);
  await bravo.host.updateShellSettings('locale', {preference: 'en'}); bravo.focus();
  await until(() => {
    const labels = electron.Menu.getApplicationMenu().items.map(item => item.label);
    return ['Edit', 'View', 'Window'].every(label => labels.includes(label));
  }, 'native menu switches back to English');
}
