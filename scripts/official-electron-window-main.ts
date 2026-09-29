/** Disposable Shell-owned Electron windows used only by the official source probe. */
import electron from 'electron';
import {readFileSync, writeFileSync} from 'node:fs';
import {serveWebDocument, forwardWebRequest} from '@official-web-document';

const {app, BrowserWindow, ipcMain, protocol, session} = electron;
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
  const owners = new Map();
  const trusted = event => {
    const owner = owners.get(event.sender.id);
    if (!owner || event.sender !== owner.window.webContents || event.senderFrame !== event.sender.mainFrame
      || !event.senderFrame?.url.startsWith('dsh-app://app/')) throw new Error('Untrusted Desktop caller');
    return owner;
  };
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
  for (const project of config.projects) {
    const partition = session.fromPartition(project.partition);
    const hostOrigin = new URL(project.hostUrl).origin;
    // Official Desktop's Web-document implementation is bundled unchanged.
    // The Shell owns the project Session and only forwards to its Host.
    partition.protocol.handle('dsh-app', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return Promise.resolve(new Response(null, {status: 404}));
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
        || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
        return serveWebDocument(request, config.webDist);
      }
      return forwardWebRequest(request, project.hostUrl, project.cookie);
    });
    const window = new BrowserWindow({width: 1120, height: 760, show: true,
      webPreferences: {preload: config.preload, partition: project.partition,
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
    const webContentsId = window.webContents.id;
    owners.set(webContentsId, {window, project});
    window.on('closed', () => {
      owners.delete(webContentsId);
      if (owners.size === 0) quit();
    });
    partition.webRequest.onBeforeSendHeaders({urls: ['ws://127.0.0.1/*']}, (details, callback) => {
      const requested = new URL(details.url);
      if (details.webContentsId !== window.webContents.id || requested.host !== new URL(project.hostUrl).host) {
        callback({cancel: true}); return;
      }
      const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([name, value]) => [name.toLowerCase(), value]));
      if (headers.origin !== 'dsh-app://app') {callback({cancel: true}); return;}
      callback({requestHeaders: {...headers, origin: hostOrigin, cookie: project.cookie, 'sec-fetch-site': 'same-origin'}});
    });
    window.webContents.on('console-message', event => {
      if (event.level === 'error') console.error(`Official renderer ${project.id}:`, event.message);
    });
    await window.loadURL('dsh-app://app/');
    windows.push({window, project, partition});
  }

  const results = [];
  for (const {window, project} of windows) {
    const deadline = Date.now() + 30000;
    let state;
    do {
      state = await window.webContents.executeJavaScript(`({title: document.title, text: document.body?.innerText?.slice(0, 1000) ?? '',
        boot: Boolean(globalThis.__DSH_BOOT_READY__), transport: globalThis.__DSH_TRANSPORT__?.ownsHost === true,
        platform: document.documentElement.dataset.platform})`);
      if (state.transport && state.text.length > 100) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    } while (Date.now() < deadline);
    if (!state.transport || state.text.length <= 100) throw new Error(`Official Web ${project.id} did not boot: ${JSON.stringify(state)}`);
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
  if (windows.length > 1) {
    windows[0].window.destroy();
    const survivor = windows[1].window;
    const stillAlive = await survivor.webContents.executeJavaScript('document.title === "DeepSeek Harness" && globalThis.__DSH_TRANSPORT__?.ownsHost === true');
    if (!stillAlive) throw new Error('Closing the first project window affected the second');
  }
  const result = {ok: true, projects: results, survivingWindow: windows.length > 1};
  writeFileSync(config.result, JSON.stringify(result, null, 2) + '\n');
  console.log('OFFICIAL_WINDOW_PROBE', JSON.stringify(result));
  setTimeout(() => app.exit(0), 500);
}
void run().catch(quit);
