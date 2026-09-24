import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const modulePath = new URL('../src/app/boot-log.mjs', import.meta.url).href;
const TRACE_KEYS = ['DSH_PROJECT_BOOT_LOG', 'DSH_PROJECT_BOOT_TRACE', 'DSH_PROJECT_BOOT_LOG_BYTES',
  'DSH_PROJECT_BOOT_LOG_FILE', 'DSH_PROJECT_BOOT_SESSION'];

/**
 * The trace resolves its target on every write, so the environment must be set while the
 * module runs. Each case imports a fresh copy: the module keeps the user-data default in
 * module state, and sharing one copy would make the cases order-dependent.
 */
let copies = 0;
async function withBootLog(environment, body) {
  const saved = Object.fromEntries(TRACE_KEYS.map(key => [key, process.env[key]]));
  try {
    copies += 1;
    const module = await import(`${modulePath}?case=${String(copies)}`);
    for (const key of TRACE_KEYS) delete process.env[key];
    Object.assign(process.env, environment);
    return await body(module);
  } finally {
    for (const key of TRACE_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'boot-log-'));
  return {root, userData: join(root, 'user-data'), log: join(root, 'user-data', 'boot.log')};
};

test('a stage records its own cost and the time since the previous stage', async () => {
  const f = fixture();
  try {
    await withBootLog({}, ({bootLogDirectory, session}) => {
      assert.equal(bootLogDirectory(f.userData), f.log);
      const trace = session('boot', 'shell=0.1.8');
      trace.stage('first');
      return new Promise(resolve => setTimeout(resolve, 20)).then(() => {
        trace.stage('second');
        const total = trace.end('done');
        assert.ok(total >= 20, `total should cover the wait, got ${String(total)}`);
        const lines = readFileSync(f.log, 'utf8').trim().split('\n');
        assert.match(lines[0], /=== boot pid \d+ ===$/u);
        assert.match(lines[1], /environment shell=0\.1\.8$/u);
        assert.match(lines[2], /\+ +\d+ms +\d+ms first$/u);
        assert.match(lines[3], /second$/u);
        assert.match(lines[4], /--- boot total \d+ ms --- slowest: second \d+ ms$/u);
      });
    });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('a stage over the slow threshold is marked where a reader cannot miss it', async () => {
  const f = fixture();
  try {
    await withBootLog({}, async ({bootLogDirectory, session}) => {
      bootLogDirectory(f.userData);
      const trace = session('boot');
      trace.stage('quick');
      // Wait past the threshold rather than shrinking it: the constant is part of what this asserts.
      await new Promise(resolve => setTimeout(resolve, 1050));
      trace.stage('slow', 'boot rpc');
      trace.end();
      const text = readFileSync(f.log, 'utf8');
      assert.match(text, /\d+ms slow — boot rpc {2}\[SLOW >1000ms\]/u);
      assert.doesNotMatch(text, /quick.*\[SLOW/u);
    });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('measure reports both a success and the wait that preceded a failure', async () => {
  const f = fixture();
  try {
    await withBootLog({}, async ({bootLogDirectory, session}) => {
      bootLogDirectory(f.userData);
      const trace = session('project/open:demo');
      assert.equal(await trace.measure('materialize', async () => 'ok'), 'ok');
      await assert.rejects(trace.measure('boot rpc', async () => {throw new Error('Host call cancelled or timed out')}),
        /Host call cancelled or timed out/u);
      trace.end();
      const text = readFileSync(f.log, 'utf8');
      assert.match(text, /materialize ok — \d+ ms/u);
      assert.match(text, /boot rpc failed — \d+ ms Host call cancelled or timed out/u);
    });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('the file keeps only the newest launches instead of growing without bound', async () => {
  const f = fixture();
  try {
    await withBootLog({DSH_PROJECT_BOOT_LOG_BYTES: '4096'}, ({bootLogDirectory, session}) => {
      bootLogDirectory(f.userData);
      for (let index = 0; index < 60; index += 1) {
        const trace = session('boot');
        trace.stage(`filler ${String(index)}`, 'x'.repeat(120));
        trace.end();
      }
      const size = statSync(f.log).size;
      assert.ok(size < 8192, `trace should stay near its budget, got ${String(size)} bytes`);
      const text = readFileSync(f.log, 'utf8');
      assert.match(text, /filler 59/u, 'the newest launch must survive');
      assert.doesNotMatch(text, /filler 0 /u, 'the oldest launches must be dropped');
    });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('a failed write never becomes the reason a launch fails', async () => {
  const f = fixture();
  try {
    // A file where the directory must be: mkdirSync fails, and the trace must swallow that.
    mkdirSync(f.root, {recursive: true});
    writeFileSync(join(f.root, 'user-data'), 'not a directory');
    await withBootLog({}, ({bootLogDirectory, session}) => {
      bootLogDirectory(f.userData);
      const trace = session('boot');
      trace.stage('still works');
      assert.equal(typeof trace.end(), 'number');
    });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('an empty DSH_PROJECT_BOOT_LOG disables the trace and a path redirects it', async () => {
  const f = fixture();
  try {
    await withBootLog({DSH_PROJECT_BOOT_LOG: ''}, ({bootLogDirectory, bootLogFile, session}) => {
      assert.equal(bootLogDirectory(f.userData), undefined);
      assert.equal(bootLogFile(), undefined);
      const trace = session('boot');
      trace.stage('discarded');
      trace.end();
      assert.equal(statSync(f.log, {throwIfNoEntry: false}), undefined);
    });

    const elsewhere = join(f.root, 'elsewhere', 'trace.log');
    await withBootLog({DSH_PROJECT_BOOT_LOG: elsewhere}, ({bootLogDirectory, session}) => {
      assert.equal(bootLogDirectory(f.userData), elsewhere);
      const trace = session('boot');
      trace.stage('redirected');
      trace.end();
      assert.match(readFileSync(elsewhere, 'utf8'), /redirected/u);
    });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('the Host continues the session the Shell opened, with its own pid', async () => {
  const f = fixture();
  const hostLog = join(f.root, 'host.log');
  try {
    await withBootLog({DSH_PROJECT_BOOT_LOG_FILE: hostLog, DSH_PROJECT_BOOT_SESSION: 'project/open:demo'},
      ({bootLogDirectory, session, hostTrace}) => {
        // The Host inherits the path; it must not fall back to a user-data directory it does not own.
        assert.equal(bootLogDirectory(f.userData), hostLog);
        const shell = session('project/open:demo');
        shell.stage('host boot rpc requested');
        const host = hostTrace('host-entry');
        host.stage('profile prepared');
        shell.stage('host boot rpc returned');
        shell.end();
        host.end();
        const text = readFileSync(hostLog, 'utf8');
        assert.match(text, /=== project\/open:demo pid \d+ ===/u);
        assert.match(text, /=== project\/open:demo pid \d+ ===\n.* project\/open:demo environment via=host-entry pid=\d+/u);
        assert.match(text, /host boot rpc requested/u);
        assert.match(text, /profile prepared/u);
        assert.match(text, /host boot rpc returned/u);
      });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('without a Host log target the Host writes nothing and invents no path', async () => {
  const f = fixture();
  try {
    await withBootLog({}, ({bootLogDirectory, hostTrace}) => {
      bootLogDirectory(f.userData);
      assert.equal(hostTrace('host-entry'), undefined);
    });
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('a session label is reusable verbatim in a child process environment', async () => {
  await withBootLog({}, ({bootSessionLabel}) => {
    assert.equal(bootSessionLabel('project/open:My Project'), 'project/open:My-Project');
    assert.equal(bootSessionLabel('  '), 'session');
    assert.equal(bootSessionLabel('x'.repeat(200)).length, 80);
  });
});

test('the exported report carries the trace, the sources and every recovery reason', async () => {
  await withBootLog({}, ({renderExportReport}) => {
    const report = renderExportReport({
      trace: '2026-09-23T00:00:00.000Z === boot pid 1 ===\n2026-09-23T00:00:09.000Z +   9000ms   9000ms app.whenReady  [SLOW >1000ms]\n',
      at: '2026-09-23T10:00:00.000Z',
      product: 'DSH Project Desktop 0.1.8',
      platform: 'win32 x64',
      sources: ['launch trace /tmp/boot.log', 'user data /tmp/user-data'],
      projects: [['/tmp/demo.agent-project', {session: 'project/open:demo',
        recoveryEvents: [{at: '2026-09-22T23:00:00.000Z', source: 'startup-restore', requested: false, readOnly: false,
          failureStage: 'host-boot', detail: 'Host exited before becoming ready\nmore detail'}]}]],
    });
    assert.match(report, /startup and project-open log/u);
    assert.match(report, /Exported \/ 导出时间: 2026-09-23T10:00:00\.000Z/u);
    assert.match(report, /- launch trace \/tmp\/boot\.log/u);
    assert.match(report, /\/tmp\/demo\.agent-project — open session project\/open:demo, recovery events 1/u);
    assert.match(report, /"source":"startup-restore"/u);
    assert.match(report, /app\.whenReady {2}\[SLOW >1000ms\]/u);
    assert.match(report, /\[SLOW >1000ms\] are where the time went/u);
    assert.match(report, /export is one export/u);
    assert.match(report, /dsh-diagnostics-\*\.zip/u);
    assert.ok(report.endsWith('\n'), 'the report must end with a newline');
  });
});

test('an export without a trace says so instead of looking empty', async () => {
  await withBootLog({}, ({renderExportReport}) => {
    const report = renderExportReport({at: '2026-09-23T10:00:00.000Z', product: 'p', platform: 'win32 x64'});
    assert.match(report, /No startup trace was recorded/u);
    assert.match(report, /启动日志为空/u);
  });
});

test('a recovery reason is one readable line, with detail on the same line', async () => {
  await withBootLog({}, ({describeRecoveryEvent}) => {
    assert.equal(describeRecoveryEvent({source: 'open', requested: false, readOnly: true, failureStage: 'host-boot',
      detail: 'first line\nsecond line'}), 'source=open requested=false readOnly=true stage=host-boot detail=first line');
    assert.equal(describeRecoveryEvent(), 'source=undefined requested=undefined readOnly=undefined stage=undefined');
  });
});
