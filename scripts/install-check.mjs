import assert from 'node:assert/strict';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createProjectInDirectory} from '../src/app/project-files.mjs';

/** A local installation diagnostic. All fixtures live in a new, launcher-owned temporary directory. */
export async function verifyInstallation({electron, open, close, workspace, showGuide, userData}) {
  assert.equal(electron.app.isPackaged, true);
  const guide = await showGuide();
  await guide.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const text = await guide.webContents.executeJavaScript('document.body.innerText');
  assert.match(text, /最近项目|Recent projects/);
  const paths = await Promise.all(['First', 'Second'].map(name => {const path = join(userData, name); mkdirSync(path); return createProjectInDirectory(path)}));
  const [first, second] = await Promise.all(paths.map(open));
  assert.ok(first && second, 'Packaged projects did not open: ' + JSON.stringify(workspace.failures()));
  assert.notEqual(first.host.result.pid, second.host.result.pid);
  assert.equal(first.host.result.harnessVersion, '0.1.5-rc.2');
  assert.equal((await first.host.request('/api/project/snapshot')).status, 200);
  assert.equal((await second.host.request('/api/project/snapshot')).status, 200);
  await first.host.updateShellSettings('locale', {preference: 'zh'}); first.focus();
  await first.window.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 500))');
  const fileMenu = electron.Menu.getApplicationMenu().items.find(item => item.label === '文件');
  assert.ok(fileMenu?.submenu.items.some(item => item.label === '新建项目…'));
  writeFileSync(join(userData, 'packaged-project.png'), (await first.window.webContents.capturePage()).toPNG());
  const safe = await workspace.safeMode(paths[0]);
  assert.equal(safe.host.result.projectSessionVersion, null);
  const temporary = safe.host.stateDirectory; await workspace.exitSafeMode(paths[0]);
  assert.equal(existsSync(temporary), false);
  await workspace.open(paths[0]);
  await Promise.all(paths.map(path => close(path)));
  const result = {ok: true, packaged: electron.app.isPackaged, name: electron.app.getName(),
    appPath: electron.app.getAppPath(), electron: process.versions.electron, platform: process.platform, arch: process.arch, evidence: userData,
    checks: ['packaged-welcome', 'two-packaged-project-hosts', 'official-renderer-health', 'chinese-native-menu', 'packaged-safe-mode', 'temporary-cleanup', 'normal-reopen']};
  writeFileSync(join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log('INSTALLATION_CHECK=' + JSON.stringify(result));
}
