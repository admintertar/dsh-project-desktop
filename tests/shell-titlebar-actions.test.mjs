import test from 'node:test';
import assert from 'node:assert/strict';
import {createShellTitlebarActionRunner, shellTitlebarRequest, SHELL_TITLEBAR_ACTIONS, SHELL_TITLEBAR_REQUEST} from '../src/desktop-adapter/stable/shell-titlebar-actions.mjs';

const request = (action, argument) => ({type: SHELL_TITLEBAR_REQUEST, action, argument});

function runner(overrides = {}) {
  const calls = [];
  const handlers = {
    'project-new': () => calls.push('new'),
    'project-open': () => calls.push('open'),
    'project-welcome': () => calls.push('welcome'),
    'project-close': () => calls.push('close'),
    'recent-list': () => ['recent'],
    'recent-open': path => calls.push(`recent:${path}`),
    profile: () => calls.push('profile'),
    restart: () => calls.push('restart'),
    'safe-mode': () => calls.push('safe-mode'),
    recover: () => calls.push('recover'),
    about: () => calls.push('about'),
    contributions: () => [{id: '0', title: 'Tool', enabled: true}],
    contribution: id => calls.push(`contribution:${id}`),
    edit: command => calls.push(`edit:${command}`),
    view: command => calls.push(`view:${command}`),
    ...overrides,
  };
  return {run: createShellTitlebarActionRunner(handlers), calls};
}

test('only marked shell requests are claimed, official string actions stay untouched', () => {
  assert.deepEqual(shellTitlebarRequest(request(SHELL_TITLEBAR_ACTIONS.newProject)), {action: 'project-new', argument: null});
  assert.deepEqual(shellTitlebarRequest(request(SHELL_TITLEBAR_ACTIONS.openRecent, 'C:/p/x.agent-project')),
    {action: 'recent-open', argument: 'C:/p/x.agent-project'});
  for (const payload of ['terminal', 'reload', null, undefined, 42, {type: 'other', action: 'project-new'},
    {type: SHELL_TITLEBAR_REQUEST, action: 'not-a-shell-action'}, {}]) {
    assert.equal(shellTitlebarRequest(payload), null, JSON.stringify(payload));
  }
});

test('every titlebar command reaches its handler', async () => {
  const {run, calls} = runner();
  await run(SHELL_TITLEBAR_ACTIONS.newProject);
  await run(SHELL_TITLEBAR_ACTIONS.openProject);
  await run(SHELL_TITLEBAR_ACTIONS.welcome);
  await run(SHELL_TITLEBAR_ACTIONS.closeProject);
  assert.deepEqual(await run(SHELL_TITLEBAR_ACTIONS.listRecent), ['recent']);
  await run(SHELL_TITLEBAR_ACTIONS.openRecent, 'C:/p/x.agent-project');
  await run(SHELL_TITLEBAR_ACTIONS.profile);
  await run(SHELL_TITLEBAR_ACTIONS.restart);
  await run(SHELL_TITLEBAR_ACTIONS.safeMode);
  await run(SHELL_TITLEBAR_ACTIONS.recover);
  await run(SHELL_TITLEBAR_ACTIONS.about);
  assert.deepEqual(await run(SHELL_TITLEBAR_ACTIONS.listContributions), [{id: '0', title: 'Tool', enabled: true}]);
  await run(SHELL_TITLEBAR_ACTIONS.invokeContribution, '0');
  await run(SHELL_TITLEBAR_ACTIONS.edit, 'selectAll');
  await run(SHELL_TITLEBAR_ACTIONS.view, 'zoomReset');
  assert.deepEqual(calls, ['new', 'open', 'welcome', 'close', 'recent:C:/p/x.agent-project', 'profile', 'restart',
    'safe-mode', 'recover', 'about', 'contribution:0', 'edit:selectAll', 'view:zoomReset']);
});

test('unknown actions, bad arguments and unavailable commands are rejected', async () => {
  const {run, calls} = runner();
  await assert.rejects(() => run(SHELL_TITLEBAR_ACTIONS.edit, 'paste-evil'), /unsupported edit command/);
  await assert.rejects(() => run(SHELL_TITLEBAR_ACTIONS.view, 'devtools-evil'), /unsupported view command/);
  await assert.rejects(() => run(SHELL_TITLEBAR_ACTIONS.openRecent), /requires a target/);
  await assert.rejects(() => run(SHELL_TITLEBAR_ACTIONS.invokeContribution, ''), /requires a target/);
  await assert.rejects(() => run('project-destroy'), /unsupported action/);
  assert.deepEqual(calls, []);
});

test('an action missing from a window is refused instead of silently succeeding', async () => {
  const {run} = runner({profile: undefined});
  await assert.rejects(() => run(SHELL_TITLEBAR_ACTIONS.profile), /not available in this window/);
});
