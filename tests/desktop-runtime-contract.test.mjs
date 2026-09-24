/**
 * The Shell's hand-written native runtime stands in for the pinned official one, and the pinned
 * Host dispatches several capabilities by method name (`bindNativeRuntime` builds `native:<method>`
 * handlers straight from a literal list). A method that is missing or renamed does not fail at
 * build time: the Host evaluates `runtime[method].apply(runtime, args)` and the user sees
 * "Cannot read properties of undefined (reading 'apply')" from a menu entry — 0.1.9 renamed
 * `exportDiagnostics` to `exportLogs` and did exactly that to the official diagnostics command.
 *
 * These checks make the contract mechanical, so the same rename fails here instead of on a user's
 * machine. They read the pinned sources; `yarn verify:upstream` guarantees those are the pinned bytes.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {isOfficialDiagnosticsTrayItem, OFFICIAL_DIAGNOSTICS_ORDER, OFFICIAL_TOOLS_GROUP} from '../src/desktop-adapter/stable/official-tray.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const desktopSource = join(repository, '.upstream/desktop/dsh-plugin-desktop');
const bridgeSource = readFileSync(join(desktopSource, 'src/host-runtime-bridge.ts'), 'utf8');
const shellSource = readFileSync(join(repository, 'src/desktop-adapter/native.mjs'), 'utf8');

test('the Shell native runtime answers every method the pinned Host dispatches by name', () => {
  const list = /for \(const method of \[([\s\S]*?)\] as const\)/u.exec(bridgeSource);
  assert.ok(list, 'the pinned bridge method list moved; update this check together with it');
  const methods = [...list[1].matchAll(/'([^']+)'/gu)].map(match => match[1]);
  assert.ok(methods.includes('exportDiagnostics'), 'the pinned bridge no longer dispatches exportDiagnostics');
  const runtime = /const runtime = \{([\s\S]*?)\n  \};/u.exec(shellSource);
  assert.ok(runtime, 'the Shell native runtime object was not found');
  for (const method of methods) {
    assert.match(runtime[1], new RegExp(`(^|[\\s{,])${method}\\s*[(:]`, 'mu'),
      `the Shell runtime cannot answer native:${method}, so that official command would fail with undefined.apply`);
  }
});

test('the merged export keeps the official method name instead of inventing a second one', () => {
  assert.match(shellSource, /async exportDiagnostics\(\)/u);
  assert.doesNotMatch(shellSource, /async exportLogs\(\)/u);
});

test('the recognised contribution still matches the pinned official diagnostics plugin', () => {
  const plugin = readFileSync(join(desktopSource, 'src/diagnostics.ts'), 'utf8');
  assert.match(plugin, new RegExp(`group: '${OFFICIAL_TOOLS_GROUP}'`, 'u'), 'the official diagnostics group changed');
  assert.match(plugin, new RegExp(`order: ${String(OFFICIAL_DIAGNOSTICS_ORDER)}`, 'u'), 'the official diagnostics order changed');
});

const labels = new Set(['Export Diagnostics…', '导出诊断信息…']);
const contribution = extra => ({group: 'tools', order: 20, label: () => '导出诊断信息…', ...extra});

test('the official diagnostics contribution is dropped only when group, order and label agree', () => {
  assert.equal(isOfficialDiagnosticsTrayItem(contribution(), labels), true);
  assert.equal(isOfficialDiagnosticsTrayItem(contribution({group: 'window'}), labels), false);
  assert.equal(isOfficialDiagnosticsTrayItem(contribution({order: 10}), labels), false);
  assert.equal(isOfficialDiagnosticsTrayItem(contribution({label: () => '打开 DSH 终端'}), labels), false);
  assert.equal(isOfficialDiagnosticsTrayItem(contribution({label: () => 'Export Diagnostics…'}), labels), true);
});

test('an unknown or broken contribution is always kept rather than silently removed', () => {
  assert.equal(isOfficialDiagnosticsTrayItem(undefined, labels), false);
  assert.equal(isOfficialDiagnosticsTrayItem({group: 'tools', order: 20}, labels), false);
  assert.equal(isOfficialDiagnosticsTrayItem(contribution({label: () => {throw new Error('locale unavailable')}}), labels), false);
});
