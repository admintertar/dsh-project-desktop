import {basename, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {findProjectFile, createProjectFromPlan} from '../app/project-files.mjs';
import {trustedSender} from './renderer-security.mjs';
import {GuideClones} from '../app/guide-clones.mjs';
import {inspectGuideResource} from '../desktop-adapter/stable/guide-resources.mjs';

const creations = new Set();
const draftCleanups = new Set();
const draftPools = new Set();
const guideControllers = new Map();
export async function cancelGuideCreations() {
  for (const [controller, window] of guideControllers) {
    controller.abort();
    // A failed application quit can open a fresh guide instead of retaining an aborted draft.
    if (!window.isDestroyed()) window.destroy();
  }
  const pending = [...creations];
  for (const operation of pending) operation.controller.abort();
  await Promise.allSettled(pending.map(operation => operation.promise));
  await Promise.all([...draftPools].map(async pending => (await pending).dispose()));
  await Promise.all([...draftCleanups]);
}

export async function createGuideWindow(electron, {repository, iconPath, locale, getLocale, recent, open, hidden = false, mode = 'welcome',
  chooseDirectory, defaultDirectory, openNewProject, recentChanged = () => {}, getFailures = () => [], warning, forget, relocate,
  createClonePool = () => GuideClones.create(electron.app.getPath('userData'))}) {
  const {BrowserWindow, dialog} = electron;
  const html = join(repository, 'dist/guide/index.html');
  const createOnly = mode === 'create';
  const title = createOnly ? (locale === 'zh' ? '新建项目' : 'New Project')
    : (locale === 'zh' ? '欢迎使用 DSH Project Desktop' : 'Welcome to DSH Project Desktop');
  const expectedUrl = `${pathToFileURL(html).href}${createOnly ? '?mode=create' : ''}`;
  const window = new BrowserWindow({title, icon: iconPath, width: createOnly ? 1180 : 1020, height: createOnly ? 820 : 720,
    minWidth: 420, minHeight: 460, show: false, webPreferences: {preload: join(repository, 'dist/guide/preload.cjs'), sandbox: true,
      contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: !hidden,
      partition: createOnly ? 'project-desktop-create' : 'project-desktop-guide'}});
  let selection;
  const pickedResources = new Map();
  let busy = false;
  const creationController = new AbortController();
  guideControllers.set(creationController, window);
  let clonePool;
  const pool = () => {
    if (!clonePool) {clonePool = createClonePool(); draftPools.add(clonePool);}
    return clonePool;
  };
  let operations = Promise.resolve();
  const queue = work => {
    const result = operations.then(() => {creationController.signal.throwIfAborted(); return work()});
    operations = result.catch(() => {}); return result;
  };
  window.once('closed', () => {
    creationController.abort();
    // Wait for any final copy and plugin preparation before deleting this window's staging area.
    const cleanup = operations.then(async () => {
      await Promise.allSettled([...creations].filter(item => item.controller === creationController).map(item => item.promise));
      if (clonePool) {await (await clonePool).dispose(); draftPools.delete(clonePool);}
      guideControllers.delete(creationController);
    });
    draftCleanups.add(cleanup);
    void cleanup.finally(() => draftCleanups.delete(cleanup)).catch(error => console.error('Draft cleanup failed:', error.message));
  });
  const ready = Promise.withResolvers();
  const contents = window.webContents;
  window.on('focus', () => contents.send('project-desktop:state-changed'));
  contents.on('console-message', event => {if (event.level === 'error') console.error('Project guide:', event.message)});
  contents.on('preload-error', (_event, _path, error) => console.error('Project guide preload:', error));
  contents.setWindowOpenHandler(() => ({action: 'deny'}));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.session.setPermissionRequestHandler((_sender, _permission, callback) => callback(false));
  contents.session.setPermissionCheckHandler(() => false);
  const handle = async (event, action, value) => {
    if (!trustedSender(event, contents, expectedUrl, true)) throw new Error('Untrusted guide sender');
    if (action === 'state') {
      locale = getLocale?.() ?? locale;
      window.setTitle(createOnly ? (locale === 'zh' ? '新建项目' : 'New Project')
        : (locale === 'zh' ? '欢迎使用 DSH Project Desktop' : 'Welcome to DSH Project Desktop'));
      ready.resolve();
      return {locale, recent: recent.list(), failures: getFailures(), warning, version: '0.1.0', mode};
    }
    if (action === 'resource-auth') return clonePool ? (await clonePool).authentication(value) : {requests: []};
    if (action === 'clone-state') return clonePool ? (await clonePool).snapshot() : [];
    if (action === 'clone-start' || action === 'clone-cancel' || action === 'clone-retain') {
      if (busy || !selection || selection.existing) throw new Error('project-closing');
      return queue(async () => {
        const manager = await pool();
        creationController.signal.throwIfAborted();
        if (action === 'clone-start') return manager.start(value);
        if (action === 'clone-cancel') return manager.cancel(value?.id);
        await manager.retain(value?.ids); return true;
      });
    }
    if (busy) throw new Error('A project operation is already in progress');
    busy = true;
    try {
      if (action === 'cancel' && createOnly) {
        // Let the renderer receive the IPC result before its window is destroyed.
        setImmediate(() => {if (!window.isDestroyed()) window.close()});
        return true;
      }
      if (action === 'new' && !createOnly && openNewProject) {
        await openNewProject();
        return true;
      }
      if (action === 'new') {
        const directory = defaultDirectory ?? process.env.HOME ?? process.cwd();
        selection = {directory, existing: undefined, name: '', filename: basename(`${directory}/project.agent-project`)};
        pickedResources.clear();
        return selection;
      }
      if (action === 'choose') {
        const directory = chooseDirectory ? await chooseDirectory() : await (async () => {
          const result = await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory']});
          return result.canceled ? null : result.filePaths[0];
        })();
        if (!directory) return null;
        const existing = findProjectFile(directory);
        pickedResources.clear();
        selection = {directory, existing, name: basename(directory), filename: basename(existing ?? `${directory}/${basename(directory)}.agent-project`)};
        return selection;
      }
      if (action === 'browse-location') {
        const directory = chooseDirectory ? await chooseDirectory() : await (async () => {
          const result = await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory']});
          return result.canceled ? null : result.filePaths[0];
        })();
        return directory;
      }
      if (action === 'pick-resource') {
        if (typeof value?.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id)) throw new Error('Invalid resource selection');
        const result = await dialog.showOpenDialog(window, {properties: ['openDirectory']});
        if (result.canceled) return null;
        if (value.inspect) {
          const inspection = await inspectGuideResource(result.filePaths[0], creationController.signal);
          pickedResources.set(value.id, inspection.path);
          return inspection;
        }
        pickedResources.set(value.id, result.filePaths[0]);
        return result.filePaths[0];
      }
      if (action === 'remove-recent') {
        if (typeof value !== 'string' || !recent.list().some(item => item.path === value)) throw new Error('Unknown recent project');
        recent.remove(value);
        recentChanged();
        return recent.list();
      }
      if (['retry', 'forget', 'relocate'].includes(action)) {
        const path = value?.path;
        if (typeof path !== 'string' || !getFailures().some(item => item.path === path)) throw new Error('Unknown project');
        if (action === 'forget') {await forget(path); return true}
        if (action === 'retry') await open(path);
        if (action === 'relocate') {
          const result = await dialog.showOpenDialog(window, {properties: ['openFile'], filters: [{name: 'Project', extensions: ['agent-project']}],
            message: locale === 'zh' ? '选择项目文件。其他路径使用各自的项目环境，原有运行数据会保留。' : 'Select a project file. Other locations use their own project environment; existing runtime data is preserved.'});
          if (result.canceled) return null;
          await relocate(path, result.filePaths[0]);
        }
      } else if (action === 'confirm') {
        await operations;
        if (!selection) throw new Error('Select a project folder first');
        if (selection.existing) await open(selection.existing);
        else {
          const draft = value && typeof value === 'object' ? value : {};
          const resources = Array.isArray(draft.resources) ? draft.resources.map(item => {
            const mode = item?.mode;
            if (mode === 'link' && pickedResources.get(item?.id) === undefined) throw new Error('Choose a directory for every linked resource');
            return {id: item?.id, name: item?.name, role: item?.role, mode,
              path: mode === 'link' ? pickedResources.get(item?.id) : item?.path,
              ...(mode === 'remote' ? {url: item?.url, branch: item?.branch} : mode === 'link' ? {type: item?.type, url: item?.url} : {})};
          }) : undefined;
          // Use the submitted location so both typing and the native picker edit the actual destination.
          const operation = {controller: creationController, promise: createProjectFromPlan({
            location: draft.location ?? selection.directory, name: draft.name, templateId: draft.templateId, resources,
          }, {signal: creationController.signal, installRemote: async (item, target, signal) => (await pool()).install(item, target, signal)})};
          creations.add(operation);
          let manifest;
          try {manifest = await operation.promise} finally {creations.delete(operation)}
          creationController.signal.throwIfAborted();
          await open(manifest);
        }
      } else if (action === 'open') {
        const result = await dialog.showOpenDialog(window, {properties: ['openFile'], filters: [{name: 'Project', extensions: ['agent-project']}]});
        if (result.canceled) return null;
        await open(result.filePaths[0]);
      } else if (action === 'recent') {
        const item = typeof value === 'string' ? recent.list().find(item => item.path === value) : undefined;
        if (!item) throw new Error('Unknown recent project');
        if (item.available === false) throw new Error('Recent project is unavailable');
        await open(item.path);
      } else throw new Error('Unsupported guide action');
      // Give the invoke response time to settle before destroying its Renderer.
      setImmediate(() => {if (!window.isDestroyed() && (createOnly || !getFailures().length)) window.close()});
      return true;
    } finally {busy = false}
  };
  contents.ipc.handle('project-desktop:guide', async (...args) => {
    try {return {ok: true, value: await handle(...args)}}
    catch (error) {return {ok: false, error: error.message ?? String(error)}}
  });
  let timeout;
  try {
    await window.loadFile(html, createOnly ? {query: {mode: 'create'}} : undefined);
    // Menu commands must wait until the React/preload listeners are installed.
    await Promise.race([ready.promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Welcome window did not become ready')), 10000);
    })]);
    if (!hidden) window.show();
    return window;
  } catch (error) {if (!window.isDestroyed()) window.destroy(); throw error}
  finally {clearTimeout(timeout)}
}
