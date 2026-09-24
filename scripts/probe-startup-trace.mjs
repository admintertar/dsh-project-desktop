/**
 * Verify that a real launch and a real project open leave a usable trace.
 *
 * The trace only proves its worth when a genuine Electron launch through the real Host
 * supervisor writes it, so this probe runs the native smoke case with `DSH_PROJECT_BOOT_TRACE`
 * on and then checks the file: a launch trace, a project-open trace, the Host-process stages
 * inside it and at least one stage marked slow enough to be worth naming.
 *
 * Usage: yarn probe:startup-trace [label]   (label keeps a run easy to find again)
 * Evidence: .runtime/startup-trace-<stamp>-<label>/boot.log
 */
import {mkdtempSync, mkdirSync, readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {smokeEnvironment} from './smoke-environment.mjs';

const label = (process.argv[2] ?? 'run').replace(/[^\w-]+/gu, '-').slice(0, 40);
const stamp = new Date().toISOString().replace(/[:.]/gu, '-');
const base = join(repository, '.runtime');
mkdirSync(base, {recursive: true});
const root = mkdtempSync(join(base, `startup-trace-${stamp}-${label}-`));
const log = join(root, 'boot.log');

const child = spawn(desktopRequire('electron'), [repository, '--native-smoke'], {
  env: smokeEnvironment({DSH_PROJECT_DESKTOP_SMOKE_DATA: root, DSH_PROJECT_BOOT_TRACE: '1'}),
  stdio: 'inherit',
});
child.on('error', error => {console.error(error); process.exitCode = 1});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? 1;
  if (!existsSync(log)) {
    console.error(`FAIL: no trace was written to ${log}`);
    process.exitCode = 1;
    return;
  }
  const text = readFileSync(log, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const sessions = lines.filter(line => line.includes(' === ')).map(line => line.replace(/^.* === /u, '').replace(/ ===$/u, ''));
  const checks = [
    ['launch trace', sessions.some(name => name.startsWith('boot '))],
    ['project-open trace', sessions.some(name => name.startsWith('project/open'))],
    ['host-process stages', /environment via=host-entry/u.test(text)],
    ['electron-ready stage', /app\.whenReady$/mu.test(text)],
    ['project file resolved stage', /project file resolved/u.test(text)],
    ['host boot rpc stage', /host boot rpc requested/u.test(text)],
    ['host boot sub-stages', /official loader mounted/u.test(text) && /official plugin tree settled/u.test(text)],
    ['slow stage marked', /\[SLOW >\d+ms\]/u.test(text)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`\n--- boot.log (${String(lines.length)} lines) ---`);
  console.log(text.trimEnd());
  console.log(`\nevidence: ${log}`);
  // The smoke case's own exit code is reported separately on purpose: a fixture-cleanup failure
  // (Windows EPERM on a temp directory) says nothing about whether the trace was written, and
  // conflating the two would make this probe fail for a reason that is not its subject.
  console.log(`native smoke case exit code: ${String(code)} signal: ${String(signal)} (independent of the trace checks above)`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
});
