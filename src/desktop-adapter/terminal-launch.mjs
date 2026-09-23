/**
 * Contract-complete terminal launch for the Shell's own project runtime.
 *
 * The pinned official generator (`openDesktopTerminal`) reads `options.spawn` directly and
 * calls it as its only process launcher: `spawn` is a *required* field of the official
 * `DesktopTerminalOptions` contract, and `onLaunchError` is the only channel through which an
 * asynchronous launcher failure becomes visible. A hand-written runtime that omits them throws
 * `TypeError: options.spawn is not a function` before any console appears, and the official
 * renderer dispatcher neither awaits nor reports the handler
 * (`.upstream/desktop/dsh-plugin-desktop/src/renderer-actions-dispatch.ts`, `case 'terminal'`),
 * so the failure never reaches the user: the menu entry simply does nothing.
 * Measured on 2026-09-23 with the pinned runtime (Electron 43.3.0 / win32): identical options
 * minus `spawn` throw that TypeError, plus `spawn` they launch
 * `cmd.exe /D /S /C launch.cmd` with `windowsHide: true` from the terminal state directory.
 *
 * Keeping the option object complete in one place — and funneling both synchronous throws and
 * `onLaunchError` into the caller's reporter — removes that whole class of silent failure. The
 * companion regression test lives in `tests/terminal-launch.test.mjs`.
 */
import {spawn as spawnProcess} from 'node:child_process';
import {dirname, join} from 'node:path';

/**
 * Runtime-owned paths the generator embeds into the generated terminal shims.
 * @param {{runtimePackage: string, desktopRequire: {resolve: (id: string) => string}}} options
 * @returns {{dshBootstrapPath: string, pnpmBinPath: string}} absolute paths inside the pinned runtime.
 */
export function desktopTerminalPaths({runtimePackage, desktopRequire}) {
  return {dshBootstrapPath: join(runtimePackage, 'lib/desktop-cli.js'),
    pnpmBinPath: join(dirname(desktopRequire.resolve('pnpm')), 'bin/pnpm.mjs')};
}

/**
 * Build the `openTerminal` implementation handed to the project runtime.
 * @param {{openDesktopTerminal: Function, paths: {dshBootstrapPath: string, pnpmBinPath: string},
 *   spawn?: Function, reportFailure: (cause: unknown) => void}} options
 * @returns {(identity: object) => unknown} opener returning the official launch description.
 */
export function createDesktopTerminalOpener({openDesktopTerminal, paths, spawn = spawnProcess, reportFailure}) {
  return function openTerminal(identity) {
    try {
      return openDesktopTerminal({...identity, ...paths, spawn, onLaunchError: cause => {reportFailure(cause)}});
    } catch (cause) {
      reportFailure(cause);
      return undefined;
    }
  };
}
