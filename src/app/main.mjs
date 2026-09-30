import electron from 'electron';
import {pathToFileURL} from 'node:url';
import {basename, join} from 'node:path';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {SharedTheme} from './shared-theme.mjs';
import {tmpdir} from 'node:os';
import {ProjectWorkspace} from './project-workspace.mjs';
import {SessionState} from './session-state.mjs';
import {nativeRoleMenus} from './native-menus.mjs';
import {projectStatePath} from './project-state.mjs';
import {RecentProjects, classifyProjectTarget, resolveProjectFile} from './project-files.mjs';
import {cancelGuideCreations, createGuideWindow} from '../windows/guide-window.mjs';
import {assertProjectCreationReady} from './project-bootstrap.mjs';
import {resolveUserData} from './user-data.mjs';
import {cleanupGuideClones} from './guide-clones.mjs';
import {restoreMissingResources} from './resource-restore.mjs';
import {productName, productVersion} from './product.mjs';
import {bootLogDirectory, session as startTrace} from './boot-log.mjs';
import {repository, officialPin, runtimeDirectory} from '../desktop-adapter/official/paths.mjs';
import {openOfficialProjectWindow} from '../desktop-adapter/official/project-window.mjs';
import {installOfficialProjectIpc} from '../desktop-adapter/official/project-ipc.mjs';
import {createOfficialQuitGuard} from '../desktop-adapter/official/quit-guard.mjs';
import {installOfficialDeepLinks} from '../desktop-adapter/official/deep-links.mjs';
import {createOfficialHostEnvironment} from '../desktop-adapter/official/host-environment.mjs';
import {installOfficialSessionEnd} from '../desktop-adapter/official/session-end.mjs';
import {officialCredentials} from '../desktop-adapter/official/credential-runtime.mjs';
import {prepareSharedAccountStore} from '../desktop-adapter/official/shared-account-store.mjs';
import {SharedAccountSessions} from '../desktop-adapter/official/shared-account-sessions.mjs';
import {createProjectUpdates} from '../desktop-adapter/official/project-updates.mjs';
import {spawn} from 'node:child_process';

const {app, BrowserWindow, Menu, Tray, nativeImage, dialog, protocol} = electron;
const appIcon = join(repository, 'assets', process.platform === 'darwin' ? 'app-icon-mac.png' : 'app-icon.png');
const trayIcon = join(repository, 'assets/tray', process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon-blue.png');
const retiredModes = ['--native-smoke', '--lifecycle-test', '--profile-recovery-test', '--verify-installation', '--update-test'];
if (process.argv.some(arg => retiredModes.includes(arg))) {
  console.error('Retired community test mode; use yarn smoke:official-shell');
  app.exit(1);
}
const closeTesting = process.argv.includes('--official-close-smoke') && !app.isPackaged;
const accountTesting = process.argv.includes('--official-account-sharing-smoke') && !app.isPackaged;
const updateTesting = process.argv.includes('--official-update-smoke') && !app.isPackaged;
const testing = (process.argv.includes('--official-shell-smoke') || closeTesting || accountTesting || updateTesting) && !app.isPackaged;
app.setName(productName);
protocol.registerSchemesAsPrivileged([{scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true,
}}]);
const userData = resolveUserData({testing, environment: process.env, appData: app.getPath('appData'),
  temporaryDirectory: () => mkdtempSync(join(tmpdir(), 'dsh-project-install-check-'))});
app.setPath('userData', userData);
app.setAppUserModelId('local.dsh.project.desktop');
if (!app.requestSingleInstanceLock()) app.quit();
else void run().catch(error => {console.error(error); app.exit(1)});

async function run() {
  bootLogDirectory(userData);
  const trace = startTrace('boot', `shell=${productVersion} official=${officialPin.version} platform=${process.platform}`);
  const recent = new RecentProjects(join(userData, 'recent-projects.json'));
  const session = new SessionState(join(userData, 'workspace-session.json'));
  let guide, guideOpening, projectCreate, projectCreateOpening, tray, officialIpc, services, quitGuard, hostEnvironment, sessionEnd;
  let accountStore, updates, updateFixture;
  const accountSessions = new SharedAccountSessions();
  let quitting = false, quitReady = false, startupComplete = false, lastLocale = 'en';
  const report = error => {
    console.error(error);
    if (!testing) dialog.showErrorBox(productName, error.message ?? String(error));
  };
  const perform = action => {void Promise.resolve().then(action).catch(report)};
  const themeFile = join(userData, 'theme.json');
  let storedTheme;
  if (existsSync(themeFile)) {
    try {
      const saved = JSON.parse(readFileSync(themeFile, 'utf8')).preference;
      if (['system', 'light', 'dark'].includes(saved)) storedTheme = saved;
    } catch {renameSync(themeFile, `${themeFile}.unreadable-${Date.now()}`)}
  }
  const theme = new SharedTheme({initial: storedTheme, applyNative: value => {electron.nativeTheme.themeSource = value},
    async persist(preference) {
      mkdirSync(userData, {recursive: true});
      writeFileSync(themeFile + '.tmp', JSON.stringify({preference}) + '\n', {mode: 0o600});
      renameSync(themeFile + '.tmp', themeFile);
    }});
  if (storedTheme) electron.nativeTheme.themeSource = storedTheme;
  const workspace = new ProjectWorkspace({session, resolveProject: resolveProjectFile, create: createProject,
    confirm: request => sessionEnd?.ending ? true : quitGuard?.confirm(request) ?? true,
    focusConfirmation: () => quitGuard?.focus(),
    changed() {
      refreshMenus();
      if (guide && !guide.isDestroyed()) guide.webContents.send('project-desktop:state-changed');
    }});
  const projects = workspace.projects;
  const active = () => {
    const focused = BrowserWindow.getFocusedWindow();
    return focused ? [...projects.values()].find(project => project.window === focused) : projects.get(session.value.activePath);
  };
  const liveProjects = () => [...projects.values()].filter(project => !project.window.isDestroyed());
  const language = () => active()?.locale ?? lastLocale;
  const showApplication = () => {
    if (!startupComplete) return;
    const project = active() ?? projects.get(session.value.activePath) ?? liveProjects()[0];
    if (project && !project.window.isDestroyed()) project.focus(); else return showGuide();
  };
  const deepLinks = installOfficialDeepLinks(app, {focusDefault: showApplication, onError: report});
  for (const arg of process.argv) deepLinks.handle(arg);
  const guideOptions = () => ({repository, iconPath: appIcon, locale: language(), getLocale: language,
    recent, open, hidden: testing, defaultDirectory: app.getPath('documents'), recentChanged: refreshMenus});
  async function showGuide() {
    if (quitting) return;
    if (guide && !guide.isDestroyed()) {guide.show(); guide.focus(); return guide}
    if (guideOpening) return guideOpening;
    guideOpening = createGuideWindow(electron, {...guideOptions(), openNewProject: showProjectCreate,
      getFailures: () => workspace.failures(), warning: session.warning ?? recent.warning,
      forget: path => close(path),
      async relocate(path, replacement) {
        const canonical = resolveProjectFile(replacement);
        await open(canonical);
        if (canonical !== path) await close(path);
      },
    }).then(window => {
      guide = window;
      window.on('closed', () => {if (guide === window) guide = undefined});
      window.on('focus', refreshMenus);
      return window;
    }).finally(() => {guideOpening = undefined});
    return guideOpening;
  }
  async function showProjectCreate() {
    if (quitting) return;
    if (projectCreate && !projectCreate.isDestroyed()) {projectCreate.show(); projectCreate.focus(); return projectCreate}
    if (projectCreateOpening) return projectCreateOpening;
    projectCreateOpening = createGuideWindow(electron, {...guideOptions(), mode: 'create',
      open: target => open(target, {showWelcomeOnError: false}),
    }).then(window => {
      projectCreate = window;
      window.on('focus', refreshMenus);
      window.on('closed', () => {if (projectCreate === window) projectCreate = undefined});
      return window;
    }).finally(() => {projectCreateOpening = undefined});
    return projectCreateOpening;
  }
  async function pickOpen() {
    const zh = language() === 'zh';
    // Windows/Linux degenerate this pair to a folder picker; macOS accepts either.
    const result = await dialog.showOpenDialog({properties: ['openFile', 'openDirectory'],
      filters: [{name: 'Project', extensions: ['agent-project']}],
      message: zh ? '选择项目文件夹，或直接选择 .agent-project 项目文件。' : 'Select a project folder, or pick the .agent-project file directly.'});
    if (result.canceled) return;
    let target = result.filePaths[0];
    let kind = classifyProjectTarget(target);
    // The folder-only platforms still need the file picker when one folder holds several projects.
    if (kind === 'multiple' && process.platform !== 'darwin') {
      const pick = await dialog.showOpenDialog({properties: ['openFile'], filters: [{name: 'Project', extensions: ['agent-project']}],
        message: zh ? '这个文件夹里有多个项目，请选择要打开的项目文件。' : 'This folder holds several projects; select the project file to open.'});
      if (pick.canceled) return;
      target = pick.filePaths[0]; kind = classifyProjectTarget(target);
    }
    if (kind !== 'file') {
      await dialog.showMessageBox({type: 'warning', title: app.name, noLink: true,
        message: zh ? '这不是 agent-project 项目' : 'This is not an agent-project project',
        detail: kind === 'multiple'
          ? (zh ? '这个文件夹里有多个 .agent-project 项目文件，请选择其中一个打开。' : 'This folder contains several .agent-project files. Open one of them directly.')
          : (zh ? '没有找到 .agent-project 项目文件。' : 'No .agent-project project file was found.')});
      return;
    }
    await open(target);
  }
  async function close(path, {showWelcome = true} = {}) {
    if (!await workspace.close(path)) return false;
    if (showWelcome && !quitting && !projects.size) await showGuide();
    return true;
  }
  async function open(target, {showWelcomeOnError = true} = {}) {
    if (quitting) throw new Error('Application is shutting down');
    try {
      const manifest = resolveProjectFile(target);
      assertProjectCreationReady(manifest);
      const project = await workspace.open(manifest);
      const previous = guide;
      setImmediate(() => {if (previous && !previous.isDestroyed() && !workspace.failures().length) previous.close()});
      return project;
    } catch (error) {
      if (showWelcomeOnError && !quitting) await showGuide();
      throw error;
    }
  }
  async function restart(path) {
    try {return await workspace.restart(path)} catch (error) {await showGuide(); throw error}
  }
  async function createProject(manifest, signal) {
    const state = projectStatePath(userData, manifest);
    const title = basename(manifest, '.agent-project');
    const projectTrace = startTrace(`project/open:${title}`);
    let project;
    try {
      project = await openOfficialProjectWindow(electron, {...state, signal, title, locale: language(),
        hidden: testing, ipc: officialIpc, services, hostEnvironment, accountStore, accountSessions, updates, windowState: session.window(manifest),
        rememberAccountReturn: focus => deepLinks.remember(focus),
        sessionEnding: () => sessionEnd.ending, quitForSession: () => app.quit(),
        applicationItems: () => [
          {label: services.resolveDesktopLocale(language()).messages.checkUpdatesMenu,
            click: () => perform(() => updates.open(project?.window, true))},
          {role: 'about', label: project?.locale === 'zh' ? `关于 ${productName}` : `About ${productName}`},
          {type: 'separator'}, ...menuTemplate(project), {type: 'separator'},
          {role: 'quit', label: project?.locale === 'zh' ? '退出' : 'Quit'},
        ],
        saveWindowState: bounds => session.saveWindow(manifest, bounds),
        connectTheme: async settings => theme.connect(manifest, await settings.getTheme(), value => settings.setTheme(value)),
        onTheme: value => value === theme.value ? undefined : theme.select(value),
        onFocus: () => session.focus(manifest), onMenuChanged: refreshMenus, onError: report,
        onLocale: value => session.update(manifest, {locale: value.startsWith('zh') ? 'zh' : 'en'}),
        close: () => perform(() => close(manifest)),
        onFailure: error => perform(async () => {
          if (quitting) return;
          await workspace.fail(manifest, error);
          await showGuide();
        }),
      });
      recent.remember({path: manifest, title});
      session.update(manifest, {locale: project.locale});
      if (!testing) void restoreMissingResources(project.host, {onError: report});
      projectTrace.end();
      return project;
    } catch (error) {
      projectTrace.stage('failed', error.message); projectTrace.end('failed');
      try {await project?.close()} catch (shutdown) {
        const failure = new AggregateError([error, shutdown], 'Project startup cleanup is unconfirmed');
        failure.projectResource = project; throw failure;
      }
      throw error;
    }
  }
  function menuTemplate(current = active()) {
    const zh = (current?.locale ?? language()) === 'zh';
    const command = (label, action, extra = {}) => ({label, click: () => perform(action), ...extra});
    const updateItem = command(services?.resolveDesktopLocale(language()).messages.checkUpdatesMenu ?? (zh ? '检查更新…' : 'Check for Updates…'),
      () => updates.open(current?.window ?? guide, true), {id: 'project-check-for-updates', enabled: Boolean(updates)});
    const roles = nativeRoleMenus(zh ? 'zh' : 'en', process.platform, app.name, [updateItem]);
    const currentPath = () => [...projects].find(([, project]) => project === current)?.[0];
    const recents = recent.list().map(item => command(item.title, () => open(item.path), {enabled: item.available !== false}));
    const officialClose = current?.shortcuts.fileMenu({fileMenu: zh ? '文件' : 'File', closePage: zh ? '关闭页面' : 'Close Page'}).submenu ?? [];
    // File 保留官方的上下文关闭；整个项目的生命周期操作放在 Project 菜单。
    return [...roles.application, {label: zh ? '文件' : 'File', submenu: [
      command(zh ? '新建项目…' : 'New Project…', showProjectCreate, {id: 'project-new', accelerator: 'CmdOrCtrl+Shift+N'}),
      command(zh ? '打开项目…' : 'Open Project…', pickOpen, {id: 'project-open', accelerator: 'CmdOrCtrl+O'}),
      {label: zh ? '最近项目' : 'Recent Projects', submenu: recents, enabled: recents.length > 0},
      command(zh ? '欢迎窗口' : 'Welcome Window', showGuide, {id: 'project-welcome'}),
      {type: 'separator'}, ...officialClose,
    ]}, ...(process.platform === 'win32' && current ? [] : [roles.edit]), roles.view,
    {label: zh ? '项目' : 'Project', submenu: [
      ...liveProjects().map(project => command(project.window.getTitle(), project.focus)),
      {type: 'separator'}, command(zh ? '重启当前项目' : 'Restart Current Project', () => restart(currentPath()), {enabled: Boolean(current)}),
      command(zh ? '关闭当前项目' : 'Close Current Project', () => close(currentPath()),
        {id: 'project-close', accelerator: 'CmdOrCtrl+Shift+W', enabled: Boolean(current)}),
    ]}, roles.window];
  }
  function refreshMenus() {
    if (!app.isReady() || quitting) return;
    const zh = language() === 'zh';
    lastLocale = zh ? 'zh' : 'en';
    const command = (label, action) => ({label, click: () => perform(action)});
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
    // Windows 项目窗口的可见菜单由官方 preload caption 提供，保留原生 accelerator。
    if (process.platform === 'win32') for (const project of liveProjects()) project.window.setMenuBarVisibility(false);
    tray?.setContextMenu(Menu.buildFromTemplate([
      ...liveProjects().map(project => command(project.window.getTitle(), project.focus)),
      {type: 'separator'}, command(zh ? '显示应用' : 'Show App', showApplication),
      command(zh ? '检查更新…' : 'Check for Updates…', () => updates.open(active()?.window ?? guide, true)),
      command(zh ? '欢迎窗口' : 'Welcome Window', showGuide), {role: 'quit', label: zh ? '退出' : 'Quit'},
    ]));
  }
  const startupFiles = process.argv.filter(value => value.endsWith('.agent-project'));
  app.on('open-file', (event, path) => {event.preventDefault(); if (startupComplete) perform(() => open(path)); else startupFiles.push(path)});
  app.on('second-instance', (_event, args) => {
    if (args.some(arg => deepLinks.handle(arg))) return;
    const paths = args.filter(value => value.endsWith('.agent-project'));
    if (!startupComplete) startupFiles.push(...paths);
    else if (paths.length) paths.forEach(path => perform(() => open(path)));
    else perform(showApplication);
  });
  app.on('activate', () => {if (startupComplete) perform(showApplication)});
  app.on('window-all-closed', () => {});
  async function finishQuit() {
    await officialIpc?.dispose();
    updates?.dispose(); quitGuard?.dispose();
    hostEnvironment?.dispose(); deepLinks.dispose(); sessionEnd?.dispose();
    quitReady = true; tray?.destroy(); trace.end('quit'); app.exit(process.exitCode ?? 0);
  }
  async function installArtifact(path) {
    if (updateFixture) {updateFixture.installed.push(path); return}
    if (process.platform === 'darwin') {
      const error = await electron.shell.openPath(path);
      if (error) throw new Error('The downloaded installer could not be opened');
      return;
    }
    quitting = true;
    let stopped = false;
    try {
      stopped = await workspace.shutdown({beforeStop: cancelGuideCreations});
      if (!stopped) {quitting = false; refreshMenus(); return}
      await new Promise((resolve, reject) => {
        const child = spawn(path, ['--updated', '--force-run'], {detached: true, stdio: 'ignore', shell: false, windowsHide: false});
        child.once('error', reject);
        child.once('spawn', () => {child.unref(); resolve()});
      });
      await finishQuit();
    } catch (error) {
      quitting = false;
      if (stopped) await workspace.resumeAfterShutdown();
      throw error;
    }
  }
  app.on('before-quit', event => {
    if (quitReady) return;
    event.preventDefault();
    if (quitting) {quitGuard?.focus(); return}
    quitting = true;
    updates?.cancelPrompt();
    void workspace.shutdown({beforeStop: cancelGuideCreations}).then(async approved => {
      if (!approved) {quitting = false; refreshMenus(); return}
      await finishQuit();
    }).catch(error => {quitting = false; report(error); perform(showGuide)});
  });
  await app.whenReady();
  sessionEnd = installOfficialSessionEnd(electron);
  services = await import(pathToFileURL(join(runtimeDirectory(), 'official/native-services.mjs')).href);
  if (updateTesting) updateFixture = (await import('../../scripts/official-update-fixture.mjs')).createOfficialUpdateFixture();
  updates = await createProjectUpdates(electron, {directory: join(userData, 'updates'), output: join(repository, 'dist/official-updates'),
    version: productVersion, productName, locale: language, getWindow: () => active()?.window ?? guide,
    installArtifact, changed: refreshMenus, automatic: !testing && app.isPackaged,
    ...(updateFixture ? {request: updateFixture.request} : {})});
  accountStore = await prepareSharedAccountStore({userData, sourceCommit: officialPin.commit,
    credentials: await officialCredentials(runtimeDirectory())});
  hostEnvironment = createOfficialHostEnvironment(services);
  // app.exit 不触发 will-quit，仍需终止尚在读取的 shell 进程组。
  app.on('will-quit', () => hostEnvironment.dispose());
  process.once('exit', () => hostEnvironment.dispose());
  quitGuard = createOfficialQuitGuard(electron, services, {locale: language, name: productName, icon: appIcon});
  officialIpc = installOfficialProjectIpc(electron, services);
  await cleanupGuideClones(userData);
  lastLocale = app.getLocale().startsWith('zh') ? 'zh' : 'en';
  app.setAboutPanelOptions({applicationName: productName, applicationVersion: productVersion,
    ...(process.platform === 'darwin' ? {version: `DSH ${officialPin.version}`} : {credits: `DeepSeek Harness ${officialPin.version}`})});
  app.dock?.setIcon(appIcon);
  const icon = nativeImage.createFromPath(trayIcon);
  if (icon.isEmpty()) throw new Error(`Failed to load tray icon: ${trayIcon}`);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon); tray.setToolTip(productName);
  tray.on('click', () => perform(showApplication));
  refreshMenus();
  if (testing) {
    startupComplete = true;
    deepLinks.ready();
    let timeout;
    const smoke = updateTesting ? '../../scripts/official-update-smoke-case.mjs'
      : accountTesting ? '../../scripts/shared-account-smoke-case.mjs'
      : closeTesting ? '../../scripts/official-close-smoke-case.mjs' : '../../scripts/official-shell-smoke-case.mjs';
    try {await Promise.race([(await import(smoke)).runOfficialShellSmoke({
      electron, open, close, restart, showGuide, showProjectCreate, workspace, session, userData, officialIpc, deepLinks, updates, updateFixture,
    }), new Promise((_, reject) => {timeout = setTimeout(() => reject(new Error('Official Shell smoke timed out')), closeTesting ? 600000 : 120000)})])} catch (error) {console.error(error); process.exitCode = 1}
    finally {clearTimeout(timeout); app.quit()}
    return;
  }
  await workspace.restore();
  while (startupFiles.length) await Promise.allSettled(startupFiles.splice(0).map(path => open(path)));
  startupComplete = true;
  if (!projects.size || workspace.failures().length) await showGuide();
  else showApplication();
  deepLinks.ready();
  trace.end();
}
