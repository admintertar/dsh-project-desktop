/**
 * Startup and project-open timing, written where the person who feels the delay can read it.
 *
 * Why this exists: the shell already reports failures ("DSH Host call cancelled or
 * timed out"), and offline probes measure boot stages on a developer machine, but neither
 * answers the only question a slow launch raises on someone else's machine — which stage
 * ate the time. Every stage here is a synchronous timestamp and one appended line, so the
 * trace costs microseconds and stays on during normal use instead of being a switch that
 * must be turned on before the interesting launch happens.
 *
 * Written to `<userData>/boot.log`, always. `DSH_PROJECT_BOOT_LOG` names a different file
 * (empty string disables the trace), `DSH_PROJECT_BOOT_TRACE=1` additionally prints the
 * same lines to stdout, and `DSH_PROJECT_BOOT_LOG_BYTES` changes the retention budget.
 *
 * A trace is an explicit object, not a module-global "current session": one launch opens
 * several projects, and those traces interleave. Pass the trace down; never infer whose
 * stage a call belongs to.
 */
import {appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

/** Retention: the newest launches win. A trace is only useful if it cannot grow without bound. */
export const DEFAULT_TRACE_BYTES = 256 * 1024;
/** One stage this slow is worth naming in the log itself, not only in a summary a human has to read. */
export const SLOW_STAGE_MS = 1000;

let defaultFile;
let defaultLimit = DEFAULT_TRACE_BYTES;
let echo = false;

const integer = (value, fallback, minimum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
};

const stamp = at => new Date(at).toISOString();

/**
 * The trace target is resolved on every write, never cached: the Shell and a Host it forks
 * can both decide where the trace goes, and a path remembered from an earlier decision is
 * how a trace silently lands in the wrong directory. `DSH_PROJECT_BOOT_LOG_FILE` is what the
 * supervisor hands a Host, which must not resolve a user-data directory of its own.
 */
function target() {
  const configured = process.env.DSH_PROJECT_BOOT_LOG;
  if (configured === '') return undefined;
  return configured || process.env.DSH_PROJECT_BOOT_LOG_FILE || defaultFile;
}

function retention() {
  return integer(process.env.DSH_PROJECT_BOOT_LOG_BYTES, defaultLimit, 1024);
}

/**
 * Point the trace at this launch's user-data directory. Called once, as early as the
 * user-data path exists; an explicit `DSH_PROJECT_BOOT_LOG` still wins over it.
 */
export function bootLogDirectory(userData) {
  defaultFile = join(userData, 'boot.log');
  defaultLimit = DEFAULT_TRACE_BYTES;
  echo = process.env.DSH_PROJECT_BOOT_TRACE === '1';
  return target();
}

/** Where this launch's trace lives, for the diagnostics export to hand to the operator. */
export function bootLogFile() {
  return target();
}

/** A session label the Host process can reuse verbatim through its environment. */
export function bootSessionLabel(name) {
  // Keep the separator characters a label needs and drop everything else, so the value is
  // safe both as a log token and as an environment variable a child reads back verbatim.
  // The trailing '-' is escaped on purpose: inside a class, `:-` would read as a range.
  const cleaned = String(name).replace(/\s+/gu, '-').replace(/[^\w./:\-]+/gu, '').replace(/^-+|-+$/gu, '').slice(0, 80);
  return cleaned || 'session';
}

/**
 * Render the exported report: what produced it, where the evidence came from, the trace
 * itself, and how to read it. Pure so the export format is testable without Electron.
 */
export function renderExportReport({trace, sources = [], projects = [], at, product, platform}) {
  const missing = trace ?? 'No startup trace was recorded / 启动日志为空（DSH_PROJECT_BOOT_LOG）';
  const projectLines = projects.map(([path, entry]) => {
    const events = entry.recoveryEvents ?? [];
    return `${path} — open session ${entry.session ?? 'unknown'}, recovery events ${String(events.length)}`;
  });
  const eventLines = projects.flatMap(([, entry]) => entry.recoveryEvents ?? [])
    .map(event => `  ${String(event.at ?? '')} ${JSON.stringify(event)}`);
  return `${[
    `${product} — 启动与打开项目日志 / startup and project-open log`,
    `Exported / 导出时间: ${at}`,
    `Platform / 平台: ${platform}`,
    'Sources / 数据来源:',
    ...sources.map(source => `  - ${source}`),
    ...projectLines.map(line => `  - ${line}`),
    ...eventLines,
    '',
    '--- 启动与打开项目日志（旧 → 新） / startup and project-open trace (oldest → newest) ---',
    missing,
    '',
    '--- 说明 / Notes ---',
    '每个 === name === 是一次追踪：boot 是本次启动，project/open:<项目> 是打开一个项目，export 是一次导出。',
    'Each === name === line is one trace: boot is this launch, project/open:<project> is one open, export is one export.',
    '每行的 +xms 是相对该次追踪开始的偏移，其后的数字是该阶段自身的耗时。',
    'In each line, +xms is the offset from that trace start and the number after it is the stage cost.',
    '标有 [SLOW >1000ms] 的阶段是延迟来源；Host 进程的阶段同样写进同一段追踪。',
    'Stages marked [SLOW >1000ms] are where the time went; Host-process stages land in the same trace.',
    '同目录的 dsh-diagnostics-*.zip 是项目自己的官方诊断包。',
    'The dsh-diagnostics-*.zip beside this report is the project official diagnostics archive.',
  ].join('\n')}\n`;
}

/** One line per Recovery Mode reason, shared by the launch trace and the exported report. */
export function describeRecoveryEvent(event = {}) {
  const detail = typeof event.detail === 'string' && event.detail ? event.detail.split('\n')[0].slice(0, 300) : '';
  return `source=${String(event.source)} requested=${String(event.requested)} `
    + `readOnly=${String(event.readOnly)} stage=${String(event.failureStage)}${detail ? ` detail=${detail}` : ''}`;
}

/**
 * Trace one project open from a Host process.
 *
 * The Host is where the expensive half of an open happens — the first Profile preparation
 * runs a pnpm install the pinned materializer allows 120s for — so the supervisor passes
 * its log path and session label down through the child environment and the Host appends to
 * the same session the Shell opened. Without this the Shell can only say "the boot RPC took
 * 25s", which is not a diagnosis.
 */
export function hostTrace(prefixed) {
  const log = process.env.DSH_PROJECT_BOOT_LOG_FILE;
  if (!log) return undefined;
  return session(process.env.DSH_PROJECT_BOOT_SESSION ?? 'host', `via=${prefixed} pid=${String(process.pid)}`);
}

/**
 * Begin a named trace. `boot` covers one launch and `project/<name>` one project open; the
 * `boot` trace also records the build that produced the numbers, because a timing report
 * without its build cannot be compared with anyone else's.
 */
export function session(label, identity) {
  const name = String(label).replace(/\s+/gu, '-').slice(0, 80) || 'session';
  const started = Date.now();
  let previous = started;
  let finished = false;
  let slowest;
  const stages = [];
  write(`${stamp(started)} === ${name} pid ${String(process.pid)} ===`);
  if (identity) write(`${stamp(started)} ${name} environment ${identity}`);
  const record = (label, detail, at) => {
    if (finished) return undefined;
    const ms = at - previous;
    previous = at;
    const text = detail === undefined ? undefined : String(detail).replace(/\s+/gu, ' ').slice(0, 400);
    const entry = {label: String(label), ms};
    stages.push(entry);
    if (!slowest || ms > slowest.ms) slowest = entry;
    write(`${stamp(at)} +${String(at - started).padStart(7)}ms ${String(ms).padStart(6)}ms ${String(label)}`
      + `${text ? ` — ${text}` : ''}${ms >= SLOW_STAGE_MS ? `  [SLOW >${String(SLOW_STAGE_MS)}ms]` : ''}`);
    return ms;
  };
  return {
    name,
    /** Close one stage: it reports its own cost and the time since the previous stage. */
    stage(label, detail) {
      return record(label, detail, Date.now());
    },
    /** Note something inside the current stage without splitting it. */
    event(label, detail) {
      return record(label, detail, Date.now());
    },
    /** Time an action and report its outcome, so a failure shows the wait that preceded it. */
    async measure(label, action) {
      const at = Date.now();
      try {
        const value = await action();
        record(`${label} ok`, `${String(Date.now() - at)} ms`, Date.now());
        return value;
      } catch (error) {
        record(`${label} failed`, `${String(Date.now() - at)} ms ${error?.message ?? String(error)}`, Date.now());
        throw error;
      }
    },
    end(detail) {
      if (finished) return undefined;
      finished = true;
      const at = Date.now();
      record('end', detail, at);
      write(`${stamp(at)} --- ${name} total ${String(at - started)} ms ---`
        + (slowest ? ` slowest: ${slowest.label} ${String(slowest.ms)} ms` : ''));
      return at - started;
    },
  };
}

/** Append, then keep only the newest bytes so one file serves every launch. */
function write(value) {
  const line = `${value}\n`;
  if (process.env.DSH_PROJECT_BOOT_TRACE === '1' || echo) process.stdout.write(`[boot] ${line}`);
  const file = target();
  if (!file) return;
  const limit = retention();
  try {
    mkdirSync(dirname(file), {recursive: true});
    if (statSync(file, {throwIfNoEntry: false})?.size >= limit) {
      const kept = readFileSync(file).subarray(-Math.floor(limit / 2)).toString('utf8');
      const boundary = kept.indexOf('\n');
      writeFileSync(file, boundary === -1 ? '' : kept.slice(boundary + 1));
    }
    appendFileSync(file, line);
  } catch {
    // A trace must never be the reason a launch fails: an unreadable log directory only
    // means this launch is not recorded.
  }
}
