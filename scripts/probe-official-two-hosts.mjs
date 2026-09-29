import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const source = process.argv[2];
if (!source || process.argv.length !== 3) throw new Error('Usage: tsx scripts/probe-official-two-hosts.mjs /path/to/deepseek-harness');
const official = resolve(source);
execFileSync(process.execPath, [fileURLToPath(new URL('./verify-official-candidate.mjs', import.meta.url)), official], {stdio: 'inherit'});
const load = name => import(pathToFileURL(join(official, name)).href);
const [{prepareDevelopmentProject}, {DesktopProjectManager}, {resolveDesktopPaths}, {DesktopHostProcess}, {DESKTOP_HOST_PROTOCOL_VERSION}] = await Promise.all([
  load('apps/desktop/scripts/development-project.ts'),
  load('apps/desktop/src/project-manager.ts'),
  load('apps/desktop/src/paths.ts'),
  load('apps/desktop/src/host-process.ts'),
  load('apps/desktop/src/host-protocol.ts'),
]);
const version = JSON.parse(readFileSync(join(official, 'apps/desktop/package.json'), 'utf8')).version;
const pnpmVersion = JSON.parse(readFileSync(join(official, 'apps/desktop/node_modules/pnpm/package.json'), 'utf8')).version;
const root = mkdtempSync(join(tmpdir(), 'dsh-official-two-hosts-'));
const hosts = [];

async function start(name) {
  const base = join(root, name);
  const home = join(base, 'home');
  const runtime = join(base, 'runtime');
  mkdirSync(home, {recursive: true});
  cpSync(join(official, 'packages/skill/skill-office/assets'), join(runtime, 'office-skills'), {recursive: true});
  const nodeBin = join(runtime, 'primary-runtime/dependencies/node/bin');
  mkdirSync(nodeBin, {recursive: true});
  cpSync(process.execPath, join(nodeBin, process.platform === 'win32' ? 'node.exe' : 'node'));
  const project = prepareDevelopmentProject({
    projectDir: join(base, 'project'),
    cliDir: join(official, 'apps/cli'),
    hostDir: join(official, 'apps/desktop-host'),
    dependencyDir: join(official, 'node_modules/.pnpm/node_modules'),
    release: {schemaVersion: 1, version, pnpmVersion, nodeVersion: process.versions.node,
      hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION},
    target: process.platform === 'win32' ? 'win-x64' : process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64',
  });
  const paths = resolveDesktopPaths(home);
  await new DesktopProjectManager(paths, {dsh: project}).applyRelease();
  writeFileSync(join(paths.profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n');
  const environment = {...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED'};
  for (const key of Object.keys(environment)) if (/KEY|TOKEN|SECRET|PASSWORD/u.test(key)) delete environment[key];
  const host = new DesktopHostProcess(process.execPath, project, paths.profile, undefined, environment);
  hosts.push(host);
  const ready = await host.start();
  const authentication = await fetch(ready.url, {redirect: 'manual'});
  const cookie = authentication.headers.get('set-cookie')?.split(';')[0];
  await authentication.body?.cancel();
  if (authentication.status !== 303 || !cookie) throw new Error(`${name}: Host authentication failed`);
  const origin = new URL(ready.url).origin;
  const page = await fetch(new URL('/', origin), {headers: {cookie}});
  const html = await page.text();
  if (page.status !== 200 || !html.includes('<html')) throw new Error(`${name}: Web frontend failed (${page.status})`);
  return {name, origin, cookie, host};
}

try {
  const a = await start('a');
  const b = await start('b');
  if (a.origin === b.origin) throw new Error('Two projects shared a WebServer origin');
  const foreign = await fetch(new URL('/', b.origin), {headers: {cookie: a.cookie}, redirect: 'manual'});
  await foreign.body?.cancel();
  if (foreign.status === 200) throw new Error('Project A cookie accessed Project B');
  await a.host.stop();
  const surviving = await fetch(new URL('/', b.origin), {headers: {cookie: b.cookie}});
  await surviving.body?.cancel();
  if (surviving.status !== 200) throw new Error(`Project B stopped with Project A (${surviving.status})`);
  console.log(JSON.stringify({version, hosts: 2, distinctOrigins: true, crossProjectCookieRejected: true,
    independentShutdown: true, firstOrigin: a.origin, secondOrigin: b.origin}, null, 2));
} finally {
  await Promise.allSettled(hosts.map(host => host.stop()));
  rmSync(root, {recursive: true, force: true});
}
