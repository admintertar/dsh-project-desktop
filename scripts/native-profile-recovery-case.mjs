import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createProjectInDirectory} from '../src/app/project-files.mjs';
import {projectProfiles} from '../src/desktop-adapter/stable/project-profiles.mjs';
import {materializeProjectDependencies} from '../src/desktop-adapter/stable/materialize.mjs';

export async function until(check, label) {
  const deadline = Date.now() + 30000;
  while (!await check()) {if (Date.now() > deadline) throw new Error('Timed out: ' + label); await delay(40)}
}
const body = window => window.webContents.executeJavaScript('document.body.innerText');
export async function nativeWindow(electron, page) {
  let window;
  await until(async () => {
    window = electron.BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes(`/native-ui/${page}.html`));
    if (!window?.isVisible()) return false;
    if (page === 'recovery') {
      const state = JSON.parse(Buffer.from(new URL(window.webContents.getURL()).searchParams.get('state'), 'base64url'));
      if (state.diagnostics.status === 'saving') return false;
    }
    return await window.webContents.executeJavaScript('Boolean(document.querySelector("main") && document.body.innerText.trim())');
  }, page);
  return window;
}
export async function click(window, label) {
  console.log('Native click:', label);
  await until(() => window.webContents.executeJavaScript(`Boolean([...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(label)}))`), label);
  const point = await window.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(label)});
    target.scrollIntoView({block:'center',inline:'center'});
    const r=target.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  })()`);
  window.webContents.sendInputEvent({type: 'mouseDown', ...point, button: 'left', clickCount: 1});
  window.webContents.sendInputEvent({type: 'mouseUp', ...point, button: 'left', clickCount: 1});
}
export async function confirm(electron, response = 0) {
  const dialog = await nativeWindow(electron, 'desktop-dialog');
  await until(() => dialog.webContents.executeJavaScript(`document.querySelectorAll('footer button').length > ${response}`), 'confirmation buttons');
  await dialog.webContents.executeJavaScript(`document.querySelectorAll('footer button')[${response}].click()`);
  await until(() => dialog.isDestroyed(), 'confirmation closed');
}
export async function restartRecovery(electron, window) {
  const zh = (await body(window)).includes('重启 DSH Desktop');
  await click(window, zh ? '重启 DSH Desktop' : 'Restart DSH Desktop');
  await confirm(electron);
}
export async function capture(window, path) {
  await window.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await delay(150);
  writeFileSync(path, (await window.webContents.capturePage()).toPNG());
}

/** Real official windows and real Hosts; runs under an isolated application userData. */
export async function runProfileRecoveryCase({electron, open, close, showProfiles, recover, restart, workspace, session, userData, hasGuide}) {
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('console-message', event => {if (event.level === 'error') console.error('Native test renderer:', event.message)});
  });
  const manifests = await Promise.all(['Alpha', 'Bravo'].map(name => {
    const folder = join(userData, 'fixtures', name); mkdirSync(folder, {recursive: true}); return createProjectInDirectory(folder);
  }));
  let alpha = await open(manifests[0]);
  const bravo = await open(manifests[1]);
  const originalManifest = readFileSync(manifests[0]);
  const stateDirectory = alpha.host.stateDirectory;
  const profiles = await projectProfiles({stateDirectory, manifestPath: manifests[0]});
  const otherPid = bravo.host.result.pid;
  const assertOther = async () => {
    assert.equal(bravo.host.result.pid, otherPid);
    assert.equal((await bravo.host.request('/api/project/snapshot')).status, 200);
  };
  await alpha.host.updateShellSettings('locale', {preference: 'en'});
  electron.nativeTheme.themeSource = 'light'; alpha.focus();
  const pid = alpha.host.result.pid;
  const selector = await showProfiles(manifests[0]);
  const picker = await nativeWindow(electron, 'profile-selector');
  assert.equal((await showProfiles(manifests[0])).window, picker, 'duplicate requests focus the existing chooser');
  await click(picker, 'New Profile');
  let creator = await nativeWindow(electron, 'profile-create');
  assert.equal(await creator.webContents.executeJavaScript('document.activeElement.id'), 'profile-name');
  assert.equal(await creator.webContents.executeJavaScript('typeof require'), 'undefined');
  await click(creator, 'Cancel');
  await until(() => creator.isDestroyed(), 'Profile creation cancelled');
  assert.equal(profiles.list().length, 1);
  await click(picker, 'New Profile');
  creator = await nativeWindow(electron, 'profile-create');
  await capture(creator, join(userData, 'official-profile-create-en.png'));
  await creator.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'review');
    input.dispatchEvent(new Event('input', {bubbles: true}));
  })()`);
  creator.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Return'});
  creator.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Return'});
  await until(() => creator.isDestroyed(), 'Profile created');
  await until(async () => (await body(picker)).includes('review'), 'new Profile listed');
  assert.equal(profiles.current(), 'review');
  assert.equal(alpha.host.result.profileName, 'desktop', 'selection does not change a running Host');
  assert.equal(alpha.host.result.pid, pid);
  await capture(picker, join(userData, 'official-profile-selector-en.png'));
  await click(picker, 'Restart DSH Desktop');
  await selector.result;
  await until(() => workspace.projects.get(manifests[0])?.host.result.profileName === 'review', 'selected Profile booted');
  alpha = workspace.projects.get(manifests[0]);
  assert.notEqual(alpha.host.result.pid, pid);
  assert.equal((await (await alpha.host.request('/api/project/snapshot')).json()).root, join(userData, 'fixtures/Alpha'));
  const market = await (await alpha.host.request('/dsh-market/api/v1/capabilities')).json();
  assert.equal(market.profile, 'review');
  assert.deepEqual(readFileSync(manifests[0]), originalManifest);
  await assertOther();
  await close(manifests[0], {showWelcome: false});
  alpha = await open(manifests[0]);
  assert.equal(alpha.host.result.profileName, 'review', 'selection survives project closure');

  // Manual recovery: real confirmation, no welcome, original official page and cancellation.
  const recoveryRequest = alpha.recover();
  await confirm(electron, 1);
  await recoveryRequest;
  assert.equal(workspace.projects.get(manifests[0]), alpha);
  const requested = alpha.recover();
  await confirm(electron);
  await requested;
  let recoveryWindow = await nativeWindow(electron, 'recovery');
  assert.equal(hasGuide(), false);
  assert.equal(session.get(manifests[0]).phase, 'recovering');
  assert.equal(workspace.errors.has(manifests[0]), false);
  assert.equal(alpha.window.isDestroyed(), true);
  assert.equal(recoveryWindow.webContents.getLastWebPreferences().sandbox, true);
  await capture(recoveryWindow, join(userData, 'official-recovery-en-light.png'));
  await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.has(manifests[0]), 'manual recovery restart');
  alpha = workspace.projects.get(manifests[0]);
  await assertOther();

  // A local disposable package exercises the real official uninstall CLI without a registry.
  await workspace.recover(manifests[0]);
  const packagePath = join(alpha.host.result.profile, 'package.json');
  const fixturePackage = join(alpha.host.result.profile, '.recovery-test-plugin'); mkdirSync(fixturePackage);
  writeFileSync(join(fixturePackage, 'package.json'), JSON.stringify({name: 'dsh-recovery-fixture', version: '1.0.0'}));
  writeFileSync(join(fixturePackage, 'cordis.patch.yml'), '[]\n');
  const packageManifest = JSON.parse(readFileSync(packagePath));
  packageManifest.dependencies['dsh-recovery-fixture'] = 'link:./.recovery-test-plugin';
  packageManifest.dsh.profile.bundles.push('dsh-recovery-fixture');
  writeFileSync(packagePath, JSON.stringify(packageManifest));
  await materializeProjectDependencies({stateDirectory, homeDir: alpha.host.result.homeDir,
    profileDir: alpha.host.result.profile, updateLockfile: true});
  await recover(manifests[0]);
  recoveryWindow = await nativeWindow(electron, 'recovery');
  const recoveryState = JSON.parse(Buffer.from(new URL(recoveryWindow.webContents.getURL()).searchParams.get('state'), 'base64url'));
  assert.equal(recoveryState.snapshot.bundles.find(bundle => bundle.packageName === 'dsh-plugin-project').action, null);
  await click(recoveryWindow, 'Plugin management');
  await click(recoveryWindow, 'Uninstall'); await confirm(electron, 1);
  assert.ok(JSON.parse(readFileSync(packagePath)).dependencies['dsh-recovery-fixture']);
  await click(recoveryWindow, 'Uninstall'); await confirm(electron);
  await until(() => !JSON.parse(readFileSync(packagePath)).dependencies?.['dsh-recovery-fixture'], 'official plugin uninstall');
  await until(() => {
    const state = JSON.parse(Buffer.from(new URL(recoveryWindow.webContents.getURL()).searchParams.get('state'), 'base64url'));
    return !state.busy && !state.snapshot.bundles.some(bundle => bundle.packageName === 'dsh-recovery-fixture');
  }, 'plugin inventory refreshed');
  await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.has(manifests[0]), 'project after plugin uninstall');
  alpha = workspace.projects.get(manifests[0]);
  await assertOther();

  // Startup failure routes to the same assistant. Restore uses the official confirmation UI.
  const settings = join(alpha.host.result.homeDir, 'settings.yaml');
  await workspace.recover(manifests[0]);
  writeFileSync(settings, 'broken-for-recovery: [');
  await open(manifests[0]);
  recoveryWindow = await nativeWindow(electron, 'recovery');
  assert.equal(hasGuide(), false);
  await click(recoveryWindow, 'Rollback');
  await capture(recoveryWindow, join(userData, 'official-recovery-rollback.png'));
  await click(recoveryWindow, 'Restore this checkpoint');
  await confirm(electron, 1);
  assert.equal(readFileSync(settings, 'utf8'), 'broken-for-recovery: [');
  await click(recoveryWindow, 'Restore this checkpoint');
  await confirm(electron);
  await until(() => !readFileSync(settings, 'utf8').includes('broken-for-recovery'), 'checkpoint restored');
  await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.has(manifests[0]), 'restored Profile opened');
  alpha = workspace.projects.get(manifests[0]);
  await assertOther();

  // Chinese/dark recovery, Profile switching inside recovery, and safe-mode exit.
  await alpha.host.updateShellSettings('locale', {preference: 'zh'}); alpha.focus();
  electron.nativeTheme.themeSource = 'dark';
  await recover(manifests[0]);
  recoveryWindow = await nativeWindow(electron, 'recovery');
  await capture(recoveryWindow, join(userData, 'official-recovery-zh-dark.png'));
  recoveryWindow.setBounds({width: 680, height: 560});
  await capture(recoveryWindow, join(userData, 'official-recovery-zh-dark-narrow.png'));
  assert.equal(await recoveryWindow.webContents.executeJavaScript('document.documentElement.scrollWidth > innerWidth'), false);
  assert.equal(await recoveryWindow.webContents.executeJavaScript('document.querySelector("footer").getBoundingClientRect().bottom > innerHeight'), false);
  await click(recoveryWindow, '切换 Profile');
  await until(() => recoveryWindow.webContents.executeJavaScript(`Boolean(document.querySelector('a[href*="switch-profile"][href*="desktop"]'))`), 'Profile switch action');
  await recoveryWindow.webContents.executeJavaScript(`document.querySelector('a[href*="switch-profile"][href*="desktop"]').click()`);
  await until(() => profiles.current() === 'desktop', 'recovery selected desktop');
  await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.get(manifests[0])?.host.result.profileName === 'desktop', 'recovery switched Profile');
  alpha = workspace.projects.get(manifests[0]);
  await recover(manifests[0]);
  recoveryWindow = await nativeWindow(electron, 'recovery');
  await click(recoveryWindow, '进入安全模式'); await confirm(electron);
  await until(() => workspace.projects.get(manifests[0])?.safeMode, 'official Safe Mode action');
  const safe = workspace.projects.get(manifests[0]);
  const temporary = safe.host.stateDirectory;
  safe.window.close();
  recoveryWindow = await nativeWindow(electron, 'recovery');
  assert.equal(existsSync(temporary), false);
  assert.equal(hasGuide(), false);
  await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.has(manifests[0]), 'normal project after Safe Mode');
  await assertOther();

  // Renderer and Host crashes both use the assistant and preserve the other project.
  alpha = workspace.projects.get(manifests[0]);
  alpha.window.webContents.forcefullyCrashRenderer();
  recoveryWindow = await nativeWindow(electron, 'recovery');
  await assertOther(); await restartRecovery(electron, recoveryWindow);
  await until(() => workspace.projects.has(manifests[0]), 'renderer crash recovery');
  process.kill(workspace.projects.get(manifests[0]).host.result.pid, 'SIGKILL');
  recoveryWindow = await nativeWindow(electron, 'recovery');
  await assertOther();
  recoveryWindow.close();
  await until(() => !session.get(manifests[0]), 'closing recovery closes only this project');
  await assertOther();
  assert.deepEqual(readFileSync(manifests[0]), originalManifest);
  const result = {ok: true, platform: process.platform, arch: process.arch, evidence: userData,
    checks: ['official-profile-create-and-select', 'persisted-selection', 'project-plugin-and-market-binding',
      'manual-recovery-and-cancel', 'official-plugin-uninstall-and-cancel', 'protected-project-plugin', 'automatic-startup-recovery', 'official-checkpoint-confirm-and-cancel',
      'recovery-profile-switch', 'official-safe-mode-entry', 'safe-mode-exit-to-recovery',
      'renderer-and-host-crash-recovery', 'close-only-current-project', 'two-project-isolation', 'en-light-zh-dark-native-windows']};
  writeFileSync(join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
