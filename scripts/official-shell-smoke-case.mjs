import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createProjectFile} from '../dist/project-files.mjs';
import {createGuideWindow} from '../src/windows/guide-window.mjs';
import {repository} from '../src/desktop-adapter/official/paths.mjs';
import {checkProjectCreateEntryPoints} from './native-guide-checks.mjs';
import {projectStatePath} from '../src/app/project-state.mjs';
import {checkOfficialAccount, checkOfficialBrowser} from './official-account-smoke-case.mjs';

async function until(read, check, label) {
  const deadline = Date.now() + 15000;
  let value;
  do {value = await read(); if (check(value)) return value; await delay(100)} while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

/** 经正式 main、ProjectWorkspace、窗口 IPC 验证；全部数据位于调用方临时目录。 */
export async function runOfficialShellSmoke({electron, open, close, restart, showGuide, showProjectCreate, workspace, userData, officialIpc, deepLinks}) {
  const errors = [];
  const collect = window => window.webContents.on('console-message', event => {if (event.level === 'error') errors.push(event.message)});
  const capture = async (window, name) => {
    electron.app.focus({steal: true}); window.show(); window.focus();
    // capturePage 直接捕获已验证的 WebContents；不以桌面坐标推断原生材质或前台状态。
    assert.equal(window.webContents.getURL().startsWith('file:') || window.webContents.getURL() === 'dsh-app://app/', true);
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    writeFileSync(join(userData, name + '.png'), (await window.webContents.capturePage()).toPNG());
  };
  // 引导窗口组合继续复用官方控件；覆盖中英文、明暗、窄布局、取消与键盘分隔线。
  for (const locale of ['en', 'zh']) {
    console.log('Official smoke: create guide', locale);
    const form = await createGuideWindow(electron, {repository, locale, mode: 'create', hidden: true,
      recent: {list: () => []}, defaultDirectory: userData, open: async () => {throw new Error('Unexpected guide submission')}});
    try {
      console.log('Official smoke: guide ready', locale);
      await until(() => form.webContents.executeJavaScript('Boolean(document.querySelector(".guideResizeHandle"))'), Boolean, 'Guide frame');
      const widths = await form.webContents.executeJavaScript(`(() => {
        const handle = document.querySelector('.guideResizeHandle'); const before = Number(handle.getAttribute('aria-valuenow'));
        handle.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true})); return before;
      })()`);
      await until(() => form.webContents.executeJavaScript('Number(document.querySelector(".guideResizeHandle").getAttribute("aria-valuenow"))'), value => value === widths + 16, 'Keyboard resize');
      // 在窗口仍存活时完成系统主题恢复及 Renderer 校验。Windows Electron 44
      // 在 closed 回调的同一轮微任务里修改 nativeTheme 会触发原生崩溃。
      for (const theme of ['light', 'dark', 'system']) {
        console.log('Official smoke: guide theme and resize', locale, theme);
        electron.nativeTheme.themeSource = theme;
        form.setSize(420, 460);
        await until(() => form.webContents.executeJavaScript(`({compact: Boolean(document.querySelector('[data-guide-compact]')),
          dark: document.body.hasAttribute('data-ds-dark-theme'), overflow: document.documentElement.scrollWidth > innerWidth,
          footer: document.querySelector('.createContent>footer').getBoundingClientRect().bottom <= innerHeight + 1})`),
        value => value.compact && value.dark === electron.nativeTheme.shouldUseDarkColors && !value.overflow && value.footer, 'Narrow guide layout');
      }
      const closed = new Promise(resolve => form.once('closed', resolve));
      console.log('Official smoke: close guide', locale);
      await Promise.race([closed, form.webContents.executeJavaScript('document.querySelector(".createContent>footer button:first-child").click()')]);
      await closed;
      await until(() => form.isDestroyed(), Boolean, 'Guide cancellation');
    } finally {if (!form.isDestroyed()) form.destroy()}
  }
  const guide = await showGuide(); collect(guide);
  await until(() => guide.webContents.executeJavaScript('document.body.innerText'), text => /Recent projects|最近项目/i.test(text), 'Welcome content');
  assert.equal(await guide.webContents.executeJavaScript('typeof require'), 'undefined');
  await capture(guide, 'welcome');
  await checkProjectCreateEntryPoints({electron, guide});
  // 创建窗口由真正的欢迎页 IPC 打开，并从它的创建服务生成项目、打开官方主窗口。
  await guide.webContents.executeJavaScript('window.projectGuide.invoke("new")');
  const create = await showProjectCreate(); collect(create);
  await capture(create, 'create');
  const fixture = join(userData, 'fixtures'); mkdirSync(fixture, {recursive: true});
  await create.webContents.executeJavaScript('window.projectGuide.invoke("new")');
  await create.webContents.executeJavaScript(`window.projectGuide.invoke('confirm', ${JSON.stringify({location: fixture, name: 'alpha', templateId: 'empty', resources: []})})`).catch(error => {
    // 创建成功后窗口销毁可能取消 executeJavaScript 的返回；只有 workspace 中已有项目才接受。
    if (!workspace.projects.size) throw error;
  });
  await until(() => [...workspace.projects], rows => rows.length === 1, 'Created project');
  const [manifestA, a] = [...workspace.projects][0]; collect(a.window);
  const dirB = join(fixture, 'beta'); mkdirSync(dirB, {recursive: true});
  const manifestB = createProjectFile(join(dirB, 'beta.agent-project'));
  const b = await open(manifestB); collect(b.window);
  assert.equal(await open(manifestA), a);
  assert.notEqual(a.window.webContents.session, b.window.webContents.session);
  assert.notEqual(a.host.url, b.host.url);
  const identities = [];
  for (const [name, project] of [['alpha', a], ['beta', b]]) {
    await project.window.webContents.executeJavaScript('globalThis.__DSH_BOOT_READY__.promise');
    await until(() => project.window.webContents.executeJavaScript('document.body.innerText'),
      text => text.includes(name) && /项目模式|Project mode/.test(text) && !/Loading plugins|Loading project|正在读取项目/.test(text), 'Project page');
    const api = await project.window.webContents.executeJavaScript(`(async () => ({
      hasApiKey: await window.dshOnboarding.hasApiKey(),
      shortcuts: await window.dshDesktop.shortcuts.get([]),
      device: await window.dshDesktop.deviceInfo(),
      boot: globalThis.__DSH_TRANSPORT__?.ownsHost,
      text: document.body.innerText,
    }))()`);
    assert.equal(api.hasApiKey, false, 'Empty Profile must report its real key state');
    assert.equal(api.shortcuts.status, 'ready');
    // get([]) 在本测试读取持久化状态后，重新加载让官方 UI 恢复自己的真实按键定义。
    project.window.reload();
    await until(() => project.window.webContents.executeJavaScript('document.body.innerText'),
      text => text.includes(name) && /项目模式|Project mode/.test(text), 'Reload official shortcut definitions');
    assert.ok(api.device.includes('platform=' + process.platform));
    assert.equal(api.boot, true);
    const response = await project.host.request('/api/project/snapshot');
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    identities.push({name, hasApiKey: api.hasApiKey, shortcuts: api.shortcuts.status, snapshotKeys: Object.keys(snapshot), text: api.text});
    assert.throws(() => project.host.request(new URL('/', name === 'alpha' ? b.host.url : a.host.url)), /project Host/);
    await capture(project.window, name);
  }
  writeFileSync(join(userData, 'page-state.json'), JSON.stringify(identities, null, 2));
  const browser = await checkOfficialBrowser(electron, a, b);
  const account = process.env.DSH_OFFICIAL_ACCOUNT_SMOKE === '1'
    ? await checkOfficialAccount({electron, a, b, deepLinks, capture}) : undefined;
  await a.host.setTheme('dark');
  await until(() => b.host.getTheme(), value => value === 'dark', 'Shared dark theme');
  await until(() => electron.nativeTheme.themeSource, value => value === 'dark', 'Native dark material');
  assert.equal(electron.nativeTheme.shouldUseDarkColors, true);
  await until(() => b.window.webContents.executeJavaScript('document.body.hasAttribute("data-ds-dark-theme")'), Boolean, 'Dark renderer');
  await capture(b.window, 'beta-dark');
  const sessionA = a.window.webContents.session;
  const urlA = a.host.url;
  a.window.close();
  await until(() => workspace.projects.has(manifestA), present => !present, 'Native window close');
  assert.equal((await b.host.request('/api/project/snapshot')).status, 200);
  const reopened = await open(manifestA);
  assert.equal(await reopened.host.getTheme(), 'dark');
  assert.equal(reopened.window.webContents.session, sessionA);
  assert.notEqual(reopened.host.url, urlA);
  await assert.rejects(fetch(urlA));
  await b.host.setTheme('light');
  await until(() => reopened.host.getTheme(), value => value === 'light', 'Shared light theme');
  await until(() => electron.nativeTheme.themeSource, value => value === 'light', 'Native light material');
  assert.equal(electron.nativeTheme.shouldUseDarkColors, false);
  const restarted = await restart(manifestA);
  assert.equal(restarted.window.webContents.session, sessionA);
  assert.equal(await restarted.host.getTheme(), 'light');
  await b.host.setTheme('system');
  await until(() => restarted.host.getTheme(), value => value === 'system', 'Shared system theme');
  await until(() => electron.nativeTheme.themeSource, value => value === 'system', 'Native system material');
  await until(() => restarted.window.webContents.executeJavaScript('document.body.hasAttribute("data-ds-dark-theme")'),
    value => value === electron.nativeTheme.shouldUseDarkColors, 'System renderer and material agree');
  // 旧 Stable Home 必须拒绝接管且原样保留，B 仍可访问。
  const dirC = join(fixture, 'legacy'); mkdirSync(dirC, {recursive: true});
  const legacy = createProjectFile(join(dirC, 'legacy.agent-project'));
  const state = projectStatePath(userData, legacy);
  mkdirSync(join(state.stateDirectory, 'dsh'), {recursive: true});
  const preserved = join(state.stateDirectory, 'dsh/settings.yaml'); writeFileSync(preserved, 'legacy: untouched\n');
  await assert.rejects(open(legacy), /requires migration/);
  assert.equal(readFileSync(preserved, 'utf8'), 'legacy: untouched\n');
  assert.equal((await b.host.request('/api/project/snapshot')).status, 200);
  assert.equal(officialIpc.owners.size, 2);
  await close(legacy, {showWelcome: false});
  await close(manifestA, {showWelcome: false});
  await close(manifestB, {showWelcome: false});
  assert.equal(workspace.projects.size, 0);
  assert.equal(officialIpc.owners.size, 0);
  assert.equal(await sessionA.protocol.isProtocolHandled('dsh-app'), false);
  const result = {platform: process.platform, arch: process.arch, officialVersion: '0.2.0-rc.2',
    welcomeAndCreation: true, guideLocalesThemesNarrowKeyboardCancel: true, twoProjects: true, realApiKeyState: true, officialShortcuts: true,
    nativeClose: true, reopen: true, restart: true, sameSession: true, legacyDataPreserved: true,
    allOwnersReleased: true, sharedTheme: true, nativeThemeLightDarkSystem: true, browser, account, rendererErrors: errors};
  writeFileSync(join(userData, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Official Shell smoke passed: ${userData}`);
}
