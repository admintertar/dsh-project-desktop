import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createProjectFile} from '../dist/project-files.mjs';
import {projectStatePath} from '../src/app/project-state.mjs';
import {prepareOfficialProfile} from '../src/desktop-adapter/official/profile.mjs';
import {runtimeDirectory} from '../src/desktop-adapter/official/paths.mjs';

async function until(read, check, label) {
  const deadline = Date.now() + 20000;
  do {const value = await read(); if (check(value)) return value; await delay(100)} while (Date.now() < deadline);
  throw new Error(label);
}

/** 只在独立 smoke Home 中加载测试生产者：使用真正的 Jobs 与 Schedule 服务，不替换 inspectQuit。 */
async function fixture(userData, name, scheduled) {
  const directory = join(userData, 'fixtures', name); mkdirSync(directory, {recursive: true});
  const manifest = createProjectFile(join(directory, name + '.agent-project'));
  const state = projectStatePath(userData, manifest);
  const {profileDir} = await prepareOfficialProfile({...state, runtimeDir: runtimeDirectory()});
  const root = join(profileDir, 'node_modules/dsh-shell-close-fixture'); mkdirSync(root, {recursive: true});
  writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'dsh-shell-close-fixture', version: '0.0.0', type: 'module',
    exports: './index.mjs', dsh: {bundle: {patch: './cordis.patch.yml'}}}));
  writeFileSync(join(root, 'cordis.patch.yml'), '- insert:\n    - name: "@deepseek-ai/dsh-schedule"\n    - name: dsh-shell-close-fixture\n');
  const ready = join(state.stateDirectory, 'fixture-ready.json');
  writeFileSync(join(root, 'index.mjs'), `
import {writeFileSync} from 'node:fs';
export const inject = ['jobs', 'schedule', 'sessionController'];
export function apply(ctx) {
  ctx.effect(async () => {
    try {
      if (${scheduled}) {
        const {sessionId} = await ctx.sessionController.create({cwd: ${JSON.stringify(directory)}});
        const record = await ctx.schedule.create(sessionId, {title: 'Close confirmation fixture', prompt: 'Temporary smoke only', after_seconds: 3600});
        writeFileSync(${JSON.stringify(ready)}, JSON.stringify({scheduled: true, sessionId, scheduleId: record.id}));
      } else {
        ctx.jobs.attachController('shell-close-smoke');
        let settle;
        ctx.jobs.start({kind: 'bash', label: 'Close confirmation fixture', run: () => ({
          done: new Promise(resolve => {settle = resolve}), cancel: () => {settle({status: 'killed'})},
        })});
        writeFileSync(${JSON.stringify(ready)}, JSON.stringify({active: true}));
      }
    } catch (error) {writeFileSync(${JSON.stringify(ready)}, JSON.stringify({error: String(error)}))}
  });
}
`);
  const profileFile = join(profileDir, 'package.json');
  const profile = JSON.parse(readFileSync(profileFile, 'utf8'));
  profile.dsh.profile.bundles.push('dsh-shell-close-fixture');
  writeFileSync(profileFile, JSON.stringify(profile, null, 2));
  return {manifest, ready};
}

/** 人工或 UI 自动化操作真实原生弹窗；日志列出每一步预期动作，结果仅在状态断言通过后写入。 */
export async function runOfficialShellSmoke({electron, open, close, restart, workspace, session, userData, officialIpc}) {
  const active = await fixture(userData, 'active-alpha', false);
  const scheduled = await fixture(userData, 'scheduled-beta', true);
  let a = await open(active.manifest);
  const b = await open(scheduled.manifest);
  for (const {ready} of [active, scheduled]) {
    await until(() => existsSync(ready), Boolean, 'Fixture did not initialize');
    assert.equal(JSON.parse(readFileSync(ready, 'utf8')).error, undefined);
  }
  assert.deepEqual(await a.host.inspectQuit(), {activeTasks: true, scheduledTasks: false});
  assert.deepEqual(await b.host.inspectQuit(), {activeTasks: false, scheduledTasks: true});
  for (const project of [a, b]) await project.window.webContents.executeJavaScript('window.dshOnboarding.hasApiKey()');
  const healthy = async () => {
    assert.equal(workspace.projects.size, 2);
    for (const project of [a, b]) assert.equal((await project.host.request('/api/project/snapshot')).status, 200);
    // 自动连续发起不同用户操作时，留出上一原生按钮的 key-up / mouse-up 时间，避免事件落到下一弹窗。
    await delay(400);
  };
  await a.window.webContents.executeJavaScript('window.__DSH_LOCALE__.onChange("en")');
  await until(() => a.locale, value => value === 'en', 'English native locale');
  a.focus(); a.window.setSize(520, 600); electron.nativeTheme.themeSource = 'light';
  console.log('CLOSE CHECK 1: cancel Alpha native close with Escape; active-task warning only.');
  a.window.close(); assert.equal(await close(active.manifest), false); await healthy();
  console.log('CLOSE CHECK 2: cancel Alpha restart.');
  assert.equal(await restart(active.manifest), false); await healthy();
  const previous = a;
  console.log('CLOSE CHECK 3: confirm Alpha restart; Beta must stay alive.');
  a = await restart(active.manifest);
  assert.notEqual(a.host.url, previous.host.url); assert.equal(previous.window.isDestroyed(), true);
  await healthy();
  // 官方 preload 的 locale 通知控制原生语言，Host 内任务检查仍为真实值。
  await b.window.webContents.executeJavaScript('window.__DSH_LOCALE__.onChange("zh")');
  await until(() => b.locale, value => value === 'zh', 'Chinese native locale');
  b.focus(); b.window.setSize(520, 600); electron.nativeTheme.themeSource = 'dark';
  console.log('CLOSE CHECK 4: cancel Chinese Beta close; scheduled-task warning only.');
  assert.equal(await close(scheduled.manifest), false); await healthy();
  console.log('CLOSE CHECK 5: cancel application quit; both active and scheduled warnings.');
  electron.app.quit(); assert.equal(await workspace.shutdown(), false); await healthy();
  assert.equal(await open(scheduled.manifest), b);
  console.log('CLOSE CHECK 6: confirm Chinese Beta close; Alpha must stay alive.');
  assert.equal(await close(scheduled.manifest, {showWelcome: false}), true);
  assert.equal(b.window.isDestroyed(), true); assert.equal(session.get(scheduled.manifest), undefined);
  assert.equal((await a.host.request('/api/project/snapshot')).status, 200);
  await delay(400);
  console.log('CLOSE CHECK 7: confirm application shutdown; active Alpha only.');
  // 从真正的 before-quit 入口结束；退出事件中同步记录，避免在清空 workspace 后仍以“正常运行”状态打开欢迎页。
  await new Promise(resolve => {
    electron.app.once('quit', () => {
      assert.equal(workspace.projects.size, 0); assert.equal(officialIpc.owners.size, 0);
      assert.equal(session.get(active.manifest).phase, 'open');
      writeFileSync(join(userData, 'close-result.json'), JSON.stringify({platform: process.platform, arch: process.arch,
        realActiveJob: true, realSchedule: true, nativeCloseCancel: true, restartCancel: true, restartConfirmed: true,
        scheduledCloseCancel: true, applicationQuitCancel: true, projectCloseConfirmed: true, applicationShutdownConfirmed: true,
        otherProjectSurvives: true, englishAndChinese: true, lightAndDark: true, narrowWindow: true, allOwnersReleased: true}, null, 2) + '\n');
      console.log('Official close smoke passed.');
      resolve();
    });
    electron.app.quit();
  });
}
