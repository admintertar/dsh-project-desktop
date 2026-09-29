/**
 * Give one official Desktop Host its own Electron Session and dsh-app bridge.
 * The Shell owns the Session; official web-document helpers retain the exact
 * upstream static-file and HTTP forwarding behavior.
 */
export function configureOfficialProjectSession({electron, partitionName, hostUrl, cookie, webDist,
  serveWebDocument, forwardWebRequest}) {
  if (!partitionName.startsWith('persist:') || !/^http:\/\/127\.0\.0\.1:\d+\//.test(hostUrl)) {
    throw new Error('Official project Session requires a persistent partition and loopback Host URL');
  }
  const partition = electron.session.fromPartition(partitionName);
  const hostOrigin = new URL(hostUrl).origin;
  const hostAddress = new URL(hostUrl).host;
  partition.protocol.handle('dsh-app', request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, {status: 404}));
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
      || ['/favicon.svg', '/manifest.webmanifest'].includes(url.pathname)) {
      return serveWebDocument(request, webDist);
    }
    return forwardWebRequest(request, hostUrl, cookie);
  });
  return {partition, bindWindow(window) {
    // The filter runs inside this Session. Also match the originating window,
    // exact Host address and dsh-app Origin before attaching the Host Cookie.
    partition.webRequest.onBeforeSendHeaders({urls: ['ws://127.0.0.1/*']}, (details, callback) => {
      const requested = new URL(details.url);
      const headers = Object.fromEntries(Object.entries(details.requestHeaders)
        .map(([name, value]) => [name.toLowerCase(), value]));
      if (details.webContentsId !== window.webContents.id || requested.host !== hostAddress
        || headers.origin !== 'dsh-app://app') {
        callback({cancel: true}); return;
      }
      callback({requestHeaders: {...headers, origin: hostOrigin, cookie, 'sec-fetch-site': 'same-origin'}});
    });
  }};
}
