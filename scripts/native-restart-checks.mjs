import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'yaml';
import {runtimePackage} from '../src/desktop-adapter/paths.mjs';
import {nativeWindow, restartRecovery} from './native-profile-recovery-case.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  const deadline = Date.now() + 20000;
  while (!await check()) {if (Date.now() > deadline) throw new Error('Timed out: ' + label); await pause(50)}
}
const evaluate = (project, code) => project.window.webContents.executeJavaScript(code);
async function click(project, label) {
  const selector = `[...document.querySelectorAll('button')].find(b => b.innerText.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)})`;
  await until(() => evaluate(project, `Boolean(${selector})`), label);
  await evaluate(project, `${selector}.click()`);
}
async function restartMenu(project, label, choice) {
  await click(project, label);
  await until(() => evaluate(project, `document.querySelectorAll('[role=menuitem]').length === 3`), 'restart menu');
  await evaluate(project, `[...document.querySelectorAll('[role=menuitem]')].find(b => b.innerText.trim() === ${JSON.stringify(choice)}).click()`);
}

/** Real official dialog windows, settings, preload IPC and two isolated project Hosts. */
export async function checkNativeRestart({electron, workspace, manifests, userData, bravo}) {
  let project = workspace.projects.get(manifests[0]);
  const original = project, otherPid = bravo.host.result.pid;
  const dialogs = [];
  const dialogUrl = pathToFileURL(join(runtimePackage, 'lib/native-ui/desktop-dialog.html')).href;
  const windows = () => electron.BrowserWindow.getAllWindows().filter(window =>
    window.getParentWindow() === project.window && window.webContents.getURL().split('?')[0] === dialogUrl);
  const waitDialog = async count => {
    let window;
    await until(async () => {
      window = windows()[0];
      return window?.isVisible() && await window.webContents.executeJavaScript(`Boolean(document.querySelector('#desktop-dialog-title') && document.querySelector('footer button'))`);
    }, 'official restart confirmation ' + count);
    const options = JSON.parse(Buffer.from(new URL(window.webContents.getURL()).searchParams.get('state'), 'base64url').toString('utf8'));
    const dialog = {window, options, async resolve({response}) {
      await window.webContents.executeJavaScript(`document.querySelectorAll('footer button')[${response}].click()`);
      await until(() => window.isDestroyed(), 'official dialog response');
    }};
    dialogs.push(dialog); assert.equal(dialogs.length, count);
    assert.equal(window.getParentWindow(), project.window); assert.equal(window.isModal(), true);
    assert.equal(dialog.options.type, 'question'); assert.equal(dialog.options.defaultId, 1); assert.equal(dialog.options.cancelId, 1);
    const preferences = window.webContents.getLastWebPreferences();
    assert.equal(preferences.sandbox, true); assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false);
    const content = await window.webContents.executeJavaScript(`({message:document.querySelector('h1').textContent,
      buttons:[...document.querySelectorAll('footer button')].map(b=>b.textContent),
      focused:document.activeElement?.textContent, question:Boolean(document.querySelector('svg.lucide-circle-question-mark')),
      node:typeof require})`);
    assert.equal(content.message, options.message); assert.deepEqual(content.buttons, options.buttons);
    assert.equal(content.focused, options.buttons[1]); assert.equal(content.question, true); assert.equal(content.node, 'undefined');
    await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)'); await pause(300);
    const geometry = await window.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,
      bottom:document.querySelector('footer').getBoundingClientRect().bottom,overflow:document.body.scrollWidth>innerWidth})`);
    assert.equal(geometry.overflow, false); assert.ok(geometry.bottom <= geometry.height);
    writeFileSync(join(userData, `restart-dialog-${count}.png`), (await window.webContents.capturePage()).toPNG());
    return dialog;
  };
  try {
    await project.host.updateShellSettings('locale', {preference: 'zh'});
    project.window.showInactive();
    await click(project, '设置'); await click(project, '桌面');
    await until(() => evaluate(project, `Boolean(document.querySelector('button[aria-label="窗口材质"]:not(:disabled)'))`), 'material settings');
    const active = project.host.specification.material;
    // macOS starts with glass; Windows starts with solid and exposes Mica only when supported.
    await click(project, '窗口材质');
    const items = await evaluate(project, `[...document.querySelectorAll('[role=menuitem]')].map(b=>b.innerText.trim())`);
    await click(project, '窗口材质');
    let count = 0, selected = active;
    if (items.length > 1) {
      selected = active === 'off' ? (process.platform === 'darwin' ? 'transparent' : 'mica') : 'off';
      const label = selected === 'off' ? '纯色背景' : selected === 'mica' ? 'Mica' : '玻璃背景';
      await click(project, '窗口材质');
      await evaluate(project, `[...document.querySelectorAll('[role=menuitem]')].find(b=>b.innerText.trim()===${JSON.stringify(label)}).click()`);
      const confirmation = await waitDialog(++count);
      assert.equal(confirmation.options.message, '现在重启当前项目？');
      assert.match(confirmation.options.detail, /未发送的内容可能丢失/);
      assert.match(confirmation.options.detail, /已保存的设置会保留/);
      assert.equal(project.window.isDestroyed(), false);
      await confirmation.resolve({response: 1});
      await until(() => evaluate(project, `Boolean(document.querySelector('.projectDesktopRestartNotice'))`), 'saved restart notice');
      const field = process.platform === 'darwin' ? 'macosMaterial' : 'windowsMaterial';
      assert.equal(parse(readFileSync(join(project.host.result.homeDir, 'settings.yaml'), 'utf8'))['dsh-desktop'][field], selected);
      assert.equal(await evaluate(project, 'document.body.dataset.dshDesktopMaterial'), active);
      await project.host.updateShellSettings('dsh-desktop', {logLevel: 'warn'});
      await project.host.updateShellSettings('dsh-desktop', {[field]: selected});
      await pause(150); assert.equal(dialogs.length, count, 'live/repeated settings must not prompt again');
    }
    electron.nativeTheme.themeSource = 'dark'; await project.host.setTheme('dark');
    await restartMenu(project, '重启', '重启');
    const cancelled = await waitDialog(++count);
    cancelled.window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'});
    await until(() => cancelled.window.isDestroyed(), 'Escape cancels official dialog'); await pause(100);
    assert.equal(workspace.projects.get(manifests[0]), project);
    await restartMenu(project, '重启', '重启到恢复模式');
    const recoveryCancelled = await waitDialog(++count);
    assert.match(recoveryCancelled.options.message, /恢复模式/);
    await recoveryCancelled.resolve({response: 1}); await pause(100);
    assert.equal(workspace.projects.get(manifests[0]), project);
    await project.host.updateShellSettings('locale', {preference: 'en'});
    electron.nativeTheme.themeSource = 'light'; await project.host.setTheme('light');
    await restartMenu(project, 'Restart', 'Restart');
    const confirmed = await waitDialog(++count);
    assert.match(confirmed.options.message, /this project/);
    const coalesced = project.restart(); await pause(100);
    assert.equal(windows().length, 1, 'native menu and renderer requests share one confirmation');
    await confirmed.resolve({response: 0});
    project = await coalesced;
    assert.notEqual(project.host.result.pid, original.host.result.pid);
    assert.equal(project.host.specification.material, selected);
    assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
    assert.equal(bravo.host.result.pid, otherPid);
    const recovery = project.recover();
    const recoveryConfirmed = await waitDialog(++count);
    await recoveryConfirmed.resolve({response: 0}); await recovery;
    assert.equal(project.window.isDestroyed(), true);
    assert.equal(workspace.projects.has(manifests[0]), false);
    assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
    await restartRecovery(electron, await nativeWindow(electron, 'recovery'));
    await until(() => workspace.projects.has(manifests[0]), 'official recovery restarted project');
    const result = {ok: true, materialTested: items.length > 1, checks: [...(items.length > 1 ? ['material-native-confirmation', 'cancel-keeps-saved-settings', 'confirmed-restart-applies-material'] : []),
      'settings-menu-restart-confirmation', 'settings-menu-recovery-confirmation', 'current-window-locale',
      'coalesced-restart-requests', 'other-project-unaffected', 'official-dialog-rendered', 'official-dialog-keyboard-cancel', 'official-dialog-light-dark'],
      dialogOptions: dialogs.map(item => item.options), realDialogsRendered: true, nativeResponsesAutomated: true};
    writeFileSync(join(userData, 'restart-confirmation.json'), JSON.stringify(result, null, 2));
    console.log('Native restart confirmation passed:', join(userData, 'restart-confirmation.json'));
  } finally {
    for (const window of new Set([...windows(), ...dialogs.map(dialog => dialog.window)])) if (!window.isDestroyed()) window.close();
  }
}
