import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditLinks, isWithin} from '../scripts/package-common.mjs';
import {packagingPlan} from '../scripts/ci-plan.mjs';
import {safeHostEnvironment} from '../src/desktop-adapter/stable/safe-mode.mjs';

test('packaging rejects escaping, absolute and dangling links, including chained escapes', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-package-links-'));
  try {
    const payload = join(root, 'payload'); mkdirSync(payload);
    writeFileSync(join(payload, 'inside'), 'inside'); writeFileSync(join(root, 'outside'), 'outside');
    const link = join(payload, 'link'); symlinkSync('inside', link, 'file');
    assert.equal(auditLinks(payload), 1); unlinkSync(link);
    symlinkSync(join(payload, 'inside'), link, 'file');
    assert.throws(() => auditLinks(payload), /Non-relocatable/);
    assert.equal(auditLinks(payload, {allowAbsolute: true}), 1); unlinkSync(link);
    symlinkSync('../outside', link, 'file'); symlinkSync('link', join(payload, 'chain'), 'file');
    assert.throws(() => auditLinks(payload, {allowAbsolute: true}), /Non-relocatable/);
    unlinkSync(link); assert.throws(() => auditLinks(payload), /Non-relocatable/);
    assert.equal(isWithin(payload, join(root, 'payload-other/file')), false);
  } finally {rmSync(root, {recursive: true, force: true})}
});

test('CI resolves only stable pinned repositories and rejects mismatched version tags', () => {
  const lock = JSON.parse(readFileSync(new URL('../upstream.lock.json', import.meta.url), 'utf8'));
  assert.equal(JSON.parse(packagingPlan(lock, '0.1.0').matrix).include.length, 3);
  assert.deepEqual(JSON.parse(packagingPlan(lock, '0.1.0', 'win').matrix).include.map(item => item.target), ['win-x64']);
  assert.equal(JSON.parse(packagingPlan(lock, '0.1.0', 'mac', 'refs/tags/v0.1.0').matrix).include.length, 2);
  assert.throws(() => packagingPlan(lock, '0.1.0', 'all', 'refs/tags/v0.2.0'), /tag must match/);
  assert.throws(() => packagingPlan({...lock, channel: 'beta'}, '0.1.0'), /Only stable/);
  assert.throws(() => packagingPlan({...lock, project: {...lock.project, commit: 'master'}}, '0.1.0'), /full commit/);
  assert.throws(() => packagingPlan({...lock, project: {...lock.project, repository: '../private'}}, '0.1.0'), /public GitHub/);
});

test('Windows safe mode keeps case-insensitive process essentials without inheriting credentials', () => {
  assert.deepEqual(safeHostEnvironment({Path: 'C:\\Windows', PATHEXT: '.EXE;.CMD', USERPROFILE: 'C:\\Users\\runner',
    SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\runner\\AppData\\Roaming', OPENAI_API_KEY: 'secret',
    NODE_OPTIONS: '--inspect', DSH_HOME: 'wrong', HTTP_PROXY: 'secret'}, 'win32'),
  {Path: 'C:\\Windows', PATHEXT: '.EXE;.CMD', USERPROFILE: 'C:\\Users\\runner', SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\runner\\AppData\\Roaming'});
});
