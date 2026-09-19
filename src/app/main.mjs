import electron from 'electron';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, resolve} from 'node:path';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {ProjectWorkspace} from './project-workspace.mjs';
import {SessionState} from './session-state.mjs';
import {SharedTheme} from './shared-theme.mjs';
import {nativeRoleMenus} from './native-menus.mjs';
import {projectStatePath} from './project-state.mjs';
import {RecentProjects, resolveProjectFile} from './project-files.mjs';
import {openNativeProject} from '../desktop-adapter/native.mjs';
import {createProjectRecovery, describeProjectError} from '../desktop-adapter/stable/recovery.mjs';
import {prepareSafeMode, cleanupSafeMode} from '../desktop-adapter/stable/safe-mode.mjs';
import {cancelGuideCreations, createGuideWindow} from '../windows/guide-window.mjs';
import {assertProjectCreationReady} from './project-bootstrap.mjs';
import {cleanupGuideClones} from './guide-clones.mjs';

const {app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, dialog} = electron;
const repository = fileURLToPath(new URL('../../', import.meta.url));
const appIcon = join(repository, 'assets', process.platform === 'darwin' ? 'app-icon-mac.png' : 'app-icon.png');
const trayIcon = join(repository, 'assets', 'tray', process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon-blue.png');
const smoke = process.argv.includes('--native-smoke') && !app.isPackaged;
const lifecycleTest = process.argv.includes('--lifecycle-test') && !app.isPackaged;
const installationCheck = process.argv.includes('--verify-installation');
const testing = smoke || lifecycleTest || installationCheck;
app.setName('DSH Project Desktop');
const userData = installationCheck ? mkdtempSync(join(tmpdir(), 'dsh-project-install-check-'))
  : testing ? resolve(process.env.DSH_PROJECT_DESKTOP_SMOKE_DATA) : join(app.getPath('appData'), 'dsh-project-desktop');
app.setPath('userData', userData);
app.setAppUserModelId('local.dsh.project.desktop');
if (!app.requestSingleInstanceLock()) {app.quit()}
else {void run().catch(error => {console.error(error); app.exit(1)})}

async function run() {
  await cleanupGuideClones(userData);
  let guide, guideOpening, projectCreate, projectCreateOpening, tray, quitting = false, quitReady = false, startupComplete = false;
  const startupFiles = process.argv.filter(value => value.endsWith('.agent-project'));
  const recent = new RecentProjects(join(userData, 'recent-projects.json'));
  const session = new SessionState(join(userData, 'workspace-session.json'));
  const themeFile = join(userData, 'theme.json');
  let storedTheme;
  if (existsSync(themeFile)) {
    try {const value = JSON.parse(readFileSync(themeFile, 'utf8')).preference; if (['system', 'light', 'dark'].includes(value)) storedTheme = value}
    catch {renameSync(themeFile, `${themeFile}.unreadable-${Date.now()}`)}
  }
  const theme = new SharedTheme({initial: storedTheme, applyNative: value => {nativeTheme.themeSource = value},
    async persist(preference) {
      mkdirSync(userData, {recursive: true});
      writeFileSync(themeFile + '.tmp', JSON.stringify({preference}) + '\n', {mode: 0o600});
      renameSync(themeFile + '.tmp', themeFile);
    }});
  if (storedTheme) nativeTheme.themeSource = storedTheme;
  const report = error => {console.error(error); if (!testing) dialog.showErrorBox('DSH Project Desktop', error.message ?? String(error))};
  const perform = action => {void Promise.resolve().then(action).catch(report)};
  const workspace = new ProjectWorkspace({session, resolveProject: resolveProjectFile, create: createProject,
    recovery: manifest => createProjectRecovery(projectStatePath(userData, manifest)), changed() {
      refreshMenus();
      if (guide && !guide.isDestroyed()) guide.webContents.send('project-desktop:state-changed');
    }});
  const projects = workspace.projects;
  const active = () => {
    const focused = BrowserWindow.getFocusedWindow();
    return focused ? [...projects.values()].find(project => project.window === focused) : projects.get(session.value.activePath);
  };
  const liveProjects = () => [...projects.values()].filter(project => !project.window.isDestroyed());
  const showApplication = () => {
    if (!startupComplete) return;
    const preferred = active() ?? projects.get(session.value.activePath);
    const project = preferred && !preferred.window.isDestroyed() ? preferred : liveProjects()[0];
    if (project) project.focus(); else return showGuide();
  };
  let lastLocale = 'en';
  const language = () => active()?.locale ?? lastLocale;
  async function showGuide() {
    if (quitting) return;
    if (guide && !guide.isDestroyed()) {guide.show(); guide.focus(); return guide}
    if (guideOpening) return guideOpening;
    guideOpening = createGuideWindow(electron, {repository, iconPath: appIcon, locale: language(), getLocale: language,
      recent, open, hidden: testing, defaultDirectory: app.getPath('documents'),
      openNewProject: showProjectCreate,
      recentChanged: refreshMenus,
      getFailures: () => workspace.failures(), warning: session.warning ?? recent.warning,
      forget: path => close(path), recover: (path, action, value) => workspace.recover(path, action, value),
      safeMode: path => workspace.safeMode(path), exitSafeMode: path => workspace.exitSafeMode(path),
      async relocate(path, replacement) {
        const canonical = resolveProjectFile(replacement);
        await open(canonical);
        if (canonical !== path) await close(path);
      },
    }).then(window => {
      guide = window; guide.on('closed', () => {guide = undefined}); guide.on('focus', refreshMenus); return guide;
    }).finally(() => {guideOpening = undefined});
    return guideOpening;
  }
  // A single independent creation window serves both the welcome button and the native menu.
  async function showProjectCreate() {
    if (quitting) return;
    if (projectCreate && !projectCreate.isDestroyed()) {projectCreate.show(); projectCreate.focus(); return projectCreate}
    if (projectCreateOpening) return projectCreateOpening;
    projectCreateOpening = createGuideWindow(electron, {repository, iconPath: appIcon, locale: language(), getLocale: language,
      recent, open: target => open(target, {showWelcomeOnError: false}), hidden: testing, mode: 'create', defaultDirectory: app.getPath('documents'),
      recentChanged: refreshMenus,
    }).then(window => {
      projectCreate = window;
      window.on('focus', refreshMenus);
      window.on('closed', () => {if (projectCreate === window) projectCreate = undefined});
      return window;
    }).finally(() => {projectCreateOpening = undefined});
    return projectCreateOpening;
  }
  async function newProject() {
    return showProjectCreate();
  }
  async function pickOpen() {
    const result = await dialog.showOpenDialog({properties: ['openFile'], filters: [{name: 'Project', extensions: ['agent-project']}]});
    if (!result.canceled) await open(result.filePaths[0]);
  }
  async function close(id, {showWelcome = true} = {}) {
    await workspace.close(id);
    if (showWelcome && !quitting && !projects.size) await showGuide();
  }
  async function open(target, {showWelcomeOnError = true} = {}) {
    try {
      if (quitting) throw new Error('Application is shutting down');
      assertProjectCreationReady(resolveProjectFile(target));
      const project = await workspace.open(target);
      const previousGuide = guide;
      setImmediate(() => {if (previousGuide && !previousGuide.isDestroyed() && !workspace.failures().length) previousGuide.close()});
      return project;
    } catch (error) {if (showWelcomeOnError && startupComplete && !quitting) await showGuide(); throw error}
  }
  async function recover(manifest) {
    try {await workspace.recover(manifest)} finally {await showGuide()}
  }
  async function createProject(manifest, _signal, {safeMode = false} = {}) {
      const state = projectStatePath(userData, manifest, {allowMissing: safeMode});
      let detach, stop, temporary;
      let value;
      try {
        if (safeMode) temporary = await prepareSafeMode(state.stateDirectory);
        else await cleanupSafeMode(state.stateDirectory);
        const title = basename(manifest, '.agent-project');
        value = await openNativeProject(electron, {...state, projectRoot: dirname(manifest), ...temporary,
          title: safeMode ? `${title} — ${language() === 'zh' ? '安全模式' : 'Safe Mode'}` : title,
          locale: language(), hidden: testing, onMenuChanged: refreshMenus, onError: report,
          onWarning: error => console.error('Project checkpoint:', error),
          windowState: session.window(manifest), saveWindowState: safeMode ? undefined : bounds => session.saveWindow(manifest, bounds),
          onFocus: () => session.focus(manifest),
          onFailure: error => perform(async () => {
            if (quitting) return;
            error.message = await describeProjectError(error);
            await workspace.fail(manifest, error); await showGuide();
          }),
          close: () => perform(async () => {if (safeMode) {await workspace.exitSafeMode(manifest); await showGuide()} else await close(manifest)}), restart: async () => {
            try {return await workspace.restart(manifest)} catch (error) {await showGuide(); throw error}
          }, recover: () => recover(manifest),
          windows: {list: () => [...projects].map(([id, project]) => ({id, title: project.window.getTitle(), current: id === manifest})),
            open: async () => {await showGuide()}, focus: id => projects.get(id)?.focus(), quit: () => perform(() => close(manifest))},
          async connectTheme(host) {
            if (safeMode) {await host.setTheme(theme.value ?? nativeTheme.themeSource); return}
            detach = await theme.connect(manifest, await host.getTheme(), preference => host.setTheme(preference));
            stop = host.observeTheme(preference => theme.select(preference));
          }});
        const nativeClose = value.close;
        value.safeMode = safeMode;
        value.close = async () => {stop?.(); await detach?.(); await nativeClose(); temporary?.cleanup()};
        if (!safeMode) recent.remember({path: manifest, title});
        return value;
      } catch (error) {
        stop?.(); await detach?.();
        try {await value?.close()} catch (shutdown) {
          const failure = new AggregateError([error, shutdown], 'Project startup cleanup is unconfirmed');
          failure.projectResource = value; throw failure;
        }
        if (error.projectResource) {
          const resource = error.projectResource;
          error.projectResource = {close: async () => {await resource.close(); temporary?.cleanup()}};
        } else temporary?.cleanup();
        error.message = await describeProjectError(error); throw error;
      }
  }
  function refreshMenus() {
    if (!app.isReady() || quitting) return;
    const zh = language() === 'zh';
    lastLocale = zh ? 'zh' : 'en';
    const roles = nativeRoleMenus(lastLocale);
    const current = active();
    const command = (label, action, extra = {}) => ({label, click: () => perform(action), ...extra});
    const recentItems = recent.list().map(item => item.available === false
      ? {label: item.title, enabled: false}
      : command(item.title, () => open(item.path)));
    const tools = current?.contributions().sort((a,b) => a.order - b.order).map(item => command(item.label(), item.invoke, {enabled: item.enabled?.() ?? true})) ?? [];
    const template = [
      ...roles.application,
      {label: zh ? '文件' : 'File', submenu: [
        command(zh ? '新建项目…' : 'New Project…', newProject, {accelerator: 'CmdOrCtrl+Shift+N'}),
        command(zh ? '打开项目…' : 'Open Project…', pickOpen, {accelerator: 'CmdOrCtrl+O'}),
        {label: zh ? '最近项目' : 'Recent Projects', submenu: recentItems, enabled: recentItems.length > 0},
        command(zh ? '欢迎窗口' : 'Welcome Window', showGuide),
        {type: 'separator'}, command(zh ? '关闭项目' : 'Close Project', () => {const entry = [...projects].find(([, value]) => value === active()); if (entry) return close(entry[0])},
          {accelerator: 'CmdOrCtrl+W', enabled: Boolean(current)})]},
      roles.edit, roles.view,
      {label: zh ? '项目工具' : 'Project Tools', submenu: [...tools,
        command(zh ? '打开项目终端' : 'Open Project Terminal', () => active()?.terminal(), {enabled: Boolean(current) && !current.safeMode}),
        command(zh ? '导出项目诊断…' : 'Export Project Diagnostics…', () => active()?.diagnostics(), {enabled: Boolean(current)}),
        {type: 'separator'},
        command(zh ? '重启当前项目' : 'Restart Current Project', () => active()?.restart(), {enabled: Boolean(current)}),
        command(current?.safeMode ? (zh ? '退出安全模式' : 'Exit Safe Mode') : (zh ? '在安全模式中打开' : 'Open in Safe Mode'), async () => {
          const entry = [...projects].find(([, value]) => value === active()); if (!entry) return;
          if (entry[1].safeMode) {await workspace.exitSafeMode(entry[0]); await showGuide()}
          else await workspace.safeMode(entry[0]);
        }, {enabled: Boolean(current)}),
        command(zh ? '项目恢复…' : 'Project Recovery…', () => active()?.recover(), {enabled: Boolean(current)})]},
      roles.window,
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    tray?.setContextMenu(Menu.buildFromTemplate([
      ...liveProjects().map(project => command(project.window.getTitle(), project.focus)),
      {type: 'separator'}, command(zh ? '显示应用' : 'Show App', showApplication),
      command(zh ? '欢迎窗口' : 'Welcome Window', showGuide), {role: 'quit', label: zh ? '退出' : 'Quit'},
    ]));
  }
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
    event.preventDefault(); if (quitting) return; quitting = true;
    void cancelGuideCreations().then(() => workspace.shutdown()).then(() => {quitReady = true; tray?.destroy(); app.exit(process.exitCode ?? 0)}).catch(error => {
      quitting = false; report(error); perform(showGuide);
    });
  });
  await app.whenReady();
  lastLocale = app.getLocale().startsWith('zh') ? 'zh' : 'en';
  // Single-instance ownership is held and no Host has started. Remove only disposable trees.
  const stateRoot = join(userData, 'projects');
  if (existsSync(stateRoot)) for (const entry of readdirSync(stateRoot, {withFileTypes: true})) {
    if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) {
      try {await cleanupSafeMode(join(stateRoot, entry.name))} catch (error) {report(error)}
    }
  }
  // Shell-owned artwork supplies the application and tray identity on every window.
  app.dock?.setIcon(appIcon);
  const icon = nativeImage.createFromPath(trayIcon);
  if (icon.isEmpty()) throw new Error(`Failed to load tray icon: ${trayIcon}`);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon); tray.setToolTip('DSH Project Desktop');
  tray.on('click', () => perform(showApplication));
  refreshMenus();
  if (installationCheck) {
    startupComplete = true;
    try {await (await import('../../scripts/install-check.mjs')).verifyInstallation({electron, open, close, workspace, showGuide, userData})}
    catch (error) {console.error(error); process.exitCode = 1}
    finally {app.quit()}
    return;
  }
  if (smoke) {
    startupComplete = true;
    try {await (await import('../../scripts/native-smoke-case.mjs')).runNativeSmoke({electron, open, close, showGuide, projects, theme, userData, repository, workspace, session});}
    catch (error) {console.error(error); process.exitCode = 1}
    finally {app.quit()}
    return;
  }
  await workspace.restore();
  while (startupFiles.length) await Promise.allSettled(startupFiles.splice(0).map(open));
  startupComplete = true;
  if (!projects.size || workspace.failures().length) await showGuide();
  if (lifecycleTest) {
    try {await (await import('../../scripts/native-lifecycle-case.mjs')).runLifecycleCase({electron, open, close, showGuide, projects, userData, workspace, session, hasGuide: () => Boolean(guide)});}
    catch (error) {console.error(error); process.exitCode = 1}
    finally {app.quit()}
  }
}
