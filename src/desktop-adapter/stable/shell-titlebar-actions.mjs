/**
 * Shell-owned titlebar actions for project windows.
 *
 * The official renderer bridge (`dsh-desktop:renderer-action`) ends in a pinned
 * official whitelist that only knows terminal / restart / reload / diagnostics
 * (see `.upstream/desktop/dsh-plugin-desktop/src/renderer-actions-dispatch.ts`).
 * Project commands belong to the Shell, so the main process matches its own action
 * names first and only then falls back to the official dispatcher: the official
 * contract stays untouched while the renderer keeps one bridge.
 *
 * Windows has no reachable native menu bar (measured: `GetMenu(hwnd) == 0`,
 * Alt/F10/setMenuBarVisibility all fail), so these actions are what the self-drawn
 * titlebar menu invokes.
 */

/** Action ids owned by the Shell titlebar. */
export const SHELL_TITLEBAR_ACTIONS = Object.freeze({
  title: 'title',
  newProject: 'project-new',
  openProject: 'project-open',
  welcome: 'project-welcome',
  closeProject: 'project-close',
  listRecent: 'recent-list',
  openRecent: 'recent-open',
  edit: 'edit',
  view: 'view',
  profile: 'profile',
  restart: 'restart',
  safeMode: 'safe-mode',
  recover: 'recover',
  about: 'about',
  listContributions: 'contributions',
  invokeContribution: 'contribution',
});

const EDIT_COMMANDS = Object.freeze(['undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll']);
const VIEW_COMMANDS = Object.freeze(['reload', 'developerTools', 'zoomIn', 'zoomOut', 'zoomReset', 'fullscreen']);
const REQUIRED_TARGET = Object.freeze([SHELL_TITLEBAR_ACTIONS.openRecent, SHELL_TITLEBAR_ACTIONS.invokeContribution]);

/** Requests carry a marker so they can never collide with the official string actions. */
export const SHELL_TITLEBAR_REQUEST = 'shell-titlebar';

/**
 * Read a Shell titlebar request out of a renderer payload.
 * @param {unknown} payload - whatever the renderer bridge received.
 * @returns {{action: string, argument: unknown}|null} the request, or null for official actions.
 */
export function shellTitlebarRequest(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.type !== SHELL_TITLEBAR_REQUEST) return null;
  if (!Object.values(SHELL_TITLEBAR_ACTIONS).includes(payload.action)) return null;
  return {action: payload.action, argument: payload.argument ?? null};
}

/**
 * Build the runner for the titlebar actions.
 * @param {Record<string, Function>} handlers - one implementation per action id.
 * @returns {(action: string, argument?: unknown) => Promise<unknown>} resolving to the action result.
 */
export function createShellTitlebarActionRunner(handlers) {
  return async function run(action, argument) {
    if (REQUIRED_TARGET.includes(action) && (typeof argument !== 'string' || !argument)) {
      throw new Error(`Shell titlebar: ${action} requires a target`);
    }
    switch (action) {
      case SHELL_TITLEBAR_ACTIONS.edit:
        if (!EDIT_COMMANDS.includes(argument)) throw new Error(`Shell titlebar: unsupported edit command ${JSON.stringify(argument)}`);
        return handlers.edit(argument);
      case SHELL_TITLEBAR_ACTIONS.view:
        if (!VIEW_COMMANDS.includes(argument)) throw new Error(`Shell titlebar: unsupported view command ${JSON.stringify(argument)}`);
        return handlers.view(argument);
      case SHELL_TITLEBAR_ACTIONS.invokeContribution:
        return handlers[SHELL_TITLEBAR_ACTIONS.invokeContribution](argument);
      default:
        if (!Object.values(SHELL_TITLEBAR_ACTIONS).includes(action)) throw new Error(`Shell titlebar: unsupported action ${JSON.stringify(action)}`);
        if (typeof handlers[action] !== 'function') throw new Error(`Shell titlebar: ${action} is not available in this window`);
        return handlers[action](argument);
    }
  };
}
