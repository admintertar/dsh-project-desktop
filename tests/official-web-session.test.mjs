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

test('Session teardown revokes old credentials and permits a new Host in the same partition', async () => {
  const partitions = new Map();
  const electron = {session: {fromPartition(name) {
    if (!partitions.has(name)) {
      const partition = {protocol: {
        handle(_scheme, handler) {assert.equal(partition.handle, undefined); partition.handle = handler;},
        unhandle() {partition.handle = undefined;},
      }, webRequest: {onBeforeSendHeaders(_filter, handler) {partition.headers = handler;}}};
      partitions.set(name, partition);
    }
    return partitions.get(name);
  }}};
  const forwarded = [];
  const options = {electron, partitionName: 'persist:reopen', hostUrl: 'http://127.0.0.1:43101/login',
    cookie: 'session=old', webDist: '/web', serveWebDocument: () => new Response('static'),
    forwardWebRequest: (_request, url, cookie) => {forwarded.push({url, cookie}); return new Response('host');}};
  const first = configureOfficialProjectSession(options);
  first.bindWindow({webContents: {id: 11}, isDestroyed: () => false});
  assert.throws(() => configureOfficialProjectSession(options), /already has an owner/);
  assert.throws(() => first.bindWindow({webContents: {id: 12}}), /already has a window/);
  const oldRequest = first.partition.handle, oldHeaders = first.partition.headers;
  first.dispose();
  assert.equal(first.partition.handle, undefined);
  assert.equal(first.partition.headers, undefined);
  assert.throws(() => first.bindWindow({webContents: {id: 12}}), /disposed/);
  const request = new Request('dsh-app://app/api/project/snapshot');
  assert.equal((await oldRequest(request)).status, 410);
  let staleAnswer;
  oldHeaders({url: 'ws://127.0.0.1:43101/events', webContentsId: 11,
    requestHeaders: {Origin: 'dsh-app://app'}}, value => {staleAnswer = value});
  assert.deepEqual(staleAnswer, {cancel: true});
  assert.deepEqual(forwarded, []);
  const second = configureOfficialProjectSession({...options, hostUrl: 'http://127.0.0.1:43102/login', cookie: 'session=new'});
  assert.equal(second.partition, first.partition);
  second.bindWindow({webContents: {id: 22}});
  first.dispose();
  assert.equal((await second.partition.handle(request)).status, 200);
  assert.deepEqual(forwarded, [{url: 'http://127.0.0.1:43102/login', cookie: 'session=new'}]);
  second.dispose();
});

test('official IPC owner requires the project main frame and dsh-app origin', () => {
  const owners = createOfficialWindowOwners();
  const webContents = {id: 7};
  const window = {webContents, isDestroyed: () => false};
  const mainFrame = {url: 'dsh-app://app/'};
  const release = owners.register(window, {project: {id: 'A'}});
  const trusted = {sender: webContents, senderFrame: mainFrame};
  // Electron exposes mainFrame on WebContents; the fixture mirrors it.
  webContents.mainFrame = mainFrame;
  assert.deepEqual(owners.trusted(trusted).project, {id: 'A'});
  assert.throws(() => owners.trusted({...trusted, senderFrame: {url: 'dsh-app://app/iframe'}}), /Untrusted/);
  assert.throws(() => owners.trusted({...trusted, senderFrame: {url: 'https://example.test/'}}), /Untrusted/);
  release();
  assert.equal(owners.size, 0);
});

test('closing a Session aborts its in-flight forwarding without cancelling another project', async () => {
  const partitions = new Map(), requests = [];
  const electron = {session: {fromPartition(name) {
    const partition = {protocol: {handle(_name, callback) {partition.handle = callback}, unhandle() {}},
      webRequest: {onBeforeSendHeaders() {}}};
    partitions.set(name, partition); return partition;
  }}};
  const options = {electron, hostUrl: 'http://127.0.0.1:12345/', cookie: 'owned', webDist: '/web',
    serveWebDocument: () => new Response('static'),
    forwardWebRequest: request => new Promise((resolve, reject) => {
      requests.push({request, resolve});
      request.signal.addEventListener('abort', () => reject(request.signal.reason), {once: true});
    })};
  const a = configureOfficialProjectSession({...options, partitionName: 'persist:a'});
  const b = configureOfficialProjectSession({...options, partitionName: 'persist:b'});
  const one = a.partition.handle(new Request('dsh-app://app/api/a'));
  const two = b.partition.handle(new Request('dsh-app://app/api/b'));
  a.dispose();
  assert.equal((await one).status, 410);
  assert.equal(requests[0].request.signal.aborted, true);
  assert.equal(requests[1].request.signal.aborted, false);
  requests[1].resolve(new Response('still running'));
  assert.equal(await (await two).text(), 'still running');
  b.dispose();
});

test('IPC cleanup works after WebContents destruction without erasing a newer owner', () => {
  const owners = createOfficialWindowOwners();
  const window = {webContents: {id: 7}};
  const release = owners.register(window, {project: 'first'});
  Object.defineProperty(window, 'webContents', {get() {throw new Error('Object has been destroyed');}});
  release();
  const next = {webContents: {id: 7}};
  const releaseNext = owners.register(next, {project: 'next'});
  release();
  assert.equal(owners.size, 1);
  releaseNext();
  assert.equal(owners.size, 0);
});
