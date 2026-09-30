import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDesktop} from '../src/desktop-adapter/stable/modules.mjs';
import {productVersion} from '../src/app/product.mjs';

// Desktop 2.0.15 removed Windows backdrops and the build-number capability.
// Existing Profiles still accept old settings but must resolve them to opaque.
test('legacy Windows materials boot as opaque without publishing a Mica capability', async () => {
  const {parseWindowsWindowMaterial, effectiveDesktopWindowMaterial} = await loadDesktop('window-material');
  const {desktopRendererUrl} = await loadDesktop('index');
  for (const legacy of [undefined, 'off', 'acrylic', 'mica']) {
    assert.equal(parseWindowsWindowMaterial(legacy), 'off');
    const material = effectiveDesktopWindowMaterial('advanced', 'win32', 'transparent');
    assert.equal(material, 'off');
    const url = new URL(desktopRendererUrl(4310, 'advanced', 'win32', productVersion, material));
    assert.equal(url.searchParams.get('dsh-desktop-material'), 'off');
    assert.equal(url.searchParams.has('dsh-desktop-mica'), false);
  }
  assert.throws(() => parseWindowsWindowMaterial('invalid'));
});

test('macOS transparent and solid preferences retain their native material contract', async () => {
  const {effectiveDesktopWindowMaterial} = await loadDesktop('window-material');
  for (const preference of ['off', 'transparent']) {
    assert.equal(effectiveDesktopWindowMaterial('advanced', 'darwin', preference), preference);
  }
});
