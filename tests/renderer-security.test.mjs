import test from 'node:test';
import assert from 'node:assert/strict';
import {rendererHeaders, trustedSender, externalUrl} from '../src/windows/renderer-security.mjs';
const origin = 'http://127.0.0.1:42000';
const header = {name: 'X-Renderer', value: 'private'};
test('capability stays on the owning main frame and its own HTTP/WebSocket origin', () => {
  const top = {origin, detached: false, parent: null};
  const details = {webContentsId: 4, requestHeaders: {'x-renderer': 'forged'}, resourceType: 'xhr', url: origin + '/api', frame: top};
  assert.equal(rendererHeaders(details, 4, origin, header)['X-Renderer'], 'private');
  assert.deepEqual(rendererHeaders({...details, url: 'https://example.com'}, 4, origin, header), {});
  assert.deepEqual(rendererHeaders({...details, webContentsId: 5}, 4, origin, header), {});
  assert.deepEqual(rendererHeaders({...details, frame: {origin: 'https://evil.test', top}}, 4, origin, header), {});
  assert.equal(rendererHeaders({...details, url: 'ws://127.0.0.1:42000/connect'}, 4, origin, header)['X-Renderer'], 'private');
});
test('native IPC rejects subframes and other documents, external launches reject privileged protocols', () => {
  const mainFrame = {url: origin + '/'};
  const contents = {mainFrame, isDestroyed: () => false};
  assert.equal(trustedSender({sender: contents, senderFrame: mainFrame}, contents, origin), true);
  assert.equal(trustedSender({sender: contents, senderFrame: {url: origin + '/'}}, contents, origin), false);
  assert.equal(trustedSender({sender: contents, senderFrame: mainFrame}, contents, 'file:///guide/index.html', true), false);
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com']) assert.equal(externalUrl(value), undefined);
});
