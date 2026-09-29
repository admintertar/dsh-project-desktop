import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {configureOfficialProjectSession} from '../src/desktop-adapter/official/web-session.mjs';
import {createOfficialWindowOwners} from '../src/desktop-adapter/official/ipc-owners.mjs';

test('official dsh-app requests and WebSockets stay in their owning project Session', async () => {
  const partitions = new Map();
  const electron = {session: {fromPartition(name) {
    const partition = {name, protocol: {handle(_scheme, handler) {partition.handle = handler}},
      webRequest: {onBeforeSendHeaders(_filter, handler) {partition.headers = handler}}};
    partitions.set(name, partition);
    return partition;
  }}};
  const staticCalls = [], forwarded = [];
  const serveWebDocument = (request, webDist) => {staticCalls.push([request.url, webDist]); return new Response('static');};
  const forwardWebRequest = (request, hostUrl, cookie) => {forwarded.push([request.url, hostUrl, cookie]); return new Response('host');};
  const a = configureOfficialProjectSession({electron, partitionName: 'persist:project-a',
    hostUrl: 'http://127.0.0.1:43101/login', cookie: 'session=a', webDist: '/official/web',
    serveWebDocument, forwardWebRequest});
  const b = configureOfficialProjectSession({electron, partitionName: 'persist:project-b',
    hostUrl: 'http://127.0.0.1:43102/login', cookie: 'session=b', webDist: '/official/web',
    serveWebDocument, forwardWebRequest});
  a.bindWindow({webContents: {id: 11}});
  b.bindWindow({webContents: {id: 22}});
  assert.notEqual(a.partition, b.partition);
  assert.equal((await a.partition.handle(new Request('dsh-app://app/assets/app.js'))).status, 200);
  assert.equal((await a.partition.handle(new Request('dsh-app://app/api/project/snapshot'))).status, 200);
  assert.equal((await b.partition.handle(new Request('dsh-app://app/api/project/snapshot'))).status, 200);
  assert.equal((await b.partition.handle(new Request('dsh-app://wrong/api/project/snapshot'))).status, 404);
  assert.deepEqual(staticCalls, [['dsh-app://app/assets/app.js', '/official/web']]);
  assert.deepEqual(forwarded, [
    ['dsh-app://app/api/project/snapshot', 'http://127.0.0.1:43101/login', 'session=a'],
    ['dsh-app://app/api/project/snapshot', 'http://127.0.0.1:43102/login', 'session=b'],
  ]);
  const check = (partition, webContentsId, url, origin = 'dsh-app://app') => {
    let answer;
    partition.headers({url, webContentsId, requestHeaders: {Origin: origin}}, value => {answer = value});
    return answer;
  };
  assert.deepEqual(check(a.partition, 11, 'ws://127.0.0.1:43101/events'), {requestHeaders: {
    origin: 'http://127.0.0.1:43101', cookie: 'session=a', 'sec-fetch-site': 'same-origin',
  }});
  assert.deepEqual(check(b.partition, 22, 'ws://127.0.0.1:43102/events')?.requestHeaders.cookie, 'session=b');
  assert.deepEqual(check(a.partition, 22, 'ws://127.0.0.1:43101/events'), {cancel: true});
  assert.deepEqual(check(a.partition, 11, 'ws://127.0.0.1:43102/events'), {cancel: true});
  assert.deepEqual(check(a.partition, 11, 'ws://127.0.0.1:43101/events', 'https://outside.example'), {cancel: true});
  assert.equal(partitions.size, 2);
});

test('official project Session rejects non-loopback Host and non-persistent partition', () => {
  const options = {electron: {session: {fromPartition() {throw new Error('must not run')}}},
    partitionName: 'persist:project', hostUrl: 'http://example.com:43101/', cookie: 'secret',
    webDist: '/web', serveWebDocument() {}, forwardWebRequest() {}};
  assert.throws(() => configureOfficialProjectSession(options), /loopback Host/);
  assert.throws(() => configureOfficialProjectSession({...options, partitionName: 'project',
    hostUrl: 'http://127.0.0.1:43101/'}), /persistent partition/);
});

test('official IPC owner requires the project main frame and dsh-app origin', () => {
  const owners = createOfficialWindowOwners();
  const webContents = {id: 7};
  const window = {webContents, isDestroyed: () => false};
  const mainFrame = {url: 'dsh-app://app/'};
  owners.register(window, {project: {id: 'A'}});
  const trusted = {sender: webContents, senderFrame: mainFrame};
  // Electron exposes mainFrame on WebContents; the fixture mirrors it.
  webContents.mainFrame = mainFrame;
  assert.deepEqual(owners.trusted(trusted).project, {id: 'A'});
  assert.throws(() => owners.trusted({...trusted, senderFrame: {url: 'dsh-app://app/iframe'}}), /Untrusted/);
  assert.throws(() => owners.trusted({...trusted, senderFrame: {url: 'https://example.test/'}}), /Untrusted/);
  owners.unregister(window);
  assert.equal(owners.size, 0);
});
