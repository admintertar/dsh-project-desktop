/**
 * Prove the Windows reveal adapter is installed in a real Host process.
 *
 * The unit tests cover the adapter's own behaviour; this probe covers the wiring that
 * matters at runtime — that our Host plugin reaches `sessionController` and the adapter is
 * in place before any reveal runs. It boots one isolated project Host with the startup
 * trace pointed at a private file and reads the line the adapter writes there, so the
 * evidence is produced by the same code path a packaged app uses.
 *
 * Evidence: console output only; the trace lives under .runtime/ (never in task artifacts).
 */
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startProjectHost} from '../src/desktop-adapter/index.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {verifyUpstream} from './verify-upstream.mjs';

verifyUpstream();
mkdirSync(join(repository, '.runtime'), {recursive: true});
const root = mkdtempSync(join(repository, '.runtime/reveal-adapter-'));
const trace = join(root, 'boot.log');
// The supervisor forwards its own environment to the Host, which is how the Host plugin
// reaches the same trace file the Shell writes.
process.env.DSH_PROJECT_BOOT_LOG_FILE = trace;
process.env.DSH_PROJECT_BOOT_SESSION = 'probe/reveal-adapter';

const projectRoot = join(root, 'project');
mkdirSync(projectRoot);
writeFileSync(join(projectRoot, 'probe.agent-project'), 'schemaVersion: 1\nid: probe\nname: probe\nresources: []\n');
const host = await startProjectHost({projectRoot, manifestPath: join(projectRoot, 'probe.agent-project'),
  stateDirectory: join(root, 'state')});
await host.close();

const text = readFileSync(trace, 'utf8');
const line = text.split('\n').find(entry => entry.includes('windows reveal adapter'));
assert.ok(line, `the adapter must report itself in the Host trace:\n${text}`);
const expected = process.platform === 'win32' ? 'installed' : 'not applicable on this platform';
assert.ok(line.includes(expected), `expected "${expected}" in: ${line}`);
console.log(`PASS  real Host reports the reveal adapter as ${expected}`);
console.log(`evidence: ${trace}`);
console.log(line);
