/**
 * Window-level accelerators for the three File commands.
 *
 * Why this exists: our Windows windows are created with `titleBarStyle: 'hidden'`
 * plus `titleBarOverlay`, and on that window shape no native menu bar can be
 * displayed at all — not merely auto-hidden. Measured on Windows (Electron 43.3.0):
 * `isMenuBarVisible()` stays false, Left Alt / F10 / `setMenuBarVisibility(true)` /
 * `setAutoHideMenuBar(false)` / `win.setMenu(appMenu)` all fail, and the real product
 * windows report `GetMenu(hwnd) == 0` from outside. Evidence lives in the task record
 * `Windows 菜单入口可达性…/artifacts/evidence/README.md`.
 *
 * Consequences encoded here:
 * - the application menu cannot be where those commands are reachable on Windows, and
 *   the pinned official Windows strategy calls `window.removeMenu()`, after which the
 *   application menu's accelerators stop firing entirely (measured);
 * - binding the three shortcuts per window keeps them alive independently of the menu,
 *   which is the same approach the official runtime uses for the zoom keys;
 * - macOS keeps its menu-bar semantics untouched, so this layer never installs there.
 */

/** Command identifiers for the window-level bindings. */
export const WINDOW_ACCELERATOR_COMMANDS = Object.freeze({newProject: 'new-project', openProject: 'open-project', closeProject: 'close-project'});

/**
 * Map one `before-input-event` payload to a File command.
 * @param {{type?: string, key?: string, control?: boolean, shift?: boolean, alt?: boolean, meta?: boolean, isAutoRepeat?: boolean}} input
 * @returns {string|null} command id, or null when the chord is not ours.
 */
export function matchWindowAccelerator(input) {
  if (!input || input.type !== 'keyDown' || input.isAutoRepeat === true) return null;
  if (input.control !== true || input.alt === true || input.meta === true) return null;
  const key = typeof input.key === 'string' ? input.key.toLowerCase() : '';
  if (key === 'n' && input.shift === true) return WINDOW_ACCELERATOR_COMMANDS.newProject;
  if (key === 'o' && input.shift !== true) return WINDOW_ACCELERATOR_COMMANDS.openProject;
  if (key === 'w' && input.shift !== true) return WINDOW_ACCELERATOR_COMMANDS.closeProject;
  return null;
}

/**
 * Install the window-level bindings on every current and future window.
 * @param {{app: {on: Function}, BrowserWindow: {getAllWindows: Function}, run: (command: string, window: unknown) => void, platform?: string}} options
 * @returns {(window: unknown) => void} the attach function, for tests and explicit wiring.
 */
export function installWindowAccelerators({app, BrowserWindow, run, platform = process.platform}) {
  if (platform !== 'win32') return () => {};
  const attached = new WeakSet();
  const attach = window => {
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed()) || attached.has(window)) return;
    attached.add(window);
    window.webContents.on('before-input-event', (event, input) => {
      const command = matchWindowAccelerator(input);
      if (!command) return;
      event.preventDefault();
      run(command, window);
    });
  };
  app.on('browser-window-created', (_event, window) => attach(window));
  for (const window of BrowserWindow.getAllWindows()) attach(window);
  return attach;
}
