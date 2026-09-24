/**
 * Which entry inside the official plugin tree cost the time.
 *
 * `official host booted` names one stage that contains the whole official plugin tree and the
 * loopback renderer server, because the official `boot()` owns that work and reports nothing
 * inside it: a 28 s Windows boot and a 3 s macOS boot read identically in the trace. This
 * tracker listens to the Loader's own lifecycle events and reports the slowest entries beside
 * that stage. It only summarises — the tree's own total stays with the stage that measures it.
 *
 * Cordis announces a transition as `internal/status(fiber, oldValue)` on the fiber's own
 * context, which reaches a listener registered on the root context. `FiberState`
 * (vendor/cordis/src/fiber.ts) is a `const enum`, so the compiler inlines it and no runtime
 * export exists to import: the values this tracker reads are pinned here, and any other state
 * is ignored rather than guessed, which is what makes a future enum change harmless instead of
 * wrong.
 */
import {SLOW_STAGE_MS} from '../../app/boot-log.mjs';

const LOADING = 1;
const ACTIVE = 2;
const FAILED = 3;

/**
 * Follow how long each Loader entry took to load.
 *
 * @param ctx - the boot context, after the Loader is installed and before the tree mounts.
 * @param options.now - clock, injected so a test can advance time without waiting.
 * @param options.maximum - how many entries a report names, slowest first.
 * @returns the loads seen so far as `report()`, in the order a trace wants them.
 */
export function trackPluginLoads(ctx, {now = Date.now, maximum = 5} = {}) {
  const loading = new Map();
  const loads = [];
  let failed = 0;
  ctx.on('internal/status', fiber => {
    // Only Loader entries carry a plugin name; transient child fibers inside a plugin are not
    // a stage of the tree and would only add noise.
    const name = fiber?.entry?.options?.name;
    if (typeof name !== 'string' || name === '') return;
    if (fiber.state === LOADING) {
      if (!loading.has(fiber)) loading.set(fiber, now());
      return;
    }
    const at = loading.get(fiber);
    if (at === undefined) return;
    loading.delete(fiber);
    if (fiber.state === ACTIVE) loads.push({name, ms: now() - at});
    else if (fiber.state === FAILED) failed += 1;
    // A teardown after a load (DISPOSED, UNLOADING) is not a duration worth reporting.
  });
  return {
    /** `loaded` counts entries that finished loading; `slowest` ranks at most `maximum` of them. */
    report() {
      const slowest = [...loads].sort((a, b) => b.ms - a.ms).slice(0, maximum);
      return {loaded: loads.length, failed, slowest};
    },
  };
}

/**
 * Write a load report into a trace: one line for the tree, then one naming the entries slow
 * enough to be worth a second look. Written after `official host booted` so that stage keeps
 * the wait it has always reported.
 *
 * @param trace - the project-open trace, or `undefined` when tracing is off.
 * @param report - what `trackPluginLoads().report()` returned, or `undefined` if the tree never mounted.
 */
export function reportPluginLoads(trace, report) {
  if (!trace || !report) return;
  const [slowest] = report.slowest;
  trace.stage('official plugin tree settled', `loaded=${String(report.loaded)}`
    + (report.failed > 0 ? ` failed=${String(report.failed)}` : '')
    + (slowest ? ` slowest=${slowest.name} ${String(slowest.ms)} ms` : ''));
  const named = report.slowest.filter(load => load.ms >= SLOW_STAGE_MS);
  if (named.length > 0) {
    trace.event(`official plugin loads over ${String(SLOW_STAGE_MS)}ms`,
      named.map(load => `${load.name} ${String(load.ms)}ms`).join(', '));
  }
}