/**
 * Regression guard for the silent "Open Project Terminal" failure.
 *
 * The pinned official generator requires an injected `spawn`; a runtime that omits it throws
 * `TypeError: options.spawn is not a function`, and the official renderer dispatcher never
 * surfaces that to the user (see `src/desktop-adapter/terminal-launch.mjs`). These tests keep
 * the Shell's opener contract-complete and prove that a missing launcher can no longer pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {existsSync, mkdirSync, mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runtimePackage} from '../src/desktop-adapter/paths.mjs';
import {createDesktopTerminalOpener, desktopTerminalPaths} from '../src/desktop-adapter/terminal-launch.mjs';

const desktopRequire = createRequire(join(runtimePackage, 'package.json'));
const runtimeReady = existsSync(join(runtimePackage, 'lib/desktop-terminal.js'));
// The official generator only owns darwin and win32; on linux it refuses every launch.
const supported = process.platform === 'darwin' || process.platform === 'win32';
const skip = runtimeReady && supported ? false : `pinned runtime and darwin/win32 required (platform ${process.platform})`;

async function loadGenerator() {
  const module = await import(pathToFileURL(join(runtimePackage, 'lib/desktop-terminal.js')).href);
  return module.openDesktopTerminal;
}

function identity() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-terminal-launch-'));
  const profileDir = join(root, 'profile');
  const homeDir = join(root, 'home');
  const stateDir = join(root, 'state');
  for (const dir of [profileDir, homeDir, stateDir]) mkdirSync(dir, {recursive: true});
  return {platform: process.platform, appExecutable: process.execPath, electronVersion: process.versions.electron ?? '43.3.0',
    profileName: 'default', productVersion: '0.1.8', profileDir, homeDir, stateDir};
}

function fakeSpawn(calls) {
  return (command, args, options) => {
    calls.push({command, args, options});
    const child = new EventEmitter();
    child.unref = () => {};
    return child;
  };
}

test('the pinned generator really requires the injected launcher', {skip}, async () => {
  const openDesktopTerminal = await loadGenerator();
  const paths = desktopTerminalPaths({runtimePackage, desktopRequire});
  assert.throws(() => openDesktopTerminal({...identity(), ...paths}), /spawn is not a function/,
    'if this ever stops throwing, the omission that caused the silent menu failure is no longer provable here');
});

test('the shell opener hands the generator a complete option object and launches once', {skip}, async () => {
  const openDesktopTerminal = await loadGenerator();
  const paths = desktopTerminalPaths({runtimePackage, desktopRequire});
  const failures = [];
  const calls = [];
  const openTerminal = createDesktopTerminalOpener({openDesktopTerminal, paths, spawn: fakeSpawn(calls),
    reportFailure: cause => failures.push(cause)});
  const launch = openTerminal(identity());
  assert.deepEqual(failures, [], 'a healthy launch must not report a failure');
  assert.equal(calls.length, 1, 'the official generator must reach the injected launcher exactly once');
  assert.equal(typeof calls[0].command, 'string');
  assert.ok(Array.isArray(calls[0].args) && calls[0].args.length > 0);
  assert.equal(calls[0].options.shell, false);
  assert.equal(typeof launch.welcomePath, 'string');
  assert.ok(existsSync(launch.welcomePath), 'the generated welcome script must exist');
  if (process.platform === 'win32') {
    assert.match(calls[0].command, /cmd\.exe$/i, 'Windows launches through the trusted command processor');
    assert.deepEqual(calls[0].args, ['/D', '/S', '/C', 'launch.cmd']);
    assert.ok(existsSync(launch.windowsLauncherPath));
  }
});

test('both a synchronous throw and an asynchronous launcher error become reported failures', {skip}, async () => {
  const paths = desktopTerminalPaths({runtimePackage, desktopRequire});
  const thrown = [];
  createDesktopTerminalOpener({openDesktopTerminal: () => {throw new Error('generator refused')},
    paths, spawn: fakeSpawn([]), reportFailure: cause => thrown.push(cause)})(identity());
  assert.equal(thrown.length, 1);
  assert.match(thrown[0].message, /generator refused/);

  const openDesktopTerminal = await loadGenerator();
  const asyncFailures = [];
  const child = new EventEmitter();
  child.unref = () => {};
  createDesktopTerminalOpener({openDesktopTerminal, paths, spawn: () => child,
    reportFailure: cause => asyncFailures.push(cause)})(identity());
  child.emit('error', new Error('launcher died'));
  assert.equal(asyncFailures.length, 1, 'an asynchronous launcher failure must stay visible');
  assert.match(asyncFailures[0].message, /launcher died/);
});

test('the terminal paths resolve inside the pinned runtime', {skip}, () => {
  const paths = desktopTerminalPaths({runtimePackage, desktopRequire});
  assert.ok(existsSync(paths.dshBootstrapPath), paths.dshBootstrapPath);
  assert.ok(existsSync(paths.pnpmBinPath), paths.pnpmBinPath);
});
