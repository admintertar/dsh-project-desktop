import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDesktop} from '../src/desktop-adapter/stable/modules.mjs';
import {verifyRuntimeDependencies} from '../src/desktop-adapter/stable/verify.mjs';
import {productVersion} from '../src/app/product.mjs';

// A build number that satisfies the official Windows Mica gate.
const SUPPORTED_BUILD = 26_200;
// The build number Microsoft reports on Windows 10, which intentionally fails it.
const UNSUPPORTED_BUILD = 19_045;

verifyRuntimeDependencies();

/**
 * The project shell replaces the official Electron Desktop runtime with its own
 * plain object, so the capability fields that object carries are a contract with
 * pinned official code. Dropping one is not a type error: it silently gates the
 * feature off, which is how project windows lost the Mica option. These tests
 * cover the half of that chain the shell owns; the renderer half
 * (`dsh-desktop-mica` -> `micaSupported`) is covered by the pinned Desktop's own
 * `tests/client-environment.spec.ts`.
 */
const updates = {isPackaged: false, canDownload: false, currentVersion: productVersion};

/** Exactly what openNativeProject hands to startProjectHost as nativeRuntime. */
function shellRuntime({platform = 'win32', windowsBuild} = {}) {
  return {platform, ...(windowsBuild === undefined ? {} : {windowsBuild}), locale: 'en', updates};
}

test('the Windows build capability survives the Host snapshot made from our own runtime object', async () => {
  const {runtimeSnapshot} = await loadDesktop('host-runtime-bridge');
  const snapshot = runtimeSnapshot(shellRuntime({windowsBuild: SUPPORTED_BUILD}));
  assert.equal(snapshot.platform, 'win32');
  assert.equal(snapshot.windowsBuild, SUPPORTED_BUILD);
});

test('the renderer capability marker follows the snapshotted build number', async () => {
  const {runtimeSnapshot} = await loadDesktop('host-runtime-bridge');
  const {desktopRendererUrl} = await loadDesktop('index');
  const url = build => new URL(desktopRendererUrl(4310, 'advanced', 'win32', productVersion, 'off',
    runtimeSnapshot(shellRuntime({windowsBuild: build})).windowsBuild));
  // shell-host.mjs passes runtime.windowsBuild into this same URL builder.
  assert.equal(url(SUPPORTED_BUILD).searchParams.get('dsh-desktop-mica'), '1');
  assert.equal(url(UNSUPPORTED_BUILD).searchParams.get('dsh-desktop-mica'), '0');
  // macOS publishes no Mica marker at all.
  assert.equal(new URL(desktopRendererUrl(4310, 'advanced', 'darwin', productVersion, 'transparent')).searchParams.has('dsh-desktop-mica'), false);
});

test('a lost capability field degrades silently instead of announcing itself', async () => {
  const {runtimeSnapshot} = await loadDesktop('host-runtime-bridge');
  // No exception, no console warning: the value is simply absent.
  assert.equal(runtimeSnapshot(shellRuntime()).windowsBuild, undefined);
  // A persisted Mica preference is then read back as the opaque fallback, so the
  // material would not have applied even when the setting is written by hand.
  const {effectiveDesktopWindowMaterial} = await loadDesktop('window-material');
  assert.equal(effectiveDesktopWindowMaterial('advanced', 'win32', 'transparent', 'mica', undefined), 'off');
  assert.equal(effectiveDesktopWindowMaterial('advanced', 'win32', 'transparent', 'mica', SUPPORTED_BUILD), 'mica');
});

/**
 * The runtime object above is a plain object built by the shell, and nothing in
 * the build or the type system checks it against `DesktopRuntime`; the only other
 * guard is a native restart check that cannot run headlessly. Read the module as
 * text so dropping the field fails here instead of silently in the settings menu.
 */
test('the shell runtime object literal carries windowsBuild from the official capability probe', async () => {
  const {readFile} = await import('node:fs/promises');
  const native = await readFile(new URL('../src/desktop-adapter/native.mjs', import.meta.url), 'utf8');
  assert.match(native, /const runtime = \{[^}]*windowsBuild:/,
    'openNativeProject must publish windowsBuild on its runtime object');
  assert.match(native, /const \{windowsBuildNumber\} = await loadDesktop\('window-material'\)/,
    'windowsBuild must come from the pinned official probe, not a hardcoded build number');
});
