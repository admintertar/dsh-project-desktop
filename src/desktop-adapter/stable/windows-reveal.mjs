import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';

/** Marks our adapter so a re-entrant install cannot wrap the same method twice. */
export const WINDOWS_REVEAL_MARKER = Symbol.for('dsh-project-desktop.windows-reveal');

/**
 * The target handed to `explorer.exe /select,`.
 *
 * Explorer splits its own arguments on commas, so a plain path containing one would be
 * truncated; a file URI also preserves whitespace. The pinned official implementation
 * builds the same target, and this module keeps that decision on purpose.
 */
export function explorerTarget(path) {
  return pathToFileURL(path, {windows: true}).href.replaceAll(',', '%2C');
}

/**
 * Reveal one path in Explorer without hiding the window that gets opened.
 *
 * The pinned official runner executes every native command with `windowsHide: true`. That
 * suits console helpers such as powershell.exe, but explorer.exe is the one command whose
 * own process *is* the window: hiding it creates the revealed window invisible, so the
 * click looks like it did nothing. Explorer opens no console window of its own, so there
 * is nothing to hide here.
 */
export function createWindowsRevealPath({run = execFile} = {}) {
  return (path, signal) => new Promise((resolve, reject) => {
    run('explorer.exe', ['/select,', explorerTarget(path)], {windowsHide: false, signal}, error => {
      // Explorer exits 1 after delegating to the already-running shell process; only a real
      // launch failure may reject, matching the official tolerance.
      if (error && error.code !== 1) {reject(error); return}
      resolve();
    });
  });
}

/**
 * Install the adapter on the Host session controller.
 *
 * `revealPath` is an official internal field rather than a public API, so it is validated
 * before use: a missing field is reported instead of leaving the broken behaviour in place
 * silently. macOS and Linux keep the official implementation, which reveals correctly there.
 * @returns true when the adapter is in place.
 */
export function installRevealAdapter(controller, {platform = process.platform, run = execFile, report = () => {}} = {}) {
  if (typeof controller?.revealPath !== 'function') {
    report('sessionController.revealPath is unavailable; reveal keeps the official behaviour');
    return false;
  }
  if (platform !== 'win32') return false;
  if (controller.revealPath[WINDOWS_REVEAL_MARKER] === true) return true;
  const reveal = createWindowsRevealPath({run});
  Object.defineProperty(reveal, WINDOWS_REVEAL_MARKER, {value: true});
  controller.revealPath = reveal;
  return true;
}
