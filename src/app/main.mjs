import electron from 'electron';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join} from 'node:path';
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
import {projectProfiles} from '../desktop-adapter/stable/project-profiles.mjs';
import {createProjectNativeWindow} from '../desktop-adapter/stable/project-native-windows.mjs';
import {prepareSafeMode, cleanupSafeMode} from '../desktop-adapter/stable/safe-mode.mjs';
import {cancelGuideCreations, createGuideWindow} from '../windows/guide-window.mjs';
import {assertProjectCreationReady} from './project-bootstrap.mjs';
import {resolveUserData} from './user-data.mjs';
import {cleanupGuideClones} from './guide-clones.mjs';
import {restoreMissingResources} from './resource-restore.mjs';
import {createProjectUpdates} from '../desktop-adapter/stable/project-updates.mjs';

const {app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, dialog} = electron;
const repository = fileURLToPath(new URL('../../', import.meta.url));
const appIcon = join(repository, 'assets', process.platform === 'darwin' ? 'app-icon-mac.png' : 'app-icon.png');
const trayIcon = join(repository, 'assets', 'tray', process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon-blue.png');
const smoke = process.argv.includes('--native-smoke') && !app.isPackaged;
const lifecycleTest = process.argv.includes('--lifecycle-test') && !app.isPackaged;
const profileRecoveryTest = process.argv.includes('--profile-recovery-test') && !app.isPackaged;
const installationCheck = process.argv.includes('--verify-installation');
const updateTest = process.argv.includes('--update-test') && !app.isPackaged;
const testing = smoke || lifecycleTest || profileRecoveryTest || installationCheck || updateTest;
app.setName('DSH Project Desktop');
const userData = resolveUserData({installationCheck, testing, environment: process.env, appData: app.getPath('appData'),
  temporaryDirectory: () => mkdtempSync(join(tmpdir(), 'dsh-project-install-check-'))});
if (!testing && process.env.DSH_PROJECT_DESKTOP_USER_DATA) console.log(`Isolated user data: ${userData}`);
app.setPath('userData', userData);
app.setAppUserModelId('local.dsh.project.desktop');
if (!app.requestSingleInstanceLock()) {app.quit()}
else {void run().catch(error => {console.error(error); app.exit(1)})}

async function run() {
  await cleanupGuideClones(userData);
  let guide, guideOpening, projectCreate, projectCreateOpening, tray, updates, updateExit, quitting = false, quitReady = false, startupComplete = false;
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
  const surfaces = new Map();
  const preparedSafeModes = new Map();
  const workspace = new ProjectWorkspace({session, resolveProject: resolveProjectFile, create: createProject,
    recovery: async manifest => {
      const state = projectStatePath(userData, manifest, {allowMissing: true});
      const profiles = await projectProfiles(state);
      return createProjectRecovery({...state, profileName: profiles.current(), openDirectory: async path => {
        const error = await electron.shell.openPath(path); if (error) throw new Error(error);
      }});
    }, changed() {
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
    const surface = surfaces.get(session.value.activePath) ?? [...surfaces.values()][0];
    if (surface) return surface.opening.then(handle => handle.show());
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
      recent, open, updates, hidden: testing, defaultDirectory: app.getPath('documents'),
      openNewProject: showProjectCreate,
      recentChanged: refreshMenus,
      getFailures: () => workspace.failures().filter(item => !surfaces.has(item.path) && !projects.has(item.path)),
      warning: session.warning ?? recent.warning,
      forget: path => close(path),
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
      recent, open: target => open(target, {showWelcomeOnError: false}), updates, hidden: testing, mode: 'create', defaultDirectory: app.getPath('documents'),
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
    await dismissSurface(id);
    await workspace.close(id);
    if (showWelcome && !quitting && !projects.size && !surfaces.size) await showGuide();
  }
  async function open(target, {showWelcomeOnError = true} = {}) {
    let manifest;
    try {
      if (quitting) throw new Error('Application is shutting down');
      manifest = resolveProjectFile(target);
      assertProjectCreationReady(manifest);
      if (surfaces.has(manifest)) {const handle = await surfaces.get(manifest).opening; handle.show(); return}
      const project = await workspace.open(manifest);
      const previousGuide = guide;
      setImmediate(() => {if (previousGuide && !previousGuide.isDestroyed() && !workspace.failures().length) previousGuide.close()});
      return project;
    } catch (error) {
      if (manifest && session.get(manifest) && !quitting) {await recover(manifest, {requested: false, error}); return}
      if (showWelcomeOnError && startupComplete && !quitting) await showGuide();
      throw error;
    }
  }
  async function dismissSurface(manifest) {
    const entry = surfaces.get(manifest);
    if (!entry) return;
    entry.closing = true;
    const handle = await entry.opening.catch(() => undefined);
    await handle?.close();
    await entry.done;
    if (surfaces.get(manifest) === entry) surfaces.delete(manifest);
  }
  async function restart(manifest) {
    const locale = projects.get(manifest)?.locale ?? session.get(manifest)?.locale;
    await dismissSurface(manifest);
    try {return await workspace.restart(manifest)}
    catch (error) {if (!quitting) await recover(manifest, {requested: false, error, locale})}
  }
  async function recover(manifest, {requested = true, error, locale} = {}) {
    return showProfileSurface(manifest, {recoveryMode: true, requested, error, locale});
  }
  async function showProfileSurface(manifest, {recoveryMode = false, requested = false, error, locale} = {}) {
    if (quitting) return;
    let existing = surfaces.get(manifest);
    if (existing?.recoveryMode === recoveryMode) {const handle = await existing.opening; handle.show(); return handle}
    if (existing) await dismissSurface(manifest);
    const project = projects.get(manifest);
    const entry = {recoveryMode, closing: false, locale: locale ?? (!project?.safeMode ? project?.locale : undefined)
      ?? session.get(manifest)?.locale ?? language()};
    session.update(manifest, {locale: entry.locale});
    surfaces.set(manifest, entry);
    entry.opening = (async () => {
      const state = projectStatePath(userData, manifest, {allowMissing: true});
      let recovery, readOnly = false;
      if (recoveryMode) {
        try {recovery = await workspace.beginRecovery(manifest, {requested})}
        catch (cause) {
          // If shutdown or ownership validation failed, show official diagnostics without mutation capabilities.
          readOnly = true; requested = false; error = cause;
          recovery = {profileName: (await projectProfiles(state)).current(), waitIdle: async () => {}};
        }
      }
      const handle = await createProjectNativeWindow({...state, locale: entry.locale, recovery, requested, readOnly,
        failureDetail: error ? await describeProjectError(error) : workspace.errors.get(manifest),
        failureStage: error?.failureStage ?? 'host-boot', isClosing: () => quitting || entry.closing,
        enterSafeMode: async () => {
          preparedSafeModes.set(manifest, await prepareSafeMode(state.stateDirectory));
        }});
      entry.handle = handle;
      entry.done = handle.result.then(async result => {
        if (surfaces.get(manifest) === entry) surfaces.delete(manifest);
        if (entry.closing || quitting) return;
        if (result === 'restart') await restart(manifest);
        else if (result === 'safe-mode') {
          try {await workspace.safeMode(manifest)} catch (cause) {await recover(manifest, {requested: false, error: cause})}
        } else if (recoveryMode) await close(manifest);
      }).catch(report).finally(() => {
        if (surfaces.get(manifest) === entry) surfaces.delete(manifest);
      });
      await handle.ready;
      if (entry.closing) await handle.close();
      else if (recoveryMode && guide && !guide.isDestroyed()) guide.close();
      return handle;
    })().catch(error => {if (surfaces.get(manifest) === entry) surfaces.delete(manifest); throw error});
    return entry.opening;
  }
  async function createProject(manifest, _signal, {safeMode = false} = {}) {
      const state = projectStatePath(userData, manifest, {allowMissing: safeMode});
      let detach, stop, temporary;
      let value;
      try {
        if (safeMode) {
          temporary = preparedSafeModes.get(manifest) ?? await prepareSafeMode(state.stateDirectory);
          preparedSafeModes.delete(manifest);
        }
        else await cleanupSafeMode(state.stateDirectory);
        const title = basename(manifest, '.agent-project');
        value = await openNativeProject(electron, {...state, projectRoot: dirname(manifest), ...temporary,
          title: safeMode ? `${title} — ${language() === 'zh' ? '安全模式' : 'Safe Mode'}` : title,
          locale: language(), hidden: testing, onMenuChanged: refreshMenus, onError: report,
          checkForUpdates: window => updates.checkNow(window),
          onWarning: error => console.error('Project checkpoint:', error),
          windowState: session.window(manifest), saveWindowState: safeMode ? undefined : bounds => session.saveWindow(manifest, bounds),
          onFocus: () => session.focus(manifest),
          onFailure: error => perform(async () => {
            if (quitting) return;
            const locale = value?.locale;
            error.message = await describeProjectError(error);
            await workspace.fail(manifest, error); await recover(manifest, {requested: false, error, locale});
          }),
          close: () => perform(async () => {if (safeMode) {await workspace.exitSafeMode(manifest); await recover(manifest)} else await close(manifest)}),
          restart: () => restart(manifest), recover: () => recover(manifest),
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
        if (!safeMode) {
          recent.remember({path: manifest, title});
          session.update(manifest, {locale: value.locale});
          // A fresh checkout carries no resources/ directory at all, because the project
          // definition excludes every resource repository from the parent Git tree. Rebuild
          // them through the Host's own resource API: opening never waits, the Plugin's panel
          // shows progress and a failure stays recoverable from there.
          if (!testing) void restoreMissingResources(value.host, {onError: error => console.error('Resource restore:', error.message)});
        }
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
    const current = active();
    const command = (label, action, extra = {}) => ({label, click: () => perform(action), ...extra});
    const updateCommand = () => command(updates?.label() ?? (zh ? '检查更新…' : 'Check for Updates…'),
      () => updates?.checkNow(BrowserWindow.getFocusedWindow()), {id: 'project-check-for-updates', enabled: Boolean(updates) && !updates.busy});
    const roles = nativeRoleMenus(lastLocale, process.platform, app.name, [updateCommand()]);
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
        command(zh ? 'Profile…' : 'Profiles…', () => {
          const entry = [...projects].find(([, value]) => value === active());
          if (entry) return showProfileSurface(entry[0]);
        }, {enabled: Boolean(current) && !current.safeMode}),
        {type: 'separator'},
        command(zh ? '重启当前项目' : 'Restart Current Project', () => active()?.restart(), {enabled: Boolean(current)}),
        command(current?.safeMode ? (zh ? '退出安全模式' : 'Exit Safe Mode') : (zh ? '在安全模式中打开' : 'Open in Safe Mode'), async () => {
          const entry = [...projects].find(([, value]) => value === active()); if (!entry) return;
          if (entry[1].safeMode) {await workspace.exitSafeMode(entry[0]); await recover(entry[0])}
          else {await dismissSurface(entry[0]); await workspace.safeMode(entry[0])}
        }, {enabled: Boolean(current)}),
        command(zh ? '项目恢复…' : 'Project Recovery…', () => active()?.recover(), {enabled: Boolean(current)})]},
      roles.window,
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    tray?.setContextMenu(Menu.buildFromTemplate([
      ...liveProjects().map(project => command(project.window.getTitle(), project.focus)),
      {type: 'separator'}, command(zh ? '显示应用' : 'Show App', showApplication),
      command(zh ? '欢迎窗口' : 'Welcome Window', showGuide),
      command(updates?.label() ?? (zh ? '检查更新…' : 'Check for Updates…'), () => updates?.checkNow(), {enabled: Boolean(updates) && !updates.busy}),
      {role: 'quit', label: zh ? '退出' : 'Quit'},
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
    updates?.prepareToQuit();
    let stopped = false;
    void cancelGuideCreations().then(async () => {
      await Promise.all([...surfaces.keys()].map(dismissSurface));
      for (const temporary of preparedSafeModes.values()) temporary.cleanup();
      preparedSafeModes.clear();
      await workspace.shutdown();
      stopped = true;
      await updateExit?.launch();
      await updates?.dispose();
    }).then(() => {quitReady = true; tray?.destroy(); app.exit(process.exitCode ?? 0)}).catch(async error => {
      quitting = false;
      const failedInstall = updateExit; updateExit = undefined;
      if (stopped) await workspace.resumeAfterShutdown().catch(report);
      updates?.resumeAfterQuit();
      if (failedInstall) {failedInstall.reject(error); void updates.showFailure()} else report(error);
      perform(showGuide);
    });
  });
  await app.whenReady();
  lastLocale = app.getLocale().startsWith('zh') ? 'zh' : 'en';
  const updateFixtures = updateTest ? await import('../../scripts/native-update-fixture.mjs') : undefined;
  updates = await createProjectUpdates(electron, {userData, locale: language,
    getWindow: () => {const focused = BrowserWindow.getFocusedWindow(); return focused?.getParentWindow() ?? focused ?? active()?.window ?? guide},
    changed: () => {refreshMenus(); for (const window of [guide, projectCreate]) if (window && !window.isDestroyed()) window.webContents.send('project-desktop:state-changed')},
    // Download progress only feeds the welcome button, so it must not rebuild the native menus.
    progressChanged: () => {for (const window of [guide, projectCreate]) if (window && !window.isDestroyed()) window.webContents.send('project-desktop:state-changed')},
    policy: {enabled: !testing},
    install: launch => new Promise((resolve, reject) => {updateExit = {launch, resolve, reject}; app.quit()}),
    ...(updateFixtures ? updateFixtures.options : {}),
  });
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
  if (updateTest) {
    startupComplete = true;
    try {await (await import('../../scripts/native-update-case.mjs')).runUpdateCase({electron, open, close, showGuide, updates, userData, workspace, fixture: updateFixtures})}
    catch (error) {console.error(error); process.exitCode = 1}
    finally {app.quit()}
    return;
  }
  if (profileRecoveryTest) {
    startupComplete = true;
    try {await (await import('../../scripts/native-profile-recovery-case.mjs')).runProfileRecoveryCase({electron, open, close,
      showProfiles: manifest => showProfileSurface(manifest), recover, restart, workspace, session, userData,
      hasGuide: () => Boolean(guide && !guide.isDestroyed())})}
    catch (error) {console.error(error); process.exitCode = 1}
    finally {app.quit()}
    return;
  }
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
  for (const failure of workspace.failures()) {
    try {resolveProjectFile(failure.path)} catch {continue}
    await recover(failure.path, {requested: failure.phase === 'recovering', error: new Error(failure.error ?? 'Previous project startup failed')});
  }
  while (startupFiles.length) await Promise.allSettled(startupFiles.splice(0).map(open));
  startupComplete = true;
  if ((!projects.size && !surfaces.size) || workspace.failures().some(item => !surfaces.has(item.path))) await showGuide();
  if (!testing) void updates.offerCleanup();
  if (lifecycleTest) {
    try {await (await import('../../scripts/native-lifecycle-case.mjs')).runLifecycleCase({electron, open, close, showGuide, dismissSurface,
      projects, userData, workspace, session, hasGuide: () => Boolean(guide)});}
    catch (error) {console.error(error); process.exitCode = 1}
    finally {app.quit()}
  }
}
