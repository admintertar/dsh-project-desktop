/**
 * Attribute "opening a project" latency to a stage, on the machine that runs it.
 *
 * The shell reports the official HostRpc reject "DSH Host call cancelled or
 * timed out" at the 'host-boot' stage when the boot RPC exceeds its budget, and
 * that message cannot distinguish a slow start from a cancelled one. Guessing
 * which stage is slow is not diagnosis, so this probe measures the stages that
 * can be slow, in order:
 *
 *   1. Host entry cold start - fork, module graph, the {ready:true} handshake
 *   2. Profile preparation  - the first pass runs the one-time pnpm install
 *   3. Full Host boot       - profile, official plugin tree, loopback web server
 *
 * Every stage is sampled twice (the first sample is cold for the OS file cache)
 * and in two locations: inside the repository and inside the real user-data
 * root (%APPDATA% / Application Support / XDG data), because a roaming or
 * redirected user profile is one of the candidate causes.
 *
 * Results: .runtime/host-boot-timing/result.json and summary.md. Set
 * DSH_BOOT_PROBE_SAMPLES to widen the sample count.
 */
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {arch, cpus, homedir, platform, release, totalmem} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {verifyRuntimeDependencies} from '../src/desktop-adapter/stable/verify.mjs';
import {prepareProjectProfile} from '../src/desktop-adapter/stable/profile.mjs';
import {startProjectHost} from '../src/desktop-adapter/index.mjs';

const HOST_ENTRY = fileURLToPath(new URL('../src/desktop-adapter/stable/host-entry.mjs', import.meta.url));
const EVIDENCE_DIRECTORY = join(repository, '.runtime/host-boot-timing');
const SAMPLES = Number(process.env.DSH_BOOT_PROBE_SAMPLES ?? 2);

const now = () => Date.now();

async function timed(action) {
  const started = now();
  try {
    const value = await action();
    return {ms: now() - started, value};
  } catch (error) {
    return {ms: now() - started, error: error?.message ?? String(error)};
  }
}

function createProject(root, name) {
  const projectRoot = join(root, name);
  mkdirSync(projectRoot, {recursive: true});
  const manifestPath = join(projectRoot, `${name}.agent-project`);
  writeFileSync(manifestPath, `schemaVersion: 1\nid: ${name}\nname: ${name}\nresources: []\n`);
  return {projectRoot, manifestPath, name};
}

/**
 * Fork the Host entry exactly as the supervisor does (same entry, same IPC) and
 * wait for its {ready:true}. This is the module-graph cost behind
 * HOST_READY_TIMEOUT_MS, isolated from any boot work.
 */
async function awaitHostReady(homeDirectory) {
  mkdirSync(homeDirectory, {recursive: true});
  const child = fork(HOST_ENTRY, [], {
    cwd: repository, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {...process.env, DSH_HOME: homeDirectory},
  });
  let stderr = '';
  child.stderr?.on('data', chunk => {stderr = (stderr + String(chunk)).slice(-2000)});
  const exited = once(child, 'exit').then(([code]) => {
    throw new Error(`Host entry exited before ready (code ${String(code)})`);
  });
  exited.catch(() => {});
  try {
    const [message] = await Promise.race([once(child, 'message'), exited]);
    if (!message?.ready) throw new Error('Host entry did not report ready');
    return stderr || undefined;
  } finally {
    child.kill();
  }
}

/** The location a packaged app would actually use for its per-project state. */
function userDataBase() {
  if (platform() === 'win32' && process.env.APPDATA) return process.env.APPDATA;
  if (platform() === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_DATA_HOME && process.env.XDG_DATA_HOME.length > 0
    ? process.env.XDG_DATA_HOME
    : join(homedir(), '.local', 'share');
}

/** The budget the shell actually ships, read from source so the report is self-explaining. */
function bootBudgetFromSource() {
  try {
    const source = readFileSync(join(repository, 'src/desktop-adapter/index.mjs'), 'utf8');
    const match = /HOST_BOOT_TIMEOUT_MS\s*=\s*([\d_]+)\s*;/.exec(source);
    return match ? Number(match[1].replaceAll('_', '')) : undefined;
  } catch {
    return undefined;
  }
}

function listLogs(stateDirectory) {
  const directory = join(stateDirectory, 'logs');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).map(name => {
    const path = join(directory, name);
    try {
      return {name, bytes: statSync(path).size};
    } catch {
      return {name};
    }
  });
}

async function measureLocation(label, baseDirectory) {
  const result = {label, baseDirectory, samples: {hostReady: [], prepareProfile: [], boot: [], close: []}};
  try {
    mkdirSync(baseDirectory, {recursive: true});
    result.root = mkdtempSync(join(baseDirectory, 'dsh-boot-probe-'));
    const root = result.root;

    for (let index = 1; index <= SAMPLES; index += 1) {
      result.samples.hostReady.push(await timed(() => awaitHostReady(join(root, `ready-${index}`, 'dsh'))));
    }

    const profileProject = createProject(root, 'profile-probe');
    const profileState = join(root, 'profile-state');
    for (let index = 1; index <= SAMPLES; index += 1) {
      result.samples.prepareProfile.push(await timed(async () => {
        const launch = await prepareProjectProfile(profileProject.manifestPath, profileState, {});
        return launch.profileDir;
      }));
    }

    const bootProject = createProject(root, 'boot-probe');
    const bootState = join(root, 'boot-state');
    for (let index = 1; index <= SAMPLES; index += 1) {
      const sample = await timed(() => startProjectHost({manifestPath: bootProject.manifestPath,
        projectRoot: bootProject.projectRoot, stateDirectory: bootState}));
      result.samples.boot.push({ms: sample.ms, error: sample.error,
        port: sample.value ? new URL(sample.value.url).port : undefined});
      if (sample.value) result.samples.close.push(await timed(() => sample.value.close()));
    }
    result.logs = listLogs(bootState);
  } catch (error) {
    result.fatal = error?.message ?? String(error);
  }
  return result;
}

function environment() {
  const memory = totalmem();
  return {
    platform: platform(), release: release(), arch: arch(),
    cpus: cpus().length,
    memoryGb: Math.round((memory / 1024 ** 3) * 10) / 10,
    node: process.version,
    repository,
    userDataBase: userDataBase(),
    temporaryDirectory: process.env.TEMP ?? process.env.TMP ?? undefined,
  };
}

function renderTable(location) {
  const rows = [];
  const push = (name, sample) => rows.push([name, sample?.ms === undefined ? 'n/a' : `${String(sample.ms)} ms`,
    sample?.error ? `error: ${sample.error}` : '']);
  location.samples.hostReady.forEach((sample, index) => push(`hostReady #${String(index + 1)}`, sample));
  location.samples.prepareProfile.forEach((sample, index) => push(`prepareProfile #${String(index + 1)}`, sample));
  location.samples.boot.forEach((sample, index) => push(`boot #${String(index + 1)}`, sample));
  location.samples.close.forEach((sample, index) => push(`close #${String(index + 1)}`, sample));
  const lines = ['| stage | duration | note |', '| --- | --- | --- |', ...rows.map(row => `| ${row.join(' | ')} |`)];
  if (location.fatal) lines.push('', `fatal: ${location.fatal}`);
  if (location.logs?.length) lines.push('', `Host logs: ${location.logs.map(entry => `${entry.name} (${String(entry.bytes ?? '?')} B)`).join(', ')}`);
  return lines.join('\n');
}

function renderMarkdown(report) {
  const lines = [
    '# Project boot timing probe',
    '',
    `Generated: ${report.generatedAt}`,
    `Boot budget in source: ${report.bootBudgetMs === undefined ? 'unknown' : `${String(report.bootBudgetMs)} ms`}`,
    `Samples per stage: ${String(report.samples)}`,
    '',
    '| environment | value |', '| --- | --- |',
    ...Object.entries(report.environment).map(([key, value]) => `| ${key} | ${String(value)} |`),
  ];
  for (const location of report.locations) {
    lines.push('', `## location: ${location.label}`, '', `Base: ${location.baseDirectory}`, '', renderTable(location));
  }
  return `${lines.join('\n')}\n`;
}

verifyRuntimeDependencies();
mkdirSync(EVIDENCE_DIRECTORY, {recursive: true});

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  samples: SAMPLES,
  bootBudgetMs: bootBudgetFromSource(),
  environment: environment(),
  locations: [],
};

for (const location of [{label: 'repository', base: join(repository, '.runtime')}, {label: 'user-data', base: userDataBase()}]) {
  const measured = await measureLocation(location.label, location.base);
  report.locations.push(measured);
  // Keep the repository copy for debugging; the user-data copy is disposable.
  if (location.label !== 'repository' && measured.root) {
    try {rmSync(measured.root, {recursive: true, force: true})} catch { /* best effort */ }
  }
}

writeFileSync(join(EVIDENCE_DIRECTORY, 'result.json'), `${JSON.stringify(report, undefined, 2)}\n`);
const markdown = renderMarkdown(report);
writeFileSync(join(EVIDENCE_DIRECTORY, 'summary.md'), markdown);
console.log(markdown);