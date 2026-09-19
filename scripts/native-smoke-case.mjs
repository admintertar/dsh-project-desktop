import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createProjectInDirectory} from '../src/app/project-files.mjs';
import {checkGuide, checkProjectCreateEntryPoints} from './native-guide-checks.mjs';
import {checkGuideRemote} from './native-guide-remote-checks.mjs';
import {checkGuideAdd} from './native-guide-add-checks.mjs';
import {productVersion} from '../src/app/product.mjs';

export async function runNativeSmoke({electron, open, close, showGuide, theme, userData, repository, workspace, session}) {
  const guide = await showGuide();
  guide.showInactive();
  await guide.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const check = () => {if (document.querySelector('h1')) return requestAnimationFrame(resolve);
      if (Date.now() > deadline) return reject(new Error('Guide did not render')); setTimeout(check, 50)}; check();
  })`);
  assert.match(await guide.webContents.executeJavaScript('document.body.innerText'), /Recent projects|最近项目/);
  assert.equal(await guide.webContents.executeJavaScript('typeof require'), 'undefined');
  assert.ok(await guide.webContents.executeJavaScript(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-button-primary-fill').trim().length > 0`));
  writeFileSync(join(userData, 'guide.png'), (await guide.webContents.capturePage()).toPNG());
  await checkProjectCreateEntryPoints({electron, guide});
  await checkGuide({electron, repository, userData});
  await checkGuideRemote({electron, repository, userData});
  await checkGuideAdd({electron, repository, userData});
  const manifests = await Promise.all(['Alpha', 'Bravo'].map(name => {
    const path = join(userData, 'fixtures', name); mkdirSync(path, {recursive: true}); return createProjectInDirectory(path);
  }));
  const [alpha, bravo] = await Promise.all(manifests.map(open));
  assert.equal(await open(manifests[0]), alpha, 'duplicate opens share one project');
  assert.notEqual(alpha.host.result.pid, bravo.host.result.pid);
  assert.notEqual(alpha.window.webContents.session, bravo.window.webContents.session);
  for (const project of [alpha, bravo]) {
    project.window.showInactive();
    await project.window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 15000;
      const check = () => {
        const text = document.body.innerText;
        if ((text.includes('Alpha') || text.includes('Bravo')) && !/正在读取项目|Loading project/.test(text)) return resolve(true);
        if (Date.now() > deadline) return reject(new Error(text));
        setTimeout(check, 100);
      }; check();
    })`);
    assert.equal(project.window.webContents.getLastWebPreferences().sandbox, true);
    const inspection = await project.window.webContents.executeJavaScript(`({text: document.body.innerText,
      mode: document.body.dataset.dshDesktopMode, node: typeof require,
      bridge: typeof window.dshDesktopActions?.invoke})`);
    assert.equal(inspection.mode, 'advanced'); assert.equal(inspection.node, 'undefined'); assert.equal(inspection.bridge, 'function');
    assert.match(inspection.text, /Tasks|任务/);
    assert.doesNotMatch(inspection.text, /内测声明|Internal Testing|Add an API key to get started/);
    await project.window.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    writeFileSync(join(userData, `${project.window.getTitle()}.png`), (await project.window.webContents.capturePage()).toPNG());
    assert.equal(new URL(project.window.webContents.getURL()).searchParams.get('dsh-desktop-version'), productVersion);
  }
  await alpha.host.selectTheme('dark');
  const deadline = Date.now() + 5000;
  while (await bravo.host.getTheme() !== 'dark' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(electron.nativeTheme.themeSource, 'dark');
  assert.equal(await alpha.host.getTheme(), 'dark'); assert.equal(await bravo.host.getTheme(), 'dark');
  assert.equal(JSON.parse(readFileSync(join(userData, 'theme.json'))).preference, 'dark');
  await alpha.window.webContents.executeJavaScript(`new Promise(resolve => {
    const tick = () => document.body.hasAttribute('data-ds-dark-theme') ? requestAnimationFrame(resolve) : setTimeout(tick, 50); tick();
  })`);
  writeFileSync(join(userData, 'Alpha-dark.png'), (await alpha.window.webContents.capturePage()).toPNG());
  await close(manifests[0]);
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
  const reopened = await open(manifests[0]);
  assert.notEqual(reopened.host.result.pid, alpha.host.result.pid);
  assert.equal(await reopened.host.getTheme(), 'dark');
  await theme.select('light');
  await bravo.host.updateShellSettings('locale', {preference: 'en'});
  electron.app.focus({steal: true});
  bravo.window.show();
  bravo.focus();
  const localeDeadline = Date.now() + 5000;
  while (!electron.Menu.getApplicationMenu().items.some(item => item.label === 'File') && Date.now() < localeDeadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(electron.Menu.getApplicationMenu().items.some(item => item.label === 'File'), JSON.stringify({
    locale: bravo.locale, focused: electron.BrowserWindow.getFocusedWindow()?.id, target: bravo.window.id,
    projects: [...workspace.projects.values()].map(item => ({id: item.window.id, locale: item.locale})),
    menus: electron.Menu.getApplicationMenu().items.map(item => item.label),
  }));
  await bravo.window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {
      const settings = [...document.querySelectorAll('button')].find(button => ['Settings', '设置'].includes(button.innerText.trim()) || ['Settings', '设置'].includes(button.getAttribute('aria-label')));
      if (settings) {settings.click(); return resolve(true)}
      if (Date.now() > deadline) return reject(new Error(document.body.innerText)); setTimeout(check, 50);
    }; check();
  })`);
  await bravo.window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const check = () => {const models = [...document.querySelectorAll('button')].find(button => ['Models', '模型'].includes(button.innerText.trim()));
      if (models) {models.click(); return resolve(true)} if (Date.now() > deadline) return reject(new Error(document.body.innerText)); setTimeout(check, 50)}; check();
  })`);
  await bravo.window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const check = () => {if (/Add provider|添加提供方/i.test(document.body.innerText)) return requestAnimationFrame(resolve);
      if (Date.now() > deadline) return reject(new Error(document.body.innerText)); setTimeout(check, 50)}; check();
  })`);
  writeFileSync(join(userData, 'Bravo-models-en-light.png'), (await bravo.window.webContents.capturePage()).toPNG());
  await (await import('./native-recovery-checks.mjs')).checkNativeRecovery({electron, open, showGuide, workspace, session, manifests, userData, bravo});
  await (await import('./native-restart-checks.mjs')).checkNativeRestart({electron, workspace, manifests, userData, bravo});
  await (await import('./native-safe-checks.mjs')).checkNativeSafeMode({electron, workspace, session, manifests, userData, bravo});
  await theme.select('system');
  await close(manifests[0]);
  const restarted = await workspace.restart(manifests[1]);
  assert.notEqual(restarted.host.result.pid, bravo.host.result.pid);
  assert.equal((await restarted.host.request('/api/project/snapshot')).status, 200);
  const result = {ok: true, electron: process.versions.electron, desktop: '2.0.11',
    checks: ['own-guide', 'independent-project-create-window', 'guide-create-and-retry', 'guide-english-chinese-light-dark', 'guide-narrow-scroll-and-keyboard',
      'guide-remote-modal-validation-and-layout', 'guide-private-https-authentication-and-branch', 'guide-reuses-completed-clone',
      'guide-add-resource-local-inspection-and-git-import', 'guide-add-resource-cancel-validation-and-responsive-layout',
      'two-native-project-windows', 'separate-chromium-sessions', 'sandboxed-preload', 'native-menu-locale', 'official-model-settings-without-onboarding',
      'healthy-official-advanced-and-project-client', 'shell-product-version', 'shared-native-theme', 'native-close-reopen-isolation', 'last-project-restart',
      'welcome-search-stable-layout', 'native-desktop-settings', 'native-settings-header-actions', 'native-project-market-settings', 'renderer-crash-isolation', 'host-crash-isolation', 'checkpoint-restore-ui', 'diagnostic-zip',
      'all-native-menu-roles-zh-en', 'native-restart-confirmation', 'safe-mode-with-broken-normal-settings', 'safe-mode-no-project-plugin', 'safe-mode-session-and-cleanup', 'safe-mode-normal-reopen'],
    evidence: userData};
  writeFileSync(join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!guide.isDestroyed()) guide.close();
}
