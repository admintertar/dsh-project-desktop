import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

/**
 * Shell-owned, append-only record of why Recovery Mode opened.
 *
 * The official Recovery Assistant receives that reason as a base64url window
 * query parameter only, so a dismissed window leaves no evidence: the Host log
 * starts after recovery (the failing step is before the Host is forked) and the
 * shell keeps no main-process log at all. This journal is the durable copy and
 * lives beside the project's Host logs.
 */
export const RECOVERY_JOURNAL_FILENAME = 'recovery-events.jsonl';
export const RECOVERY_JOURNAL_MAX_BYTES = 256 * 1024;
export const RECOVERY_JOURNAL_MAX_RECORDS = 50;

export function recoveryJournalPath(stateDirectory) {
  return join(stateDirectory, RECOVERY_JOURNAL_FILENAME);
}

/** Oldest first. Unreadable lines are skipped; reading never throws for missing state. */
export function readRecoveryEvents(stateDirectory, {limit = RECOVERY_JOURNAL_MAX_RECORDS} = {}) {
  const file = recoveryJournalPath(stateDirectory);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-limit).flatMap(line => {
    try {return [JSON.parse(line)]} catch {return []}
  });
}

function compact(file, {maxBytes, maxRecords}) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const kept = [];
  let bytes = 0;
  for (let index = lines.length - 1; index >= 0 && kept.length < maxRecords; index -= 1) {
    const size = Buffer.byteLength(lines[index]) + 1;
    // The newest reason is always kept, even when a single record exceeds the byte budget.
    if (kept.length && bytes + size > maxBytes) break;
    kept.unshift(lines[index]); bytes += size;
  }
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, kept.length ? `${kept.join('\n')}\n` : '', {mode: 0o600});
  renameSync(temporary, file);
}

/**
 * Record one Recovery Mode reason. Returns the written record, or undefined when
 * the journal is unwritable: diagnosis must never block recovery itself.
 */
export function recordRecoveryEvent(stateDirectory, event, {now = () => new Date(), pid = process.pid,
  maxBytes = RECOVERY_JOURNAL_MAX_BYTES, maxRecords = RECOVERY_JOURNAL_MAX_RECORDS} = {}) {
  const record = {schemaVersion: 1, at: now().toISOString(), pid, ...event};
  const file = recoveryJournalPath(stateDirectory);
  try {
    mkdirSync(dirname(file), {recursive: true, mode: 0o700});
    if (existsSync(file) && statSync(file).size > maxBytes) compact(file, {maxBytes, maxRecords});
    appendFileSync(file, `${JSON.stringify(record)}\n`, {mode: 0o600});
    return record;
  } catch {return undefined}
}
