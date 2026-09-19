import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadDesktop} from '../src/desktop-adapter/stable/modules.mjs';
import {nativeWindow, click, confirm, restartRecovery} from './native-profile-recovery-case.mjs';

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
export async function checkNativeRecovery({electron, workspace, session, manifests, userData, bravo}) {
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
  let recoveryWindow = await nativeWindow(electron, 'recovery');
  assert.equal(session.get(manifests[0]).phase, 'recovering');
  const settings = join(alpha.host.result.homeDir, 'settings.yaml');
  writeFileSync(settings, 'invalid-settings: [');
  const chinese = (await recoveryWindow.webContents.executeJavaScript('document.body.innerText')).includes('快速恢复');
  await click(recoveryWindow, chinese ? '回滚' : 'Rollback');
  await textReady(recoveryWindow, chinese ? '恢复此检查点' : 'Restore this checkpoint');
  writeFileSync(join(userData, 'project-recovery.png'), (await recoveryWindow.webContents.capturePage()).toPNG());
  await click(recoveryWindow, chinese ? '恢复此检查点' : 'Restore this checkpoint');
  await confirm(electron);
  await until(() => !readFileSync(settings, 'utf8').includes('invalid-settings'), 'configuration restored');
  await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.has(manifests[0]) && session.get(manifests[0]).phase === 'open', 'recovered project');
  const recovered = workspace.projects.get(manifests[0]);
  assert.notEqual(recovered.host.result.pid, oldPid);
  assert.doesNotMatch(readFileSync(settings, 'utf8'), /invalid-settings/);
  assert.equal(recovered.window.getNormalBounds().width, 980);
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);

  process.kill(recovered.host.result.pid, 'SIGKILL');
  await until(() => workspace.failures().some(item => item.path === manifests[0]), 'Host failure recorded');
  assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
  recoveryWindow = await nativeWindow(electron, 'recovery');
  await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.has(manifests[0]), 'Host restarted from recovery');
  const retried = workspace.projects.get(manifests[0]); assert.notEqual(retried.host.result.pid, recovered.host.result.pid);
  assert.equal(retried.window.getNormalBounds().width, 980);
  const {exportDiagnosticsZip} = await loadDesktop('diagnostic-export');
  const zip = await exportDiagnosticsZip(join(retried.host.stateDirectory, 'logs'), retried.host.stateDirectory, {appVersion: 'DSH Project Desktop native validation'});
  assert.equal(readFileSync(zip).subarray(0, 2).toString(), 'PK');
}
