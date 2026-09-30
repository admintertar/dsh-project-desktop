import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {join} from 'node:path';
import {officialSource} from '../src/desktop-adapter/official/paths.mjs';
import {verifyOfficialSource} from '../scripts/verify-official-source.mjs';
import {createOfficialQuitGuard, inspectProjectQuit} from '../src/desktop-adapter/official/quit-guard.mjs';

verifyOfficialSource(officialSource);
const built = await build({stdin: {contents: ['quit-confirmation', 'locale'].map(name =>
  `export * from ${JSON.stringify(join(officialSource, 'apps/desktop/src', name + '.ts'))};`).join('\n'), loader: 'ts', resolveDir: officialSource},
  write: false, bundle: true, platform: 'node', format: 'esm'});
const services = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64'));
const project = (activeTasks, scheduledTasks, locale = 'en') => ({locale,
  host: {inspectQuit: async () => ({activeTasks, scheduledTasks})}});

test('aggregate inspection keeps armed reminders when another Host cannot answer', async () => {
  assert.deepEqual(await inspectProjectQuit([project(false, true), {host: {inspectQuit() {throw new Error('Unavailable')}}}]),
    {activeTasks: true, scheduledTasks: true});
});

test('official confirmation preserves cancellation, platform button contract and project scope in both locales', async () => {
  for (const locale of ['en', 'zh']) {
    const shown = [];
    const guard = createOfficialQuitGuard({app: {focus() {}}, dialog: {async showMessageBox(options) {shown.push(options); return {response: 1}}}},
      services, {locale: () => locale, name: 'Project Desktop'});
    assert.equal(await guard.confirm({action: 'close', path: '/fixtures/Alpha.agent-project', projects: [project(true, false, locale)]}), false);
    assert.equal(shown[0].title, 'Project Desktop');
    assert.match(shown[0].message, /Alpha/);
    assert.equal(shown[0].cancelId, 1); assert.equal(shown[0].defaultId, 0);
    assert.equal(shown[0].buttons[1], services.resolveDesktopLocale(locale).messages.cancel);
    assert.match(shown[0].detail, locale === 'zh' ? /此项目/ : /this project/);
    assert.equal(await guard.confirm({action: 'restart', path: '/fixtures/Alpha.agent-project', projects: [project(false, true, locale)]}), false);
    assert.match(shown[1].buttons[0], locale === 'zh' ? /重启/ : /Restart/);
    assert.match(shown[1].detail, locale === 'zh' ? /重启期间/ : /restarting/);
  }
});

test('idle projects close silently; global quit sees every project and keeps official warning text', async () => {
  const shown = [];
  const guard = createOfficialQuitGuard({app: {focus() {}}, dialog: {async showMessageBox(options) {shown.push(options); return {response: 0}}}},
    services, {locale: () => 'en', name: 'Project Desktop'});
  assert.equal(await guard.confirm({action: 'close', path: 'idle.agent-project', projects: [project(false, false)]}), true);
  assert.equal(shown.length, 0);
  assert.equal(await guard.confirm({action: 'quit', projects: [project(true, false), project(false, true)]}), true);
  assert.equal(shown[0].detail, services.resolveDesktopLocale('en').messages.quitActiveAndScheduledTasks);
});

test('independent projects do not stack native alerts and disposal cancels queued decisions', async () => {
  const decision = Promise.withResolvers(), shown = Promise.withResolvers();
  let count = 0;
  const guard = createOfficialQuitGuard({app: {focus() {}}, dialog: {showMessageBox() {count++; shown.resolve(); return decision.promise}}},
    services, {locale: () => 'en', name: 'Project Desktop'});
  const one = guard.confirm({action: 'close', path: 'a.agent-project', projects: [project(true, false)]});
  const two = guard.confirm({action: 'close', path: 'b.agent-project', projects: [project(true, false)]});
  await shown.promise;
  assert.equal(count, 1);
  guard.dispose(); decision.resolve({response: 0});
  assert.deepEqual(await Promise.all([one, two]), [false, false]);
  assert.equal(count, 1);
});
