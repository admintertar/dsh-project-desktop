import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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

test('window sessions never install a renderer permission handler', () => {
  // Official parity: the pinned Desktop runtime installs none, and a deny-all
  // policy rejects `navigator.clipboard.writeText` as `clipboard-read` while the
  // official client swallows that rejection, killing every copy button silently.
  for (const file of ['../src/desktop-adapter/native.mjs', '../src/windows/guide-window.mjs']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /setPermission(Request|Check)Handler/u, file);
  }
});

test('local guide IPC accepts equivalent file encoding without accepting other files, queries or frames', () => {
  const expected = 'file:///C:/Users/RUNNER%7E1/DSH%20Project/dist/guide/index.html?mode=create';
  const mainFrame = {url: expected.replace('%7E', '~')};
  const contents = {mainFrame, isDestroyed: () => false};
  const event = {sender: contents, senderFrame: mainFrame};
  assert.equal(trustedSender(event, contents, expected, true), true);
  assert.equal(trustedSender({...event, senderFrame: {...mainFrame}}, contents, expected, true), false);
  for (const url of [expected.replace('index.html', 'other.html'), expected.replace('mode=create', 'mode=welcome'),
    expected + '#other', expected.replace('%7E', '%257E'), expected.replace('file:', 'https:'),
    expected.replace('guide/index', 'guide%2Findex')]) {
    mainFrame.url = url;
    assert.equal(trustedSender(event, contents, expected, true), false, url);
  }
});
