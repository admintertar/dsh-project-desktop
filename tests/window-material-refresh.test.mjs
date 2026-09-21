import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createWindowMaterialRefresher} from '../src/windows/window-material-refresh.mjs';

function fixture({material = 'mica', destroyed = false, window = true} = {}) {
  const calls = [];
  const refresher = createWindowMaterialRefresher({
    strategy: {refreshThemeMaterial: (target, value) => calls.push([target, value])},
    getWindow: () => (window ? {isDestroyed: () => destroyed} : undefined),
    // null stands for "the window specification does not exist yet".
    getMaterial: () => material ?? undefined,
  });
  return {calls, refresher};
}

test('re-applies the active material so Windows recomposes its backdrop palette', () => {
  const {calls, refresher} = fixture({material: 'mica'});
  refresher();
  assert.deepEqual(calls.map(call => call[1]), ['mica']);
});

test('stays silent when the specification, the window or the window lifetime is not there yet', () => {
  const beforeSpecification = fixture({material: null});
  beforeSpecification.refresher();
  assert.deepEqual(beforeSpecification.calls, [], 'no specification means no material to apply');
  const beforeWindow = fixture({window: false});
  beforeWindow.refresher();
  assert.deepEqual(beforeWindow.calls, [], 'the window may not exist yet when the theme hook fires');
  const destroyed = fixture({window: true, destroyed: true});
  destroyed.refresher();
  assert.deepEqual(destroyed.calls, [], 'a destroyed window must not be touched');
});

test('passes the effective material through unchanged, including the opaque fallback', () => {
  for (const material of ['off', 'transparent', 'mica']) {
    const {calls, refresher} = fixture({material});
    refresher();
    assert.deepEqual(calls.map(call => call[1]), [material]);
  }
});

/**
 * The behaviour above is only reachable when the shell's theme hook and the first
 * on-screen composition keep calling the refresher. Without them the sidebar keeps
 * the previous DWM palette after a theme change, which is how it stayed dark under
 * a light theme; the pinned official runtime performs the same step.
 */
test('the project window keeps wiring the refresher to the theme hook and the first show', async () => {
  const native = await readFile(new URL('../src/desktop-adapter/native.mjs', import.meta.url), 'utf8');
  assert.match(native, /setThemeSource\(\) \{refreshWindowMaterial\(\)\}/,
    'the theme hook must re-apply the material instead of being a no-op');
  assert.match(native, /window\.once\('show', refreshWindowMaterial\)/,
    'the first composition must re-apply the material');
});
