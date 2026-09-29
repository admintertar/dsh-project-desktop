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
  for (const project of config.projects) {
    const projectSession = configureOfficialProjectSession({electron, partitionName: project.partition,
      hostUrl: project.hostUrl, cookie: project.cookie, webDist: config.webDist,
      serveWebDocument, forwardWebRequest});
    const window = new BrowserWindow({width: 1120, height: 760, show: true,
      webPreferences: {preload: config.preload, partition: project.partition,
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
    const webContentsId = window.webContents.id;
    projectSession.bindWindow(window);
    owners.register(window, {project});
    window.on('closed', () => {
      owners.unregister(window);
      if (owners.size === 0) quit();
    });
    window.webContents.on('console-message', event => {
      if (event.level === 'error') {
        rendererErrors.push(`${project.id}: ${event.message}`);
        console.error(`Official renderer ${project.id}:`, event.message);
      }
    });
    await window.loadURL('dsh-app://app/');
    windows.push({window, project, partition: projectSession.partition});
  }

  const results = [];
  for (const {window, project} of windows) {
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
    results.push({id: project.id, title: state.title, boot: state.boot, transport: state.transport,
      platform: state.platform, textLength: state.text.length, hostOrigin: new URL(project.hostUrl).origin,
      partition: project.partition, webContentsId: window.webContents.id});
  }
  if (new Set(results.map(result => result.hostOrigin)).size !== results.length
    || new Set(results.map(result => result.partition)).size !== results.length
    || new Set(windows.map(({partition}) => partition)).size !== windows.length) {
    throw new Error('Project Host origins or Electron Sessions are not isolated');
  }
  if (rendererErrors.length) throw new Error(`Official renderer errors: ${rendererErrors.join(' | ')}`);
  if (windows.length > 1) {
    windows[0].window.destroy();
    const survivor = windows[1].window;
    const stillAlive = await survivor.webContents.executeJavaScript('document.title === "DeepSeek Harness" && globalThis.__DSH_TRANSPORT__?.ownsHost === true');
    if (!stillAlive) throw new Error('Closing the first project window affected the second');
  }
  const result = {ok: true, projectPlugin: Boolean(config.projectPlugin), projects: results, survivingWindow: windows.length > 1};
  writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
  console.log('OFFICIAL_WINDOW_PROBE', JSON.stringify(result));
  setTimeout(() => app.exit(0), 500);
}
void run().catch(quit);
