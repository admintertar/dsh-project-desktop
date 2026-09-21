import {randomUUID} from 'node:crypto';

// The Host gives one clone job at a time its own 30-minute budget; a job that outlives that
// window is stuck rather than slow, so this settle loop stops waiting with it.
const SETTLE_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 2000;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * A fresh checkout carries no `resources/` directory at all: the project definition excludes
 * every resource repository from the parent Git tree, so a new machine sees them as missing.
 * Only a declared Git resource with a remote address, a missing directory and no clone job of
 * its own may be rebuilt automatically. A machine-local binding or an external directory is a
 * user decision, and a previous failed job is the Plugin's to retry from its own panel.
 */
export function pendingResourceRestores(snapshot) {
  const operations = Array.isArray(snapshot?.operations) ? snapshot.operations : [];
  return (Array.isArray(snapshot?.resources) ? snapshot.resources : []).filter(item =>
    item?.type === 'git' && item.status === 'missing' && !item.bound && !item.external
    && typeof item.url === 'string' && item.url !== ''
    && typeof item.declaredPath === 'string' && item.declaredPath !== ''
    && !operations.some(operation => operation?.resourceId === item.id))
    .map(item => ({id: item.id, name: item.name, url: item.url, path: item.declaredPath,
      ...(typeof item.branch === 'string' && item.branch ? {branch: item.branch} : {})}));
}

async function read(host, path, init) {
  const response = await host.request(path, init);
  if (!response.ok) throw new Error(`Resource API ${path} answered ${response.status}`);
  return response.json();
}

function submit(host, path, body) {
  return read(host, path, {method: 'POST',
    headers: {'content-type': 'application/json', origin: new URL(host.url).origin},
    body: JSON.stringify(body)});
}

/**
 * Rebuild the missing resource directories of one already-open project. Opening must never
 * wait for a clone, so callers run this in the background: the project stays usable, the
 * Plugin's own panel shows progress, and a failure is only reported, never fatal.
 */
export async function restoreMissingResources(host, options = {}) {
  const {onError = () => {}, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
    settleTimeoutMs = SETTLE_TIMEOUT_MS} = options;
  const restored = [];
  const failed = [];
  try {
    for (;;) {
      const snapshot = await read(host, '/api/project/resources');
      const [item] = pendingResourceRestores(snapshot);
      // Without Git there is nothing to clone; the panel reports that reason itself.
      if (!item || snapshot.canClone !== true) break;
      let operation;
      try {operation = (await submit(host, '/api/project/resources/clone',
        {requestId: randomUUID(), expectedRevision: snapshot.revision, ...item})).operation}
      catch (error) {failed.push({id: item.id, error: error.message}); onError(error); break}
      if (!operation?.id) {
        const error = new Error(`Resource clone for ${item.id} started no job`);
        failed.push({id: item.id, error: error.message}); onError(error); break;
      }
      const settled = await settle(host, operation.id, {delay, timeoutMs: settleTimeoutMs});
      if (settled?.status === 'completed') {restored.push(item.id); continue}
      const error = new Error(`Resource clone for ${item.id} did not complete (${settled?.error ?? settled?.status ?? 'unknown'})`);
      failed.push({id: item.id, error: error.message}); onError(error); break;
    }
  } catch (error) {
    // The Host stops answering when its project closes; a closing project is not a failure.
    onError(error);
  }
  return {restored, failed};
}

async function settle(host, id, {delay, timeoutMs}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await delay(POLL_INTERVAL_MS);
    if (Date.now() >= deadline) return {status: 'timeout'};
    const snapshot = await read(host, '/api/project/resources');
    const operation = snapshot.operations?.find(item => item.id === id);
    if (operation && TERMINAL.has(operation.status)) return operation;
  }
}
