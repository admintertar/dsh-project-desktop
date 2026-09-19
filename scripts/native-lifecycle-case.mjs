import assert from 'node:assert/strict';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {createProjectInDirectory} from '../src/app/project-files.mjs';

export async function runLifecycleCase({electron, open, close, showGuide, projects, userData, workspace, session, hasGuide}) {
  const phase = process.env.DSH_PROJECT_DESKTOP_TEST_PHASE;
  const manifests = await Promise.all(['Alpha', 'Bravo'].map(name => {
    const folder = join(userData, 'fixtures', name); mkdirSync(folder, {recursive: true}); return createProjectInDirectory(folder);
  }));
  if (phase === 'seed') {
    assert.equal(projects.size, 0); assert.ok(hasGuide());
    const [alpha] = await Promise.all(manifests.map(open));
    alpha.window.setBounds({x: 80, y: 80, width: 960, height: 700});
    assert.equal(session.list().length, 2);
  } else if (phase === 'restore-two') {
    assert.equal(projects.size, 2); assert.equal(hasGuide(), false, 'no welcome flash on successful startup');
    assert.equal(projects.get(manifests[0]).window.getNormalBounds().width, 960);
    await new Promise((resolve, reject) => {
      const second = spawn(process.execPath, [repository, '--lifecycle-test'], {env: {...process.env}, stdio: 'pipe'});
      const timeout = setTimeout(() => {second.kill(); reject(new Error('Second instance did not yield to the running application'))}, 15000);
      second.on('error', error => {clearTimeout(timeout); reject(error)});
      second.on('exit', code => {clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Second instance exited ${code}`))});
    });
    assert.equal(hasGuide(), false, 'second launch activates a project');
    await close(manifests[0]); assert.equal(session.list().length, 1);
  } else if (phase === 'restore-one') {
    assert.deepEqual([...projects.keys()], [manifests[1]]); assert.equal(hasGuide(), false);
    await close(manifests[1]); assert.equal(session.list().length, 0); assert.ok(hasGuide());
  } else if (phase === 'empty-history') {
    assert.equal(projects.size, 0); assert.ok(hasGuide());
    const guide = await showGuide();
    const deadline = Date.now() + 5000;
    while (!(await guide.webContents.executeJavaScript(`document.querySelectorAll('.recentItem').length === 2`))) {
      if (Date.now() > deadline) throw new Error('Recent history missing after close-all'); await new Promise(resolve => setTimeout(resolve, 50));
    }
    session.update(join(userData, 'missing.agent-project'), {title: 'Missing', phase: 'open'});
    await open(manifests[1]);
  } else if (phase === 'partial-failure') {
    assert.deepEqual([...projects.keys()], [manifests[1]]); assert.ok(hasGuide());
    assert.equal(workspace.failures().length, 1);
    await close(join(userData, 'missing.agent-project'));
    await close(manifests[1]);
  } else if (phase === 'safe-quit') {
    await open(manifests[0]); const safe = await workspace.safeMode(manifests[0]);
    writeFileSync(join(userData, 'safe-path.json'), JSON.stringify(safe.host.stateDirectory));
    assert.equal(session.get(manifests[0]).phase, 'failed');
  } else if (['safe-relaunch', 'safe-cleanup'].includes(phase)) {
    assert.equal(projects.size, 0); assert.ok(hasGuide());
    assert.equal(existsSync(JSON.parse(readFileSync(join(userData, 'safe-path.json')))), false);
    assert.equal(session.get(manifests[0]).phase, 'failed');
    if (phase === 'safe-cleanup') {await open(manifests[0]); await close(manifests[0])}
  } else if (phase === 'safe-abandon') {
    const safe = await workspace.safeMode(manifests[0]);
    writeFileSync(join(userData, 'safe-path.json'), JSON.stringify(safe.host.stateDirectory));
  } else throw new Error('Unknown lifecycle test phase');
  writeFileSync(join(userData, `${phase}.json`), JSON.stringify({ok: true, phase, openProjects: projects.size, welcome: hasGuide()}, null, 2));
  console.log('Lifecycle passed:', phase);
  if (phase === 'safe-abandon') electron.app.exit(0); // Deliberately skip the normal shutdown handler in this fixture.
}
