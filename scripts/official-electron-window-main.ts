/** Disposable Shell-owned Electron windows used only by the official source probe. */
import electron from 'electron';
import {readFileSync, writeFileSync} from 'node:fs';
import {serveWebDocument, forwardWebRequest} from '@official-web-document';
import {configureOfficialProjectSession} from '../src/desktop-adapter/official/web-session.mjs';
import {createOfficialWindowOwners} from '../src/desktop-adapter/official/ipc-owners.mjs';

const {app, BrowserWindow, ipcMain, protocol} = electron;
const config = JSON.parse(readFileSync(process.env.DSH_OFFICIAL_WINDOW_PROBE_CONFIG!, 'utf8'));
app.setName('DSH Project Desktop Official Probe');
app.setPath('userData', config.userData);
// A single-window probe also temporarily has no windows while testing reopen.
app.on('window-all-closed', () => {});
protocol.registerSchemesAsPrivileged([{scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true,
}}]);

const quit = (error?: unknown) => {
  if (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    writeFileSync(config.result, JSON.stringify({ok: false, error: message}) + '\n');
    console.error(message);
    app.exit(1);
  } else app.quit();
};

async function run() {
  // Electron's ready event cannot fire while this ESM entry is awaiting at top level.
  await app.whenReady();
  const owners = createOfficialWindowOwners();
  const trusted = event => owners.trusted(event);
  ipcMain.handle('dsh-desktop:boot', event => {
    const {project} = trusted(event);
    return {injections: project.injections, streamBaseUrl: new URL(project.hostUrl).origin};
  });
  ipcMain.handle('dsh-desktop:boot-failed', (event, message) => {
    trusted(event);
    quit(new Error(`Official Web boot failed: ${String(message)}`));
  });
  ipcMain.handle('dsh-desktop:locale-bootstrap', event => {
    trusted(event);
    return {languages: ['en'], preference: 'en'};
  });
  ipcMain.handle('dsh-desktop:updates-status', event => {
    trusted(event);
    return {phase: 'idle'};
  });
  ipcMain.handle('dsh-desktop:onboarding-api-key', event => {
    trusted(event);
    return true;
  });
  ipcMain.handle('dsh-desktop:device-info', event => {
    trusted(event);
    return '';
  });
  // Production must wire official keyboard.ts to each project window.
  ipcMain.handle('dsh-desktop:shortcuts-get', event => {
    trusted(event);
    return {revision: 'probe-disabled', sequence: 0, document: {schemaVersion: 1, profiles: {}},
      status: 'loading', error: null, usingDefaults: true};
  });

  const windows = [];
  const rendererErrors = [];
  /** Own the protocol and IPC registrations for exactly one window lifetime. */
  async function openProjectWindow(project) {
    const projectSession = configureOfficialProjectSession({electron, partitionName: project.partition,
      hostUrl: project.hostUrl, cookie: project.cookie, webDist: config.webDist,
      serveWebDocument, forwardWebRequest});
    let window;
    let unregister;
    const close = () => {
      unregister?.();
      if (window && !window.isDestroyed()) window.destroy();
      projectSession.dispose();
    };
    try {
      window = new BrowserWindow({width: 1120, height: 760, show: true,
        webPreferences: {preload: config.preload, partition: project.partition,
          nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
      projectSession.bindWindow(window);
      unregister = owners.register(window, {project});
      window.on('closed', () => {
        unregister();
        projectSession.dispose();
      });
      window.webContents.on('console-message', event => {
        if (event.level === 'error') {
          rendererErrors.push(`${project.id}: ${event.message}`);
          console.error(`Official renderer ${project.id}:`, event.message);
        }
      });
      await window.loadURL('dsh-app://app/');
      return {window, project, partition: projectSession.partition, close};
    } catch (error) {close(); throw error}
  }
  for (const project of config.projects) windows.push(await openProjectWindow(project));

  /** Assert real Web/Project readiness, including after reuse of the persistent Session. */
  async function verifyWindow({window, project}) {
    const deadline = Date.now() + 30000;
    let state;
    do {
      state = await window.webContents.executeJavaScript(`({title: document.title, text: document.body?.innerText?.slice(0, 1000) ?? '',
        boot: Boolean(globalThis.__DSH_BOOT_READY__), transport: globalThis.__DSH_TRANSPORT__?.ownsHost === true,
        platform: document.documentElement.dataset.platform})`);
      if (state.transport && state.text.length > 100 && (!config.projectPlugin
        || (state.text.includes(`Project mode · probe-${project.id}`) && !state.text.includes('Loading project...')))) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    } while (Date.now() < deadline);
    if (!state.transport || state.text.length <= 100 || (config.projectPlugin
      && (!state.text.includes(`Project mode · probe-${project.id}`) || state.text.includes('Loading project...')))) {
      throw new Error(`Official Web ${project.id} did not finish booting: ${JSON.stringify(state)}`);
    }
    if (config.projectPlugin) {
      const settledDeadline = Date.now() + 10000;
      let settledText = '';
      do {
        settledText = await window.webContents.executeJavaScript('document.body?.innerText ?? ""');
        if (settledText.includes('Project assets') && !settledText.includes('Loading project...')) break;
        await new Promise(resolve => setTimeout(resolve, 300));
      } while (Date.now() < settledDeadline);
      if (!settledText.includes('Project assets') || settledText.includes('Loading project...')) {
        throw new Error(`Project assets did not settle in window ${project.id}`);
      }
    }
    // Let Chromium paint the settled DOM before capturePage records evidence.
    await new Promise(resolve => setTimeout(resolve, 700));
    await window.webContents.capturePage().then(image => writeFileSync(project.screenshot, image.toPNG()));
    return {id: project.id, title: state.title, boot: state.boot, transport: state.transport,
      platform: state.platform, textLength: state.text.length, hostOrigin: new URL(project.hostUrl).origin,
      partition: project.partition, webContentsId: window.webContents.id};
  }
  const results = [];
  for (const window of windows) results.push(await verifyWindow(window));
  if (new Set(results.map(result => result.hostOrigin)).size !== results.length
    || new Set(results.map(result => result.partition)).size !== results.length
    || new Set(windows.map(({partition}) => partition)).size !== windows.length) {
    throw new Error('Project Host origins or Electron Sessions are not isolated');
  }
  windows[0].window.destroy();
  if (windows.length > 1) {
    const survivor = windows[1].window;
    const stillAlive = await survivor.webContents.executeJavaScript('document.title === "DeepSeek Harness" && globalThis.__DSH_TRANSPORT__?.ownsHost === true');
    if (!stillAlive) throw new Error('Closing the first project window affected the second');
  }
  if (owners.size !== windows.length - 1 || await windows[0].partition.protocol.isProtocolHandled('dsh-app')) {
    throw new Error('Closed window retained its IPC owner or protocol handler');
  }
  // Keep the Host running here: this specifically verifies window/Session reuse,
  // not Host restart, Profile recovery or the formal Shell close confirmation.
  const reopened = await openProjectWindow(config.projects[0]);
  const reopenedResult = await verifyWindow(reopened);
  if (reopened.partition !== windows[0].partition || reopenedResult.webContentsId === results[0].webContentsId) {
    throw new Error('Window reopen did not reuse its persistent Session with a new WebContents');
  }
  // A delayed second cleanup from the old lifecycle must not remove the new handler.
  windows[0].close();
  if (!await reopened.partition.protocol.isProtocolHandled('dsh-app')) throw new Error('Old cleanup detached the reopened window');
  if (windows.length > 1 && !await windows[1].window.webContents.executeJavaScript('globalThis.__DSH_TRANSPORT__?.ownsHost === true')) {
    throw new Error('Reopening the first window affected the second');
  }
  reopened.close();
  for (const window of windows) window.close();
  if (owners.size || (await Promise.all(windows.map(({partition}) => partition.protocol.isProtocolHandled('dsh-app')))).some(Boolean)) {
    throw new Error('Window teardown left IPC owners or protocol handlers');
  }
  if (rendererErrors.length) throw new Error(`Official renderer errors: ${rendererErrors.join(' | ')}`);
  const result = {ok: true, projectPlugin: Boolean(config.projectPlugin), projects: results, survivingWindow: windows.length > 1,
    windowLifecycle: {reopened: reopenedResult, reusedSession: true, oldCleanupSafe: true, ownersAfterClose: owners.size, protocolsReleased: true}};
  writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
  console.log('OFFICIAL_WINDOW_PROBE', JSON.stringify(result));
  setTimeout(() => app.exit(0), 500);
}
void run().catch(quit);
