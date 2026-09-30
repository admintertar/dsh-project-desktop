import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  RECOVERY_JOURNAL_FILENAME, readRecoveryEvents, recordRecoveryEvent, recoveryJournalPath,
} from '../src/app/recovery-journal.mjs';

test('a Recovery Mode reason survives the window that displayed it', () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-journal-test-'));
  try {
    const state = join(root, 'state');
    const written = recordRecoveryEvent(state, {source: 'startup-restore', requested: false,
      failureStage: 'host-boot', detail: 'Previous project startup failed', phase: 'failed'},
    {now: () => new Date('2026-09-22T12:24:57.000Z'), pid: 4242});
    assert.equal(written.schemaVersion, 1);
    assert.equal(written.at, '2026-09-22T12:24:57.000Z');
    assert.equal(written.pid, 4242);
    assert.equal(recoveryJournalPath(state), join(state, RECOVERY_JOURNAL_FILENAME));
    assert.deepEqual(readRecoveryEvents(state), [written]);
  } finally {rmSync(root, {recursive: true, force: true})}
});

test('the journal keeps the newest reasons and stays bounded', () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-journal-bound-'));
  try {
    const state = join(root, 'state');
    const maxBytes = 400, maxRecords = 3;
    const now = () => new Date('2026-09-22T12:24:57.000Z');
    for (const seq of [1, 2, 3, 4, 5, 6]) {
      recordRecoveryEvent(state, {seq, detail: 'x'.repeat(40)}, {maxBytes, maxRecords, now, pid: 1});
    }
    const lines = readFileSync(recoveryJournalPath(state), 'utf8').trim().split('\n');
    assert.ok(lines.length <= maxRecords + 1, `kept ${String(lines.length)} records`);
    assert.ok(statSync(recoveryJournalPath(state)).size
      < maxBytes + Buffer.byteLength(lines.at(-1)) + 1, 'the file never exceeds the cap plus one record');
    const events = readRecoveryEvents(state, {limit: 10});
    assert.equal(events.at(-1).seq, 6, 'the newest reason is kept');
    assert.ok(events.at(0).seq > 1, 'the oldest reasons are compacted away');
    assert.equal(events.length, lines.length);
  } finally {rmSync(root, {recursive: true, force: true})}
});

test('an unwritable journal never blocks recovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-journal-blocked-'));
  try {
    const blocker = join(root, 'blocked');
    writeFileSync(blocker, 'not a directory');
    const state = join(blocker, 'state');
    assert.equal(recordRecoveryEvent(state, {source: 'open', detail: 'boom'}), undefined);
    assert.deepEqual(readRecoveryEvents(state), []);
    assert.equal(readFileSync(blocker, 'utf8'), 'not a directory');
  } finally {rmSync(root, {recursive: true, force: true})}
});

test('unreadable lines are skipped instead of poisoning the journal', () => {
  const root = mkdtempSync(join(tmpdir(), 'recovery-journal-damaged-'));
  try {
    const state = join(root, 'state');
    recordRecoveryEvent(state, {seq: 1}, {pid: 1});
    writeFileSync(recoveryJournalPath(state), `not json\n${readFileSync(recoveryJournalPath(state), 'utf8')}`);
    assert.deepEqual(readRecoveryEvents(state).map(event => event.seq), [1]);
  } finally {rmSync(root, {recursive: true, force: true})}
});

// main.mjs is the Electron entry: no unit test can import it, so guard the wiring in source.
test('the shell records the reason before the official recovery assistant can be dismissed', () => {
  const source = readFileSync(new URL('../src/app/main.mjs', import.meta.url), 'utf8');
  const recorded = source.indexOf('recordRecoveryEvent(state.stateDirectory');
  assert.notEqual(recorded, -1, 'the recovery reason must be written to the project state directory');
  assert.ok(recorded < source.indexOf('createProjectNativeWindow({...state'),
    'the reason must be on disk before the window that displayed it exists');
  for (const entry of ['startup-restore', 'open', 'restart', 'runtime', 'safe-mode', 'safe-mode-exit']) {
    assert.ok(source.includes(`source: '${entry}'`), `recovery entry ${entry} must name its source`);
  }
});
