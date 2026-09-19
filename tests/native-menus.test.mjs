import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeRoleMenus} from '../src/app/native-menus.mjs';

test('every native command has an explicit translated label and keeps its role', () => {
  const flatten = item => Array.isArray(item) ? item.flatMap(flatten) : item && typeof item === 'object'
    ? [item, ...Object.values(item).filter(value => typeof value === 'object').flatMap(flatten)] : [];
  const en = flatten(nativeRoleMenus('en', 'darwin')).filter(item => item.role);
  const zh = flatten(nativeRoleMenus('zh', 'darwin')).filter(item => item.role);
  assert.deepEqual(en.map(item => item.role), zh.map(item => item.role));
  assert.ok(zh.length > 20);
  for (const item of zh) assert.match(item.label, /[\u4e00-\u9fff]/, item.role);
  assert.equal(zh.find(item => item.role === 'quit').label, '退出 DSH Project Desktop');
  assert.equal(en.find(item => item.role === 'services').label, 'Services');
});
