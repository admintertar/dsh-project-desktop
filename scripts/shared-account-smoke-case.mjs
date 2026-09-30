import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, appendFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {stringify} from 'yaml';
import {createProjectFile} from '../dist/project-files.mjs';
import {projectStatePath} from '../src/app/project-state.mjs';
import {prepareOfficialProfile} from '../src/desktop-adapter/official/profile.mjs';
import {runtimeDirectory} from '../src/desktop-adapter/official/paths.mjs';
import {officialCredentials} from '../src/desktop-adapter/official/credential-runtime.mjs';
import {ACCOUNT_GRANT, ACCOUNT_DEVICE} from '../src/desktop-adapter/official/account-credentials.mjs';

async function until(read, check, label) {
  for (let n = 0; n < 200; n++) {if (check(await read())) return; await delay(75)}
  throw new Error('Shared account native check timed out: ' + label);
}

/** Local Platform fixture; the real official Host still performs PKCE, exchange and revocation. */
async function platformFixture() {
  const attempts = new Map();
  let origin, logoutCount = 0, exchanges = 0;
  const user = {id: 'shared-account-fixture', email: 'fixture@example.invalid', id_profile: {name: 'Shared Account Fixture', picture: null}};
  const server = createServer((request, response) => {void (async () => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    let value = null;
    if (request.url.endsWith('/auth_init')) {
      const id = randomUUID(); attempts.set(id, body);
      value = {authorize_url: origin + '/dsh/authorize?authorize_id=' + id, expires_in: 600, authorize_id: id};
    } else if (request.url.endsWith('/auth_exchange')) {
      const initial = [...attempts.values()].find(row => row.redirect_uri === body.redirect_uri
        && row.code_challenge === createHash('sha256').update(body.code_verifier).digest('base64url'));
      assert.ok(initial, 'Official PKCE challenge must match');
      exchanges++;
      value = {user, token: 'local-fixture-' + exchanges, authorized_url: origin + '/dsh/authorized'};
    } else if (request.url.endsWith('/current')) value = user;
    else if (request.url.endsWith('/get_user_summary')) value = {normal_wallets: [{currency: 'CNY', balance: '1.00'}], bonus_wallets: []};
    else if (request.url.includes('unnotified')) value = [];
    else if (request.url.endsWith('/logout')) logoutCount++;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({code: 0, data: {biz_code: 0, biz_data: value}}));
  })().catch(() => {response.writeHead(500).end()})});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  return {origin, get logoutCount() {return logoutCount}, get exchanges() {return exchanges},
    async authorize(url) {
      const initial = attempts.get(new URL(url).searchParams.get('authorize_id'));
      assert.ok(initial, 'Fixture authorization must belong to a known login');
      const callback = new URL(initial.redirect_uri); callback.searchParams.set('state', initial.state); callback.searchParams.set('code', 'fixture-code');
      const result = await fetch(callback, {redirect: 'manual'}); await result.body?.cancel(); return result.status;
    },
    close: () => new Promise(resolve => {server.close(resolve); server.closeAllConnections()}),
  };
}

async function fixture(userData, name, origin) {
  const directory = join(userData, 'fixtures', name); mkdirSync(directory, {recursive: true});
  const manifest = createProjectFile(join(directory, name + '.agent-project'));
  const state = projectStatePath(userData, manifest);
  const profile = await prepareOfficialProfile({...state, runtimeDir: runtimeDirectory()});
  appendFileSync(join(profile.profileDir, 'cordis.patch.yml'), stringify([{id: 'deepseek-account', config: {
    platformOrigin: origin, inferenceOrigin: origin, allowLoopbackHttp: true, desktopPlatform: process.platform,
  }}]));
  return {manifest, home: profile.homeDir};
}

/** RPC through the renderer's real Shell transport (including the application-wide account coordinator). */
async function invoke(project, method, args = {}) {
  const body = {type: 'client-request', rpcId: randomUUID(), method, payload: {args}};
  return project.window.webContents.executeJavaScript(`(async()=>{
    const response=await fetch(${JSON.stringify('/api/' + method)},{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}});
    const result=await response.json();if(!result.result?.ok)throw new Error('Fixture RPC failed');return result.result.value;
  })()`);
}
const signedIn = project => project.window.webContents.executeJavaScript(`Boolean(document.querySelector('button[data-signed-out=false]'))`);
/** Hit-test a live DOM target, then use native mouse input; never click through an overlay. */
async function nativeClick(project, expression) {
  project.focus();
  await project.window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  let point;
  try {await until(async () => {
    point = await project.window.webContents.executeJavaScript(`(()=>{const e=${expression};if(!e||e.disabled||e.closest('[inert]'))return null;const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const hit=document.elementFromPoint(x,y);return r.width>0&&r.height>0&&e.contains(hit)?{x:Math.round(x),y:Math.round(y)}:null})()`);
    return point;
  }, Boolean, 'visible clickable control')} catch (error) {
    console.log('Fixture click diagnostic', project.window.getTitle(), expression,
      await project.window.webContents.executeJavaScript(`({text:document.body.innerText.slice(-1800),menus:[...document.querySelectorAll('[role=menuitem]')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))})`));
    throw error;
  }
  project.window.webContents.sendInputEvent({type: 'mouseDown', ...point, button: 'left', clickCount: 1});
  project.window.webContents.sendInputEvent({type: 'mouseUp', ...point, button: 'left', clickCount: 1});
}
/** Complete the fixture's first-run prompt through the actual visible official controls. */
async function finishFixtureIntro(project) {
  await nativeClick(project, `document.querySelector('[data-desktop-onboarding=welcome] button')`);
  await nativeClick(project, `[...document.querySelectorAll('[data-desktop-onboarding] footer button')].find(e=>/^(跳过|Skip)$/.test(e.textContent.trim()))`);
  await clickDialog(project, '/^(我知道了|Got it)$/');
  await until(() => project.window.webContents.executeJavaScript('!!document.querySelector("[data-desktop-onboarding]")'), value => !value, 'fixture introduction completed');
}
async function setLocale(project, preference) {
  const settings = await invoke(project, 'settings/describe');
  await invoke(project, 'settings/update', {ns: 'locale', patch: {preference},
    expectedRevision: settings.namespaces.find(entry => entry.ns === 'locale').revision});
  await until(() => project.window.webContents.executeJavaScript('document.documentElement.lang'), lang => lang.startsWith(preference), 'locale applied');
}
async function resize(project, width, height) {
  project.window.setSize(width, height);
  const expectedWidth = project.window.getContentSize()[0];
  await until(() => project.window.webContents.executeJavaScript('innerWidth'), value => value === expectedWidth, 'native resize applied');
  await project.window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
}
async function selectAccountAction(project, pattern) {
  await nativeClick(project, `document.querySelector('button[data-signed-out]')`);
  await nativeClick(project, `[...document.querySelectorAll('[role=menuitem]')].find(el=>${pattern}.test(el.textContent.trim()))`);
}
async function clickDialog(project, pattern) {
  await nativeClick(project, `[...document.querySelectorAll('[role=dialog] button')].find(el=>${pattern}.test(el.textContent.trim()))`);
}

export async function runOfficialShellSmoke({electron, open, close, restart, userData, workspace}) {
  const platform = await platformFixture();
  const originalOpen = electron.shell.openExternal, launched = [];
  electron.shell.openExternal = async url => {assert.equal(new URL(url).origin, platform.origin); launched.push(url)};
  const credentials = await officialCredentials(runtimeDirectory());
  const capture = async (project, name) => {
    project.focus();
    assert.equal(project.window.webContents.getURL(), 'dsh-app://app/');
    await project.window.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    writeFileSync(join(userData, name + '.png'), (await project.window.webContents.capturePage()).toPNG());
  };
  try {
    const fa = await fixture(userData, 'account-alpha', platform.origin), fb = await fixture(userData, 'account-beta', platform.origin);
    let a = await open(fa.manifest), b = await open(fb.manifest);
    assert.notEqual(a.window.webContents.session, b.window.webContents.session);
    await until(() => a.window.webContents.executeJavaScript(`!!document.querySelector('button[data-signed-out=true]')`), Boolean, 'signed-out launcher');
    await selectAccountAction(a, '/^(登录|Sign in)$/');
    await until(() => launched.length, count => count === 1, 'one native authorization');
    assert.equal(await platform.authorize(launched[0]), 302);
    for (const project of [a, b]) {
      try {await until(() => signedIn(project), Boolean, 'shared signed-in UI')}
      catch (error) {
        console.log('Fixture UI diagnostic', project.window.getTitle(), {
          accountStatus: (await invoke(project, 'account/getState')).status,
          page: await project.window.webContents.executeJavaScript(`({headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent),accountButtons:[...document.querySelectorAll('button[data-signed-out]')].map(e=>e.outerHTML),text:document.body.innerText.slice(-1200)})`),
        });
        await capture(project, 'shared-account-diagnostic');
        throw error;
      }
      await finishFixtureIntro(project);
    }
    assert.equal((await invoke(b, 'account/getState')).attempt, null);
    const identityA = await invoke(a, 'account/getProfile', {client: {version: '0.2.0-rc.2', locale: 'zh', timezoneOffsetSeconds: 0}});
    const identityB = await invoke(b, 'account/getProfile', {client: {version: '0.2.0-rc.2', locale: 'en', timezoneOffsetSeconds: 0}});
    assert.equal(identityA.value.id, identityB.value.id);
    await invoke(a, 'credentials/set', {ref: 'SHARED_ACCOUNT_PRIVATE_KEY', value: 'fixture-private-key'});
    const readStore = path => credentials.parseCredentialsDocument(readFileSync(path, 'utf8'), 'fixture');
    assert.equal(readStore(join(fa.home, '.credentials.yaml')).refs.has('SHARED_ACCOUNT_PRIVATE_KEY'), true);
    assert.equal(readStore(join(fb.home, '.credentials.yaml')).refs.has('SHARED_ACCOUNT_PRIVATE_KEY'), false);
    const shared = readStore(join(userData, 'account/.credentials.yaml'));
    assert.equal(shared.refs.size, 0);
    assert.deepEqual([...shared.records.keys()].sort(), [ACCOUNT_GRANT, ACCOUNT_DEVICE].sort());
    const privateA = readStore(join(fa.home, '.credentials.yaml')).records.get('client-connection/browser-session');
    const privateB = readStore(join(fb.home, '.credentials.yaml')).records.get('client-connection/browser-session');
    assert.notDeepEqual(privateA, privateB);
    a = await restart(fa.manifest);
    await until(() => signedIn(a), Boolean, 'restarted signed-in window');
    const fc = await fixture(userData, 'account-gamma', platform.origin), c = await open(fc.manifest);
    await until(() => signedIn(c), Boolean, 'new signed-in window');
    await finishFixtureIntro(c);
    assert.equal(launched.length, 1);
    await setLocale(a, 'zh');
    await a.host.setTheme('dark');
    await until(() => a.window.webContents.executeJavaScript('document.body.hasAttribute("data-ds-dark-theme")'), Boolean, 'dark account UI');
    await capture(a, 'shared-account-zh-dark');
    await setLocale(b, 'en');
    await b.host.setTheme('light');
    await selectAccountAction(b, '/^(退出登录|Sign out)$/');
    await until(() => b.window.webContents.executeJavaScript('!!document.querySelector("[role=dialog]")'), Boolean, 'official sign-out confirmation');
    const previousSize = b.window.getSize();
    await resize(b, 852, 672);
    await capture(b, 'shared-account-en-confirm');
    b.window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'Escape'});
    b.window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'Escape'});
    await until(() => b.window.webContents.executeJavaScript('!!document.querySelector("[role=dialog]")'), value => !value, 'Escape cancellation');
    assert.equal(await signedIn(a), true); assert.equal(await signedIn(b), true);
    await resize(b, ...previousSize);
    await selectAccountAction(b, '/^(退出登录|Sign out)$/');
    await clickDialog(b, '/^(退出登录|Sign out)$/');
    for (const project of [a, b, c]) await until(() => signedIn(project), value => !value, 'shared signed-out UI');
    b = await restart(fb.manifest);
    assert.equal(await signedIn(b), false);
    assert.ok(platform.logoutCount > 0);
    // Competing login windows: a second explicit attempt cancels the first.
    await selectAccountAction(a, '/^(登录|Sign in)$/');
    await until(() => launched.length, count => count === 2, 'Alpha pending login');
    await selectAccountAction(b, '/^(登录|Sign in)$/');
    await until(() => launched.length, count => count === 3, 'Beta pending login');
    await until(() => invoke(a, 'account/getState'), value => value.attempt?.phase === 'cancelled', 'superseded login');
    assert.equal(await platform.authorize(launched[2]), 302);
    for (const project of [a, b, c]) await until(() => signedIn(project), Boolean, 'second shared login');
    // Logout while another window has a browser attempt open cannot later restore the account.
    const client = {version: '0.2.0-rc.2', locale: 'zh', timezoneOffsetSeconds: 0};
    await invoke(b, 'account/startSignIn', {client, callbackOrigin: new URL(b.host.url).origin, loginSource: 'desktop'});
    await until(() => launched.length, count => count === 4, 'pending reauthorization');
    await selectAccountAction(c, '/^(退出登录|Sign out)$/');
    await clickDialog(c, '/^(退出登录|Sign out)$/');
    for (const project of [a, b, c]) await until(() => signedIn(project), value => !value, 'logout cancels peer authorization');
    await until(() => invoke(b, 'account/getState'), value => value.attempt === null || value.attempt.phase === 'cancelled', 'peer login settled');
    assert.notEqual(await platform.authorize(launched[3]), 302);
    assert.equal(readStore(join(userData, 'account/.credentials.yaml')).records.has(ACCOUNT_GRANT), false);
    for (const f of [fa, fb, fc]) await close(f.manifest, {showWelcome: false});
    assert.equal(workspace.projects.size, 0);
    writeFileSync(join(userData, 'shared-account-result.json'), JSON.stringify({platform: process.platform, arch: process.arch,
      officialVersion: '0.2.0-rc.2', localPlatformFixture: true, realOfficialPkceExchange: platform.exchanges > 0,
      oneLoginSharedAcrossWindows: true, sameAccountIdentity: true, newAndRestartedWindowSignedIn: true,
      privateApiKeysAndHostSecrets: true, separateChromiumPartitions: true, officialSignOutCancelAndConfirm: true,
      signedOutAfterRestart: true, competingLoginCancellation: true, logoutCancelsPendingPeerLogin: true,
      chineseDarkEnglishLightNarrow: true, allProjectsClosed: true}, null, 2));
    console.log('Shared account native smoke passed.');
  } finally {
    electron.shell.openExternal = originalOpen;
    for (const path of workspace.projects.keys()) await close(path, {showWelcome: false});
    await platform.close();
  }
}
