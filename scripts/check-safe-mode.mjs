import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareSafeMode, cleanupSafeMode, safeHostEnvironment} from '../src/desktop-adapter/stable/safe-mode.mjs';
import {startProjectHost} from '../src/desktop-adapter/index.mjs';

test('safe Host ignores broken settings, project plugins, credentials and normal project files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-safe-'));
  const normal = join(root, 'normal'); mkdirSync(join(normal, 'dsh'), {recursive: true});
  const settings = join(normal, 'dsh/settings.yaml'); writeFileSync(settings, 'broken: [');
  writeFileSync(join(normal, 'dsh/.credentials.yaml'), 'secret-sentinel');
  const sentinel = join(root, 'keep.txt'); writeFileSync(sentinel, 'keep');
  const temporary = await prepareSafeMode(normal);
  const host = await startProjectHost(temporary);
  try {
    assert.equal(host.result.safeMode, true);
    assert.equal(host.result.projectSessionVersion, null);
    assert.ok(host.result.tools.every(name => !name.startsWith('project_')));
    assert.equal(existsSync(join(host.result.profile, '.project-plugin')), false);
    assert.notEqual((await host.request('/api/project/snapshot')).status, 200);
    assert.doesNotMatch(readFileSync(join(host.result.homeDir, '.credentials.yaml'), 'utf8'), /secret-sentinel/);
    assert.equal(readFileSync(settings, 'utf8'), 'broken: [');
  } finally {await host.close()}
  symlinkSync(sentinel, join(temporary.projectRoot, 'external-link'));
  temporary.cleanup(); assert.equal(existsSync(temporary.stateDirectory), false);
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep'); assert.equal(readFileSync(settings, 'utf8'), 'broken: [');
  await prepareSafeMode(normal); await cleanupSafeMode(normal);
  assert.equal(existsSync(join(normal, 'safe-mode')), false);
  assert.deepEqual(safeHostEnvironment({PATH: '/usr/bin', OPENAI_API_KEY: 'sentinel', NODE_OPTIONS: '--inspect', DSH_HOME: '/wrong', HTTP_PROXY: 'sentinel'}), {PATH: '/usr/bin'});
});
