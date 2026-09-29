/** Real Electron project-window experiment against one pinned official Harness checkout. */
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync, execFileSync} from 'node:child_process';
import {build} from 'esbuild';

const source = process.argv[2];
if (!source || (process.argv.length !== 3 && (process.argv.length !== 4 || process.argv[3] !== '--two'))) {
  throw new Error('Usage: node --import /path/to/tsx/loader.mjs scripts/probe-official-electron-window.mjs /path/to/deepseek-harness [--two]');
}
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 19) || nodeMajor === 23) {
  throw new Error(`Official Desktop probe requires Node 22.19+ or 24+; found ${process.versions.node}`);
}
const official = resolve(source);
execFileSync(process.execPath, [fileURLToPath(new URL('./verify-official-candidate.mjs', import.meta.url)), official], {stdio: 'inherit'});
const load = name => import(pathToFileURL(join(official, name)).href);
const [{prepareDevelopmentProject}, {DesktopProjectManager}, {resolveDesktopPaths}, {DesktopHostProcess}, {DESKTOP_HOST_PROTOCOL_VERSION}] = await Promise.all([
  load('apps/desktop/scripts/development-project.ts'), load('apps/desktop/src/project-manager.ts'),
  load('apps/desktop/src/paths.ts'), load('apps/desktop/src/host-process.ts'), load('apps/desktop/src/host-protocol.ts'),
]);
const version = JSON.parse(readFileSync(join(official, 'apps/desktop/package.json'), 'utf8')).version;
const pnpmVersion = JSON.parse(readFileSync(join(official, 'apps/desktop/node_modules/pnpm/package.json'), 'utf8')).version;
const root = mkdtempSync(join(tmpdir(), 'dsh-official-electron-window-'));
const resultFile = join(root, 'result.json');
const hosts = [];
try {
  const runtime = join(root, 'runtime');
  cpSync(join(official, 'packages/skill/skill-office/assets'), join(runtime, 'office-skills'), {recursive: true});
  const nodeBin = join(runtime, 'primary-runtime/dependencies/node/bin');
  mkdirSync(nodeBin, {recursive: true});
  cpSync(process.execPath, join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node'));
  const projects = [];
  const count = process.argv[3] === '--two' ? 2 : 1;
  for (let index = 0; index < count; index++) {
    const id = String.fromCharCode(65 + index);
    const home = join(root, `home-${id}`);
    mkdirSync(home, {recursive: true});
    const project = prepareDevelopmentProject({projectDir: join(root, `project-${id}`), cliDir: join(official, 'apps/cli'),
      hostDir: join(official, 'apps/desktop-host'), dependencyDir: join(official, 'node_modules/.pnpm/node_modules'),
      release: {schemaVersion: 1, version, pnpmVersion, nodeVersion: process.versions.node,
        hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION},
      target: process.platform === 'win32' ? 'win-x64' : process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'});
    const paths = resolveDesktopPaths(home);
    await new DesktopProjectManager(paths, {dsh: project}).applyRelease();
    writeFileSync(join(paths.profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n');
    const environment = {...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED'};
    for (const key of Object.keys(environment)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(key)) delete environment[key];
    const host = new DesktopHostProcess(process.execPath, project, paths.profile, undefined, environment);
    hosts.push(host);
    const ready = await host.start();
    const auth = await fetch(ready.url, {redirect: 'manual'});
    const cookie = auth.headers.get('set-cookie')?.split(';')[0];
    await auth.body?.cancel();
    if (auth.status !== 303 || !cookie) throw new Error(`Official Host ${id} authentication failed`);
    projects.push({id, hostUrl: ready.url, cookie, injections: ready.injections,
      partition: `persist:official-project-probe-${id}`, screenshot: join(root, `window-${id}.png`)});
  }
  const preload = join(official, 'apps/desktop/lib/preload-app.cjs');
  const webDist = join(official, 'apps/web/dist');
  if (!existsSync(preload) || !existsSync(join(webDist, 'index.html'))) throw new Error('Build official Desktop and Web first');
  const appDir = join(root, 'app');
  mkdirSync(appDir, {recursive: true});
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({name: 'dsh-official-project-window-probe', version: '0.0.0', type: 'module', main: 'main.mjs'}));
  await build({entryPoints: [fileURLToPath(new URL('./official-electron-window-main.ts', import.meta.url))],
    outfile: join(appDir, 'main.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['electron'], alias: {'@official-web-document': join(official, 'apps/desktop/src/web-document.ts')}});
  const config = {userData: join(root, 'electron'), projects, webDist, preload, result: resultFile};
  const configFile = join(root, 'config.json');
  writeFileSync(configFile, JSON.stringify(config), {mode: 0o600});
  const electron = await import(pathToFileURL(join(official, 'apps/desktop/node_modules/electron/index.js')).href);
  const env = {...process.env, DSH_OFFICIAL_WINDOW_PROBE_CONFIG: configFile};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(electron.default, [appDir], {cwd: root, env, stdio: 'inherit', timeout: 120000});
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Electron project window exited ${String(child.status)}`);
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  if (!result.ok) throw new Error(result.error);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await Promise.allSettled(hosts.map(host => host.stop()));
  if (process.env.DSH_OFFICIAL_PROBE_KEEP === '1') console.error(`Probe files preserved at ${root}`);
  else rmSync(root, {recursive: true, force: true});
}
