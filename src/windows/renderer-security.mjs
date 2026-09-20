import {fileURLToPath} from 'node:url';

export function trustedSender(event, contents, expectedUrl, localFile = false) {
  if (contents.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
  try {
    const actual = new URL(event.senderFrame.url);
    const expected = new URL(expectedUrl);
    if (!localFile) return actual.origin === expected.origin;
    // Node's pathToFileURL escapes ~ while Chromium's loadFile preserves it
    // (notably Windows RUNNER~1 paths). Compare the same file, not its encoding.
    return actual.protocol === 'file:' && expected.protocol === 'file:'
      && actual.host === expected.host && actual.search === expected.search && actual.hash === expected.hash
      && fileURLToPath(actual) === fileURLToPath(expected);
  } catch {return false}
}

/** Minimal adaptation of official electron-shell-generation.ts (private helpers). */
export function rendererHeaders(details, webContentsId, origin, header) {
  const headers = Object.fromEntries(Object.entries(details.requestHeaders)
    .filter(([key]) => key.toLowerCase() !== header.name.toLowerCase()));
  const ids = [details.webContentsId, details.webContents?.id].filter(id => id !== undefined);
  if (!ids.length || ids.some(id => id !== webContentsId)) return headers;
  let target;
  try {target = new URL(details.url)} catch {return headers}
  const socketOrigin = origin.replace(/^http/, 'ws');
  if (target.origin !== origin && target.origin !== socketOrigin) return headers;
  if (details.resourceType !== 'mainFrame') {
    const frame = details.frame;
    const top = frame?.top ?? (frame?.parent === null ? frame : undefined);
    if (!frame || frame.detached || frame.origin !== origin || !top || top.detached || top.origin !== origin) return headers;
  }
  headers[header.name] = header.value;
  return headers;
}

/**
 * Renderer permissions the official DSH client UI legitimately needs. Copy
 * affordances (message, code block, terminal, table, JSON tree) call
 * `navigator.clipboard.writeText`; Electron reports that request as
 * `clipboard-read`, so denying every permission silently breaks copy. Both
 * names stay allowed so the policy survives the write/read naming split.
 */
export const rendererPermissions = Object.freeze(['clipboard-read', 'clipboard-sanitized-write']);

/**
 * Deny every renderer permission except clipboard access. The official DSH
 * Desktop runtime installs no handler at all, which is why copy works there.
 * @param session - the Electron session owned by one window.
 * @returns a disposer restoring the Electron defaults.
 */
export function applyRendererPermissionPolicy(session) {
  const allowed = new Set(rendererPermissions);
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowed.has(permission)));
  session.setPermissionCheckHandler((_contents, permission) => allowed.has(permission));
  return () => {session.setPermissionRequestHandler(null); session.setPermissionCheckHandler(null)};
}

export function externalUrl(value) {
  try {const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined}
  catch {return undefined}
}
