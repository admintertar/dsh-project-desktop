import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadDesktop} from '../src/desktop-adapter/stable/modules.mjs';

async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (!await check()) {if (Date.now() > deadline) throw new Error('Timed out: ' + label); await new Promise(resolve => setTimeout(resolve, 50))}
}
async function textReady(window, fragment) {
  await until(async () => !window.isDestroyed() && (await window.webContents.executeJavaScript('document.body.innerText')).includes(fragment), fragment);
}
async function clickText(window, label) {
  await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find(button => button.innerText.trim() === ${JSON.stringify(label)});
    if (!button) throw new Error(document.body.innerText); button.click();
  })()`);
}
export async function checkNativeRecovery({open, showGuide, workspace, session, manifests, userData, bravo}) {
  await clickText(bravo.window, 'Desktop');
  await textReady(bravo.window, 'Enable desktop notifications');
  await textReady(bravo.window, 'Choose one plugin market for this project');
  const nativeActions = await bravo.window.webContents.executeJavaScript(`[...document.querySelectorAll('button')]
    .map(button => button.innerText.trim()).filter(label => ['Open configuration file', 'Export Diagnostics', 'Open DSH Terminal', 'Restart'].includes(label))`);
  assert.deepEqual(nativeActions, ['Open configuration file', 'Export Diagnostics', 'Open DSH Terminal', 'Restart']);
  await clickText(bravo.window, 'Restart');
  await until(async () => bravo.window.webContents.executeJavaScript(`document.querySelectorAll('[role=menuitem]').length === 3`), 'restart menu actions');
  const restartActions = await bravo.window.webContents.executeJavaScript(`[...document.querySelectorAll('[role=menuitem]')].map(item => item.innerText.trim())`);
  assert.deepEqual(restartActions, ['Reload interface', 'Restart', 'Restart in Recovery Mode']);
  await clickText(bravo.window, 'Restart');
  await until(async () => bravo.window.webContents.executeJavaScript(`document.querySelectorAll('[role=menuitem]').length === 0`), 'restart menu dismissal');
  await bravo.host.updateShellSettings('locale', {preference: 'zh'});
  await until(async () => bravo.window.webContents.executeJavaScript(`document.body.innerText.includes('导出诊断信息')`), 'native actions switch to Chinese');
  const chineseNativeActions = await bravo.window.webContents.executeJavaScript(`[...document.querySelectorAll('button')]
    .map(button => button.innerText.trim()).filter(label => ['打开配置文件', '导出诊断信息', '打开 DSH 终端', '重启'].includes(label))`);
  assert.deepEqual(chineseNativeActions, ['打开配置文件', '导出诊断信息', '打开 DSH 终端', '重启']);
  await bravo.host.updateShellSettings('locale', {preference: 'en'});
  await until(async () => bravo.window.webContents.executeJavaScript(`document.body.innerText.includes('Export Diagnostics')`), 'native actions switch back to English');
  const marketChoices = await bravo.window.webContents.executeJavaScript(`[...document.querySelectorAll('[role=radio]')].map(choice => ({
    text: choice.innerText, checked: choice.getAttribute('aria-checked'), disabled: choice.getAttribute('aria-disabled'),
  }))`);
  assert.equal(marketChoices.length, 3);
  assert.ok(marketChoices.some(choice => choice.text.includes('dsh-market') && choice.checked === 'true'));
  assert.ok(marketChoices.some(choice => choice.text.includes('dsh-community-market')
    && choice.text.includes('Unavailable on the current stable runtime') && choice.disabled === 'true'));
  await until(async () => bravo.window.webContents.executeJavaScript(`document.querySelector('[role=switch]')?.disabled === false`), 'notification settings ready');
  await bravo.window.webContents.executeJavaScript(`document.querySelector('[role=switch]').click()`);
  await until(async () => bravo.window.webContents.executeJavaScript(`document.querySelector('[role=switch]')?.getAttribute('aria-checked') === 'false'`), 'notification setting saved');
  assert.match(readFileSync(join(bravo.host.result.homeDir, 'settings.yaml'), 'utf8'), /enabled: false/);
  assert.equal(await bravo.window.webContents.executeJavaScript(`document.querySelectorAll('[role=switch]:disabled').length`), 4);
  await bravo.window.webContents.executeJavaScript(`document.querySelector('[role=switch]').click()`);
  await until(async () => bravo.window.webContents.executeJavaScript(`document.querySelectorAll('[role=switch]:disabled').length === 0`), 'notifications re-enabled');
  writeFileSync(join(userData, 'desktop-settings-en-light.png'), (await bravo.window.webContents.capturePage()).toPNG());

  const alpha = workspace.projects.get(manifests[0]);
  alpha.window.setBounds({x: 70, y: 80, width: 980, height: 720});
  const oldPid = alpha.host.result.pid;
  alpha.window.webContents.forcefullyCrashRenderer();
  await until(() => workspace.failures().some(item => item.path === manifests[0]), 'renderer failure recorded');
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
  assert.equal(session.get(manifests[0]).phase, 'failed');
  const settings = join(alpha.host.result.homeDir, 'settings.yaml');
  writeFileSync(settings, 'invalid-settings: [');
  const guide = await showGuide(); guide.showInactive();
  await textReady(guide, 'Alpha');
  const chinese = (await guide.webContents.executeJavaScript('document.documentElement.lang')) === 'zh';
  await clickText(guide, chinese ? '恢复项目配置' : 'Recover project settings');
  await textReady(guide, chinese ? '健康检查点' : 'Healthy checkpoint');
  writeFileSync(join(userData, 'project-recovery.png'), (await guide.webContents.capturePage()).toPNG());
  await clickText(guide, chinese ? '恢复并打开' : 'Restore and open');
  await until(async () => guide.webContents.executeJavaScript(`Boolean(document.querySelector('[role=dialog]'))`), 'restore confirmation');
  await guide.webContents.executeJavaScript(`[...document.querySelectorAll('[role=dialog] button')].at(-1).click()`);
  await until(() => workspace.projects.has(manifests[0]) && session.get(manifests[0]).phase === 'open', 'recovered project');
  const recovered = workspace.projects.get(manifests[0]);
  assert.notEqual(recovered.host.result.pid, oldPid);
  assert.doesNotMatch(readFileSync(settings, 'utf8'), /invalid-settings/);
  assert.equal(recovered.window.getNormalBounds().width, 980);
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);

  process.kill(recovered.host.result.pid, 'SIGKILL');
  await until(() => workspace.failures().some(item => item.path === manifests[0]), 'Host failure recorded');
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
  const retried = await open(manifests[0]); assert.notEqual(retried.host.result.pid, recovered.host.result.pid);
  assert.equal(retried.window.getNormalBounds().width, 980);
  const {exportDiagnosticsZip} = await loadDesktop('diagnostic-export');
  const zip = await exportDiagnosticsZip(join(retried.host.stateDirectory, 'logs'), retried.host.stateDirectory, {appVersion: 'DSH Project Desktop native validation'});
  assert.equal(readFileSync(zip).subarray(0, 2).toString(), 'PK');
}
