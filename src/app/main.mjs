import electron from 'electron';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join} from 'node:path';
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {ProjectWorkspace} from './project-workspace.mjs';
import {SessionState} from './session-state.mjs';
import {SharedTheme} from './shared-theme.mjs';
import {nativeRoleMenus} from './native-menus.mjs';
import {installWindowAccelerators, WINDOW_ACCELERATOR_COMMANDS} from './window-accelerators.mjs';
import {projectStatePath} from './project-state.mjs';
import {RecentProjects, classifyProjectTarget, resolveProjectFile} from './project-files.mjs';
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
import {recordRecoveryEvent, readRecoveryEvents} from './recovery-journal.mjs';
import {productName, productVersion} from './product.mjs';
import {lock} from '../desktop-adapter/paths.mjs';
import {bootLogDirectory, bootLogFile, describeRecoveryEvent, renderExportReport, session as startTrace} from './boot-log.mjs';

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
  bootLogDirectory(userData);
  // Everything before this point is Electron's own cost and is reported as `early`; every
  // stage after it is one this shell chose to spend. A slow launch is nearly always one
  // entry of this list, and which one no longer needs a rebuild to find out.
  const trace = startTrace('boot', `shell=${productVersion} desktop=${lock.desktop.version} `
    + `harness=${lock.harness.version} platform=${process.platform} packaged=${String(app.isPackaged)} `
    + `userData=${userData}${testing ? ' testing=1' : ''}`);
  trace.stage('early electron main, before run');
  await cleanupGuideClones(userData);
  trace.stage('cleanup guide clones');
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
  trace.stage('theme and recent-projects state', `storedTheme=${String(storedTheme)} recent=${String(recent.list().length)}`);
  const report = error => {console.error(error); if (!testing) dialog.showErrorBox('DSH Project Desktop', error.message ?? String(error))};
  const perform = action => {void Promise.resolve().then(action).catch(report)};
  /**
   * Write one report that answers both "the app starts slowly" and "opening a project is
   * sometimes slow", plus the Recovery Mode reasons that used to live only inside each
   * project's state directory — and, when a project window supplied it, that project's own
   * official diagnostics archive, copied beside the report. One destination, send it on.
   */
  const exportStartupLog = async (destination, diagnostics) => {
    const boot = bootLogFile();
    let bootText;
    try {bootText = boot && existsSync(boot) ? readFileSync(boot, 'utf8') : undefined}
    catch (error) {console.error('Startup log export: the trace could not be read:', error.message)}
    const projects = [...projectTraces].map(([path, entry]) => [path,
      {...entry, recoveryEvents: readRecoveryEvents(entry.stateDirectory)}]);
    const text = renderExportReport({trace: bootText, at: new Date().toISOString(),
      product: `${productName} ${productVersion}`, platform: `${process.platform} ${process.arch}`,
      sources: [`launch trace ${boot ?? 'unavailable'}`, `user data ${userData}`], projects});
    let written = false;
    let diagnosticsCopy;
    try {
      writeFileSync(destination, text);
      written = true;
    } catch (error) {console.error('Startup log export:', error)}
    if (diagnostics && written) {
      try {
        // Gather the official archive next to the report instead of replacing it: opening a log
        // in a text editor must keep working, and the archive still satisfies the official format.
        const folder = dirname(destination);
        mkdirSync(folder, {recursive: true});
        const archive = await diagnostics(folder);
        const copy = join(folder, `dsh-diagnostics-${basename(destination).replace(/\.log$/u, '')}.zip`);
        copyFileSync(archive, copy);
        diagnosticsCopy = copy;
      } catch (error) {console.error('Startup log export: the diagnostics archive could not be added:', error)}
    }
    trace.event('logs exported', `${destination} bytes=${String(Buffer.byteLength(text))}`
      + `${diagnosticsCopy ? ` diagnostics=${diagnosticsCopy}` : ' diagnostics=unavailable'}`);
    return written;
  };
  const surfaces = new Map();
  const preparedSafeModes = new Map();
  // Every project this session touched, so one export can carry all of their traces and the
  // recovery reasons that belong to them. Recovery Mode used to be recorded only in the
  // project's own state directory, which is exactly the file nobody knows how to find.
  const projectTraces = new Map();
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
  async function close(id, {showWelcome = true} = {}) {
    await dismissSurface(id);
    await workspace.close(id);
    if (showWelcome && !quitting && !projects.size && !surfaces.size) await showGuide();
  }
  async function open(target, {showWelcomeOnError = true} = {}) {
    // One trace per open: the welcome window, a recent-project entry and a file association
    // all arrive here, and the project's stages must not be mixed with the launch trace.
    const openTrace = startTrace('project/open');
    let manifest;
    try {
      openTrace.stage('open requested', String(target));
      if (quitting) throw new Error('Application is shutting down');
      manifest = resolveProjectFile(target);
      openTrace.stage('project file resolved', manifest);
      assertProjectCreationReady(manifest);
      if (surfaces.has(manifest)) {
        const existing = surfaces.get(manifest);
        const handle = await existing.opening;
        openTrace.stage('already open, raised window', `recovery=${String(existing.recoveryMode)}`);
        openTrace.end('reused');
        handle.show();
        return;
      }
      const project = await workspace.open(manifest);
      openTrace.stage('workspace open returned');
      const previousGuide = guide;
      setImmediate(() => {if (previousGuide && !previousGuide.isDestroyed() && !workspace.failures().length) previousGuide.close()});
      openTrace.end();
      return project;
    } catch (error) {
      openTrace.stage('open failed', error?.message ?? String(error));
      openTrace.end('failed');
      if (manifest && session.get(manifest) && !quitting) {await recover(manifest, {requested: false, error, source: 'open'}); return}
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
    catch (error) {if (!quitting) await recover(manifest, {requested: false, error, locale, source: 'restart'})}
  }
  async function recover(manifest, {requested = true, error, locale, source = 'manual'} = {}) {
    return showProfileSurface(manifest, {recoveryMode: true, requested, error, locale, source});
  }
  async function showProfileSurface(manifest, {recoveryMode = false, requested = false, error, locale, source = 'manual'} = {}) {
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
      const failureStage = error?.failureStage ?? 'host-boot';
      const failureDetail = error ? await describeProjectError(error) : workspace.errors.get(manifest);
      // The official Recovery Assistant only ever receives this reason as a window query
      // parameter, so a dismissed window used to leave no evidence anywhere while the Host
      // log cannot exist yet. Keep the shell-owned copy beside the project's Host logs, and
      // put the same reason in the launch trace so the exported log carries it too.
      if (recoveryMode) {
        const journaled = recordRecoveryEvent(state.stateDirectory, {source, requested, readOnly, failureStage,
          detail: failureDetail ?? '', phase: session.get(manifest)?.phase ?? null, manifestPath: state.manifestPath});
        if (!journaled) console.error('Recovery journal: the Recovery Mode reason could not be recorded');
        trace.stage(`recovery mode entered (${source})`, describeRecoveryEvent(journaled ?? {source, requested, readOnly, failureStage,
          detail: failureDetail ?? ''}));
      }
      const handle = await createProjectNativeWindow({...state, locale: entry.locale, recovery, requested, readOnly,
        failureDetail, failureStage, isClosing: () => quitting || entry.closing,
        enterSafeMode: async () => {
          preparedSafeModes.set(manifest, await prepareSafeMode(state.stateDirectory));
        }});
      entry.handle = handle;
      entry.done = handle.result.then(async result => {
        if (surfaces.get(manifest) === entry) surfaces.delete(manifest);
        if (entry.closing || quitting) return;
        if (result === 'restart') await restart(manifest);
        else if (result === 'safe-mode') {
          try {await workspace.safeMode(manifest)} catch (cause) {await recover(manifest, {requested: false, error: cause, source: 'safe-mode'})}
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
      // The Host and window launch: the slow half of opening a project, named per project so
      // several opens interleaving in one log stay readable.
      const trace = startTrace(`project/open:${basename(manifest, '.agent-project')}`, `safeMode=${String(safeMode)}`);
      // Remember where this project's own state lives: one export must be able to carry every
      // project's recovery reasons without the operator hunting for per-project directories.
      projectTraces.set(manifest, {stateDirectory: state.stateDirectory, trace, at: new Date().toISOString()});
      let detach, stop, temporary;
      let value;
      try {
        if (safeMode) {
          temporary = preparedSafeModes.get(manifest) ?? await prepareSafeMode(state.stateDirectory);
          preparedSafeModes.delete(manifest);
        }
        else await cleanupSafeMode(state.stateDirectory);
        trace.stage('safe mode state prepared');
        const title = basename(manifest, '.agent-project');
        value = await openNativeProject(electron, {...state, projectRoot: dirname(manifest), ...temporary,
          trace, exportStartupLog,
          title: safeMode ? `${title} — ${language() === 'zh' ? '安全模式' : 'Safe Mode'}` : title,
          locale: language(), hidden: testing, onMenuChanged: refreshMenus, onError: report,
          checkForUpdates: window => updates.checkNow(window),
          onWarning: error => console.error('Project checkpoint:', error),
          windowState: session.window(manifest), saveWindowState: safeMode ? undefined : bounds => session.saveWindow(manifest, bounds),
          onFocus: () => session.focus(manifest),
          // Commands behind the self-drawn titlebar menu (Windows/Linux have no native menu
          // bar on our window shape); they reuse exactly the application-menu implementations.
          newProject: () => perform(newProject),
          openProject: () => perform(pickOpen),
          showWelcome: () => perform(showGuide),
          closeProject: () => perform(() => close(manifest)),
          recentProjects: () => recent.list().map(item => ({title: item.title, path: item.path, available: item.available !== false})),
          openRecent: path => perform(() => open(path)),
          showProfile: () => perform(() => showProfileSurface(manifest)),
          restartProject: () => perform(() => restart(manifest)),
          recoverProject: () => perform(() => recover(manifest)),
          toggleSafeMode: () => perform(async () => {
            const entry = [...projects].find(([, project]) => project === active());
            if (!entry) return;
            if (entry[1].safeMode) {await workspace.exitSafeMode(entry[0]); await recover(entry[0], {source: 'safe-mode-exit'})}
            else {await dismissSurface(entry[0]); await workspace.safeMode(entry[0])}
          }),
          onFailure: error => perform(async () => {
            if (quitting) return;
            const locale = value?.locale;
            error.message = await describeProjectError(error);
            await workspace.fail(manifest, error); await recover(manifest, {requested: false, error, locale, source: 'runtime'});
          }),
          close: () => perform(async () => {if (safeMode) {await workspace.exitSafeMode(manifest); await recover(manifest, {source: 'safe-mode-exit'})} else await close(manifest)}),
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
          trace.stage('project remembered, state saved');
          // A fresh checkout carries no resources/ directory at all, because the project
          // definition excludes every resource repository from the parent Git tree. Rebuild
          // them through the Host's own resource API: opening never waits, the Plugin's panel
          // shows progress and a failure stays recoverable from there.
          if (!testing) {
            trace.stage('resource restore started (not awaited)');
            void restoreMissingResources(value.host, {onError: error => {
              console.error('Resource restore:', error.message);
              trace.stage('resource restore failed', error.message);
            }}).then(() => trace.stage('resource restore finished'));
          }
        }
        trace.end();
        return value;
      } catch (error) {
        trace.stage('project launch failed', error?.message ?? String(error));
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
    // Windows 窗口没有原生菜单栏（见 window-accelerators.mjs）：这三个快捷键改由窗口级绑定提供，
    // 这里只保留菜单项本身，不再注册 accelerator，避免同一组合被两处触发。
    const fileAccelerator = value => process.platform === 'win32' ? {} : {accelerator: value};
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
        command(zh ? '新建项目…' : 'New Project…', newProject, fileAccelerator('CmdOrCtrl+Shift+N')),
        command(zh ? '打开项目…' : 'Open Project…', pickOpen, fileAccelerator('CmdOrCtrl+O')),
        {label: zh ? '最近项目' : 'Recent Projects', submenu: recentItems, enabled: recentItems.length > 0},
        command(zh ? '欢迎窗口' : 'Welcome Window', showGuide),
        {type: 'separator'}, command(zh ? '关闭项目' : 'Close Project', () => {const entry = [...projects].find(([, value]) => value === active()); if (entry) return close(entry[0])},
          {...fileAccelerator('CmdOrCtrl+W'), enabled: Boolean(current)})]},
      roles.edit, roles.view,
      {label: zh ? '项目工具' : 'Project Tools', submenu: [...tools,
        command(zh ? '打开项目终端' : 'Open Project Terminal', () => active()?.terminal(), {enabled: Boolean(current) && !current.safeMode}),
        command(zh ? '导出日志与诊断…' : 'Export Logs and Diagnostics…', () => active()?.diagnostics(), {enabled: Boolean(current)}),
        command(zh ? 'Profile…' : 'Profiles…', () => {
          const entry = [...projects].find(([, value]) => value === active());
          if (entry) return showProfileSurface(entry[0]);
        }, {enabled: Boolean(current) && !current.safeMode}),
        {type: 'separator'},
        command(zh ? '重启当前项目' : 'Restart Current Project', () => active()?.restart(), {enabled: Boolean(current)}),
        command(current?.safeMode ? (zh ? '退出安全模式' : 'Exit Safe Mode') : (zh ? '在安全模式中打开' : 'Open in Safe Mode'), async () => {
          const entry = [...projects].find(([, value]) => value === active()); if (!entry) return;
          if (entry[1].safeMode) {await workspace.exitSafeMode(entry[0]); await recover(entry[0], {source: 'safe-mode-exit'})}
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
  // A launch trace that only ends when the welcome window appears says nothing about a slow
  // quiet start; closing the app settles the `boot` total in every path, including the test
  // modes that return before the normal tail of run().
  app.on('will-quit', () => trace.end('quit'));
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
  trace.stage('app.whenReady');
  // One panel serves both About entry points: the macOS application menu's native About item
  // (official `role: 'about'`) and the self-drawn titlebar entry on Windows/Linux. The shell
  // version alone never says which DSH runtime is pinned, and the Host refuses to start when the
  // installed one differs from the lock, so this is the running runtime's identity.
  // macOS draws the `version` field inside the shell version's own line ("版本 0.1.8 (DSH
  // 0.1.5-rc.2)"), which keeps the DSH version at the same type size; Windows/Linux have no build
  // field on their panel and read the credits line instead.
  const harnessIdentity = `DSH (DeepSeek Harness) ${lock.harness.version}`;
  app.setAboutPanelOptions({applicationName: productName, applicationVersion: productVersion,
    ...(process.platform === 'darwin' ? {version: `DSH ${lock.harness.version}`} : {credits: harnessIdentity})});
  lastLocale = app.getLocale().startsWith('zh') ? 'zh' : 'en';
  trace.stage('about panel and app locale');
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
  trace.stage('updates service');
  // Single-instance ownership is held and no Host has started. Remove only disposable trees.
  const stateRoot = join(userData, 'projects');
  let disposableProjects = 0;
  if (existsSync(stateRoot)) for (const entry of readdirSync(stateRoot, {withFileTypes: true})) {
    if (entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)) {
      disposableProjects += 1;
      try {await cleanupSafeMode(join(stateRoot, entry.name))} catch (error) {report(error)}
    }
  }
  trace.stage('disposable project state cleanup', `projects=${String(disposableProjects)}`);
  // Shell-owned artwork supplies the application and tray identity on every window.
  app.dock?.setIcon(appIcon);
  const icon = nativeImage.createFromPath(trayIcon);
  if (icon.isEmpty()) throw new Error(`Failed to load tray icon: ${trayIcon}`);
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  tray = new Tray(icon); tray.setToolTip('DSH Project Desktop');
  tray.on('click', () => perform(showApplication));
  // Windows 上窗口没有原生菜单栏，application menu 也不再注册这三个快捷键（见 refreshMenus），
  // 因此把它们绑在窗口级：官方 win32 策略 removeMenu() 之后依然可用。
  installWindowAccelerators({app, BrowserWindow, run: (command, window) => {
    if (command === WINDOW_ACCELERATOR_COMMANDS.newProject) return perform(newProject);
    if (command === WINDOW_ACCELERATOR_COMMANDS.openProject) return perform(pickOpen);
    const entry = [...projects].find(([, project]) => project.window === window) ?? [...projects].find(([, project]) => project === active());
    if (entry) return perform(() => close(entry[0]));
  }});
  refreshMenus();
  trace.stage('tray, accelerators, menus');
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
  trace.stage('workspace restore (session projects)', `projects=${String(projects.size)} failures=${String(workspace.failures().length)}`);
  for (const failure of workspace.failures()) {
    try {resolveProjectFile(failure.path)} catch {continue}
    await recover(failure.path, {requested: failure.phase === 'recovering', error: new Error(failure.error ?? 'Previous project startup failed'), source: 'startup-restore'});
  }
  while (startupFiles.length) await Promise.allSettled(startupFiles.splice(0).map(open));
  startupComplete = true;
  trace.stage('startup files opened', `files=${String(process.argv.filter(value => value.endsWith('.agent-project')).length)}`);
  if ((!projects.size && !surfaces.size) || workspace.failures().some(item => !surfaces.has(item.path))) {
    await showGuide();
    trace.stage('welcome window created');
  }
  trace.end(`projects=${String(projects.size)}`);
  if (!testing) void updates.offerCleanup();
  if (lifecycleTest) {
    try {await (await import('../../scripts/native-lifecycle-case.mjs')).runLifecycleCase({electron, open, close, showGuide, dismissSurface,
      projects, userData, workspace, session, hasGuide: () => Boolean(guide)});}
    catch (error) {console.error(error); process.exitCode = 1}
    finally {app.quit()}
  }
}
