import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditLinks, isWithin} from '../scripts/package-common.mjs';
import {packagingPlan} from '../scripts/ci-plan.mjs';
import {safeHostEnvironment} from '../src/desktop-adapter/stable/safe-mode.mjs';
import {copyProductionDependencies} from '../scripts/package-dependencies.mjs';

test('production staging preserves nested and optional runtime dependencies and licenses, without development tools or native build outputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'project-production-'));
  const modules = join(root, 'input/node_modules');
  function pkg(path, manifest) {
    mkdirSync(path, {recursive: true});
    writeFileSync(join(path, 'package.json'), JSON.stringify({version: '1.0.0', ...manifest}));
    writeFileSync(join(path, 'index.js'), 'export default 1');
    writeFileSync(join(path, 'LICENSE'), 'fixture license');
    mkdirSync(join(path, 'tests')); writeFileSync(join(path, 'tests/test.js'), 'test fixture');
  }
  try {
    pkg(join(modules, 'runtime'), {name: 'runtime', dependencies: {nested: '1.0.0'}, optionalDependencies: {optional: '1.0.0', absent: '1.0.0'}});
    pkg(join(modules, 'runtime/node_modules/nested'), {name: 'nested'});
    pkg(join(modules, 'nested'), {name: 'nested', version: '2.0.0'});
    pkg(join(modules, 'optional'), {name: 'optional'});
    pkg(join(modules, 'dev-tool'), {name: 'dev-tool'});
    pkg(join(modules, 'fs-ext'), {name: 'fs-ext'});
    for (const arch of ['arm64', 'x64']) {
      mkdirSync(join(modules, 'fs-ext/prebuilds', 'darwin-' + arch), {recursive: true});
      writeFileSync(join(modules, 'fs-ext/prebuilds', 'darwin-' + arch, 'binding.node'), 'native fixture');
    }
    mkdirSync(join(modules, 'fs-ext/build/Release'), {recursive: true});
    writeFileSync(join(modules, 'fs-ext/build/Release/fs_ext.node'), 'host binding');
    const manifest = {name: 'fixture', version: '1.0.0', dependencies: {runtime: '1.0.0', nested: '2.0.0', 'fs-ext': '1.0.0'}, devDependencies: {'dev-tool': '1.0.0'}};
    for (const flatCache of [false, true]) {
      const destination = join(root, 'output-' + flatCache);
      const result = await copyProductionDependencies({manifest, modules, scratch: join(root, 'collect-' + flatCache), destination, flatCache});
      assert.ok(result.bytes > 0);
      assert.equal(existsSync(join(destination, 'dev-tool')), false);
      assert.equal(existsSync(join(destination, 'runtime/tests')), false);
      assert.equal(readFileSync(join(destination, 'runtime/LICENSE'), 'utf8'), 'fixture license');
      assert.equal(JSON.parse(readFileSync(join(destination, 'runtime/node_modules/nested/package.json'))).version, '1.0.0');
      assert.equal(JSON.parse(readFileSync(join(destination, 'nested/package.json'))).version, '2.0.0');
      assert.equal(existsSync(join(destination, 'optional/package.json')), true);
      assert.equal(existsSync(join(destination, 'fs-ext/build/Release/fs_ext.node')), false);
      for (const arch of ['arm64', 'x64']) assert.equal(existsSync(join(destination, 'fs-ext/prebuilds', 'darwin-' + arch, 'binding.node')), true);
    }
    await assert.rejects(copyProductionDependencies({manifest: {...manifest, dependencies: {missing: '1.0.0'}}, modules,
      scratch: join(root, 'missing'), destination: join(root, 'missing-output')}), /Production dependency missing/);
  } finally {rmSync(root, {recursive: true, force: true})}
});

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
  assert.equal(JSON.parse(packagingPlan(lock, '0.1.0').matrix).include.length, 2);
  assert.deepEqual(JSON.parse(packagingPlan(lock, '0.1.0', 'win').matrix).include.map(item => item.target), ['win-x64']);
  assert.deepEqual(JSON.parse(packagingPlan(lock, '0.1.0', 'mac', 'refs/tags/v0.1.0').matrix).include.map(item => item.target), ['mac-universal']);
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
