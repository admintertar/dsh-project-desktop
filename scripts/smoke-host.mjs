import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {startProjectHost} from '../src/desktop-adapter/index.mjs';
import {ProjectRegistry} from '../src/windows/project-registry.mjs';
import {SharedTheme} from '../src/app/shared-theme.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {verifyUpstream} from './verify-upstream.mjs';

verifyUpstream();
mkdirSync(join(repository, '.runtime'), {recursive: true});
const root = mkdtempSync(join(repository, '.runtime/smoke-'));
const registry = new ProjectRegistry();
const theme = new SharedTheme({persist: async () => {}, applyNative: () => {}});
try {
  for (const id of ['alpha', 'beta-project']) {
    const projectRoot = join(root, id); mkdirSync(projectRoot);
    mkdirSync(join(projectRoot, 'memory'));
    writeFileSync(join(projectRoot, 'memory/guide.md'), `${id} project knowledge`);
    writeFileSync(join(projectRoot, `${id}.agent-project`), `schemaVersion: 1\nid: ${id}\nname: ${id}\nresources: []\nmemory:\n  - {id: guide, name: Guide, path: memory/guide.md}\n`);
  }
  const open = id => registry.open(id, () => startProjectHost({projectRoot: join(root, id),
    manifestPath: join(root, id, `${id}.agent-project`), stateDirectory: join(root, 'state', id)}));
  const [alpha, beta] = await Promise.all([open('alpha'), open('beta-project')]);
  assert.notEqual(alpha.result.pid, beta.result.pid);
  assert.notEqual(alpha.result.homeDir, beta.result.homeDir);
  assert.notEqual(new URL(alpha.url).port, new URL(beta.url).port);
  for (const [id, host] of [['alpha', alpha], ['beta-project', beta]]) {
    assert.equal(host.result.harnessVersion, '0.1.5-rc.2');
    assert.equal(host.result.projectSessionVersion, host.result.harnessVersion, 'Project peers resolve the same stable runtime');
    assert.ok(host.result.tools.includes('project_task_create'));
    const snapshot = await host.request('/api/project/snapshot'); assert.equal(snapshot.status, 200);
    const project = await snapshot.json();
    assert.equal(project.root, join(root, id));
    assert.equal(project.memory[0].content, `${id} project knowledge`);
    const content = `${id} updated knowledge`;
    const saved = await host.request('/api/project/memory', {method: 'POST',
      headers: {'content-type': 'application/json', origin: new URL(host.url).origin},
      body: JSON.stringify({action: 'update', id: 'guide', content})});
    assert.equal(saved.status, 200); await saved.body?.cancel();
    assert.equal(readFileSync(join(root, id, 'memory/guide.md'), 'utf8'), content);
    assert.equal(existsSync(join(root, id, '.agent-project/memory')), false);
    const denied = await fetch(new URL('/api/project/snapshot', host.url));
    assert.ok([401, 403].includes(denied.status)); await denied.body?.cancel();
    const windows = await (await host.request('/api/project/windows')).json();
    assert.equal(windows.enabled, true); assert.equal(windows.presentation, 'project');
    const html = await (await host.request('/')).text();
    const match = html.match(/(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]) = (\{.*?\})<\/script>/u);
    assert.ok(match, 'official boot graph exists');
    const boot = JSON.parse(match[1]);
    for (const packageName of ['dsh-project-shell', 'dsh-plugin-project', 'dshmarket']) {
      const entry = boot.entries.find(entry => entry.id === packageName); assert.ok(entry, packageName);
      const bundle = await host.request(entry.url); assert.equal(bundle.status, 200); await bundle.body.cancel();
    }
    const market = await host.request('/dsh-market/api/v1/capabilities');
    assert.equal(market.status, 200);
    const marketCapabilities = await market.json();
    assert.equal(marketCapabilities.profile, 'desktop');
    assert.equal(marketCapabilities.runtime, 'desktop');
    assert.equal(marketCapabilities.restart.supported, false);
    assert.equal(marketCapabilities.restart.managedBy, 'desktop-host');
    assert.ok(!boot.entries.some(entry => entry.id === 'dsh-plugin-desktop'), 'official app UI is not composed');
    assert.equal(host.result.policy.settingsController, false);
    assert.equal(host.result.policy.profileManagement, false);
    assert.equal(host.result.policy.marketProfileIdentity, true);
    await assert.rejects(host.request('https://example.com'), /outside/);
    for (const patch of [{mode: 'compatibility'}, {openBrowser: true}, {networkExposure: 'lan'}, {port: 4567}]) {
      await assert.rejects(host.updateShellSettings('dsh-desktop', patch));
    }
    assert.ok(!host.menuLabels().some(label => /update/i.test(label)), 'official update contribution is disabled');
  }
  await alpha.updateShellSettings('dsh-project-market', {provider: 'disabled'});
  const detachAlpha = await theme.connect('alpha', await alpha.getTheme(), value => alpha.setTheme(value));
  await theme.connect('beta', await beta.getTheme(), value => beta.setTheme(value));
  const propagated = Promise.withResolvers();
  const stopObserving = alpha.observeTheme(async value => {
    try {await theme.select(value); propagated.resolve()}
    catch (error) {propagated.reject(error)}
  });
  await alpha.selectTheme('dark');
  await Promise.race([propagated.promise, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Theme event did not propagate')), 5000);
    void propagated.promise.finally(() => clearTimeout(timer)).catch(() => {});
  })]);
  assert.equal(await alpha.getTheme(), 'dark'); assert.equal(await beta.getTheme(), 'dark');
  stopObserving(); await detachAlpha(); await registry.close('alpha');
  assert.equal((await beta.request('/api/project/snapshot')).status, 200, 'other Host survives');
  const reopened = await open('alpha');
  assert.notEqual(reopened.result.pid, alpha.result.pid);
  assert.equal((await (await reopened.request('/api/project/snapshot')).json()).memory[0].content, 'alpha updated knowledge');
  const reopenedHtml = await (await reopened.request('/')).text();
  const reopenedMatch = reopenedHtml.match(/(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]) = (\{.*?\})<\/script>/u);
  assert.ok(reopenedMatch); assert.ok(!JSON.parse(reopenedMatch[1]).entries.some(entry => entry.id === 'dshmarket'));
  assert.equal((await reopened.request('/dsh-market/api/v1/capabilities')).status, 404);
  await theme.connect('alpha', await reopened.getTheme(), value => reopened.setTheme(value));
  await theme.select('system');
  assert.equal(await reopened.getTheme(), 'system'); assert.equal(await beta.getTheme(), 'system');
  verifyUpstream();
  console.log(JSON.stringify({ok: true, desktop: '2.0.11', harness: '0.1.5-rc.2',
    checks: ['official-source-integrity', 'two-isolated-hosts', 'renderer-authentication', 'project-api',
      'project-task-tools', 'root-memory-read-edit-reopen', 'client-bundles', 'project-market-desktop-pnpm-bridge', 'project-market-profile-binding', 'project-market-disable-on-restart',
      'disabled-official-updates', 'shared-theme', 'close-and-reopen-isolation'],
    nativeWindowsTested: false, evidence: root}, null, 2));
} finally {await registry.closeAll()}
