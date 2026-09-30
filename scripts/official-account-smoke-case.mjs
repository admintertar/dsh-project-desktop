import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

async function until(read, check, label) {
  const deadline = Date.now() + 30000;
  do {if (check(await read())) return; await delay(100)} while (Date.now() < deadline);
  // 账号状态含临时授权 URL，失败信息只记录阶段名。
  throw new Error(`Account native smoke timed out: ${label}`);
}

/** 可选在线验证：真实官方 UI/Host，截获 OS 打开动作，不提供用户凭据。 */
export async function checkOfficialAccount({electron, a, b, deepLinks, capture}) {
  const state = async project => {
    const rpcId = randomUUID(), method = 'account/getState';
    const response = await project.host.request('/api/' + method, {method: 'POST',
      headers: {'content-type': 'application/json'}, body: JSON.stringify({type: 'client-request', rpcId, method, payload: {args: {}}})});
    assert.equal(response.ok, true);
    const envelope = await response.json(); assert.equal(envelope.result?.ok, true);
    return envelope.result.value;
  };
  const launched = [];
  const original = electron.shell.openExternal;
  electron.shell.openExternal = async value => {launched.push(value)};
  try {
    assert.equal((await state(a)).status, 'signed-out'); assert.equal((await state(b)).attempt, null);
    a.focus();
    await a.window.webContents.executeJavaScript('document.querySelector("button[data-signed-out=true]").click()');
    await until(() => a.window.webContents.executeJavaScript(`(() => {
      const item = [...document.querySelectorAll('[role=menuitem]')].find(el => /^(登录|Sign in)$/.test(el.innerText.trim()));
      if (!item) return false; item.click(); return true;
    })()`), Boolean, 'official sign-in menu');
    await until(async () => (await state(a)).attempt?.phase, value => value === 'waiting-browser', 'waiting-browser');
    await until(() => launched.length, value => value === 1, 'native browser launch');
    const attempt = (await state(a)).attempt;
    const expected = new URL(attempt.authorizeUrl);
    expected.searchParams.set('theme', electron.nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
    // 不把授权 URL 写入断言差异或证据。
    assert.equal(launched[0] === expected.href, true, 'Native launcher must preserve the official authorization URL');
    assert.equal((await state(b)).attempt, null);
    await capture(a.window, 'account-waiting');
    b.focus(); assert.equal(deepLinks.handle('dsh://open'), true);
    await until(() => electron.BrowserWindow.getFocusedWindow(), value => value === a.window, 'return to sign-in project');
    // 相同 attempt 在 Renderer 重读状态时不重复打开。
    await state(a); await delay(300); assert.equal(launched.length, 1);
    await a.window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('[role=dialog] button')].find(el => /^(取消|Cancel)$/.test(el.innerText.trim()));
      if (!button) throw new Error('Official cancel button missing'); button.click();
    })()`);
    await until(async () => (await state(a)).attempt?.phase, value => value === 'cancelled', 'official cancellation');
    await until(() => a.window.webContents.executeJavaScript('Boolean(document.querySelector("[role=dialog]"))'), value => !value, 'dialog dismissal');
    b.focus(); deepLinks.handle('dsh://open');
    await delay(100); assert.equal(electron.BrowserWindow.getFocusedWindow(), b.window);
    assert.equal((await state(a)).status, 'signed-out'); assert.equal((await state(b)).status, 'signed-out');
    return {officialSignInDialog: true, realHostAccountWatch: true, launchInterceptedAtOsBoundary: true,
      themeAndAuthorizationPreserved: true, returnedToOriginatingProject: true, cancelledViaOfficialDialog: true,
      otherProjectUnaffected: true, realAccountAuthorizationCompleted: false};
  } finally {electron.shell.openExternal = original}
}

/** 实际官方 bridge 的租约按项目隔离，不共享同名工作区的浏览器存储。 */
export async function checkOfficialBrowser(electron, a, b) {
  const acquire = project => project.window.webContents.executeJavaScript('window.dshDesktop.browser.acquire("native-smoke")');
  const leaseA = await acquire(a), leaseB = await acquire(b);
  assert.notEqual(leaseA.partition, leaseB.partition); assert.notEqual(leaseA.lease, leaseB.lease);
  const guestSession = electron.session.fromPartition(leaseA.partition);
  await assert.rejects(guestSession.fetch(a.host.url), /BLOCKED|blocked|ERR_FAILED/);
  const otherHost = await guestSession.fetch(new URL('/api/project/snapshot', b.host.url).href);
  assert.equal([401, 403].includes(otherHost.status), true, 'Another Host still requires its own authentication');
  await otherHost.body?.cancel();
  // 官方 helper 的 unknown lease 是幂等 no-op，B 不能释放 A 所在实例的租约。
  await b.window.webContents.executeJavaScript(`window.dshDesktop.browser.release(${JSON.stringify(leaseA.lease)})`);
  await a.window.webContents.executeJavaScript(`window.dshDesktop.browser.release(${JSON.stringify(leaseA.lease)})`);
  await b.window.webContents.executeJavaScript(`window.dshDesktop.browser.release(${JSON.stringify(leaseB.lease)})`);
  return {separateWorkspacePartitions: true, acquiredAndReleasedThroughOfficialPreload: true,
    ownHostBlockedByOfficialGuestPolicy: true, otherHostRejectsUnauthenticatedGuest: true};
}
