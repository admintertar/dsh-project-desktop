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

const {app, BrowserWindow, Menu, Tray, nativeImage, dialog, protocol} = electron;
const appIcon = join(repository, 'assets', process.platform === 'darwin' ? 'app-icon-mac.png' : 'app-icon.png');
const trayIcon = join(repository, 'assets/tray', process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon-blue.png');
const retiredModes = ['--native-smoke', '--lifecycle-test', '--profile-recovery-test', '--verify-installation', '--update-test'];
if (process.argv.some(arg => retiredModes.includes(arg))) {
  console.error('Retired community test mode; use yarn smoke:official-shell');
  app.exit(1);
}
const testing = process.argv.includes('--official-shell-smoke') && !app.isPackaged;
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
  let guide, guideOpening, projectCreate, projectCreateOpening, tray, officialIpc, services;
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
    await workspace.close(path);
    if (showWelcome && !quitting && !projects.size) await showGuide();
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
        hidden: testing, ipc: officialIpc, services, windowState: session.window(manifest),
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
  function refreshMenus() {
    if (!app.isReady() || quitting) return;
    const zh = language() === 'zh';
    lastLocale = zh ? 'zh' : 'en';
    const current = active();
    const command = (label, action, extra = {}) => ({label, click: () => perform(action), ...extra});
    const roles = nativeRoleMenus(lastLocale, process.platform, app.name);
    const currentPath = () => [...projects].find(([, project]) => project === active())?.[0];
    const recents = recent.list().map(item => command(item.title, () => open(item.path), {enabled: item.available !== false}));
    const officialClose = current?.shortcuts.fileMenu({fileMenu: zh ? '文件' : 'File', closePage: zh ? '关闭页面' : 'Close Page'}).submenu ?? [];
    // Cmd+W 由官方快捷键管理关闭页面/窗口，Shell 关闭整个项目使用独立快捷键。
    const template = [...roles.application, {label: zh ? '文件' : 'File', submenu: [
      command(zh ? '新建项目…' : 'New Project…', showProjectCreate, {id: 'project-new', accelerator: 'CmdOrCtrl+Shift+N'}),
      command(zh ? '打开项目…' : 'Open Project…', pickOpen, {id: 'project-open', accelerator: 'CmdOrCtrl+O'}),
      {label: zh ? '最近项目' : 'Recent Projects', submenu: recents, enabled: recents.length > 0},
      command(zh ? '欢迎窗口' : 'Welcome Window', showGuide, {id: 'project-welcome'}),
      {type: 'separator'}, ...officialClose,
      command(zh ? '关闭项目' : 'Close Project', () => close(currentPath()),
        {id: 'project-close', accelerator: 'CmdOrCtrl+Shift+W', enabled: Boolean(current)}),
    ]}, roles.edit, roles.view,
    {label: zh ? '项目' : 'Project', submenu: [
      ...liveProjects().map(project => command(project.window.getTitle(), project.focus)),
      {type: 'separator'}, command(zh ? '重启当前项目' : 'Restart Current Project', () => restart(currentPath()), {enabled: Boolean(current)}),
    ]}, roles.window];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    tray?.setContextMenu(Menu.buildFromTemplate([
      ...liveProjects().map(project => command(project.window.getTitle(), project.focus)),
      {type: 'separator'}, command(zh ? '显示应用' : 'Show App', showApplication),
      command(zh ? '欢迎窗口' : 'Welcome Window', showGuide), {role: 'quit', label: zh ? '退出' : 'Quit'},
    ]));
  }
  const startupFiles = process.argv.filter(value => value.endsWith('.agent-project'));
  app.on('open-file', (event, path) => {event.preventDefault(); if (startupComplete) perform(() => open(path)); else startupFiles.push(path)});
  app.on('second-instance', (_event, args) => {
    const paths = args.filter(value => value.endsWith('.agent-project'));
    if (!startupComplete) startupFiles.push(...paths);
    else if (paths.length) paths.forEach(path => perform(() => open(path)));
    else perform(showApplication);
  });
  app.on('activate', () => {if (startupComplete) perform(showApplication)});
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (quitReady) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void cancelGuideCreations().then(() => workspace.shutdown()).then(async () => {
      await officialIpc?.dispose();
      quitReady = true; tray?.destroy(); trace.end('quit'); app.exit(process.exitCode ?? 0);
    }).catch(error => {quitting = false; report(error); perform(showGuide)});
  });
  await app.whenReady();
  services = await import(pathToFileURL(join(runtimeDirectory(), 'official/native-services.mjs')).href);
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
    let timeout;
    try {await Promise.race([(await import('../../scripts/official-shell-smoke-case.mjs')).runOfficialShellSmoke({
      electron, open, close, restart, showGuide, showProjectCreate, workspace, session, userData, officialIpc,
    }), new Promise((_, reject) => {timeout = setTimeout(() => reject(new Error('Official Shell smoke timed out')), 120000)})])} catch (error) {console.error(error); process.exitCode = 1}
    finally {clearTimeout(timeout); app.quit()}
    return;
  }
  await workspace.restore();
  while (startupFiles.length) await Promise.allSettled(startupFiles.splice(0).map(path => open(path)));
  startupComplete = true;
  if (!projects.size || workspace.failures().length) await showGuide();
  else showApplication();
  trace.end();
}
