/**
 * Native smoke for the self-drawn titlebar menu.
 *
 * Windows can never show a native menu bar on the Shell's window shape
 * (`GetMenu(hwnd) == 0`, Alt/F10/setMenuBarVisibility all fail), so the File/Edit/View/Project
 * Tools menus live in a titlebar the Shell draws itself. Those menus are the only reachable
 * entry point for the project commands, which makes "does the menu open, and does it show what
 * the mac menu shows" worth a mechanical check: the failure mode of a broken entry is a menu
 * that opens and does nothing, not a crash.
 *
 * This check drives the real renderer of an open project window and asserts the DOM the user
 * sees. It deliberately does not click "Open Project Terminal": that would launch a real
 * interactive console which the smoke run would then leave behind. The launch itself is covered
 * by the contract test (`tests/terminal-launch.test.mjs`) and by native visual acceptance.
 */
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const DARWIN_SKIP = process.platform === 'darwin';

/**
 * Observe which View-menu accelerators this window actually honours.
 *
 * The pinned Windows strategy removes the native menu bar, and the Shell's accelerator notes
 * record that the application menu's accelerators stop firing after that — but a printed
 * accelerator is a promise to the user, so the claim is measured rather than assumed. The
 * observation runs last and restores every state it touches.
 * @param {any} project - an open project resource from the smoke harness.
 * @returns {Promise<{fullScreen: boolean, zoomIn: number, zoomReset: number, devTools: boolean, reloads: number}>}
 */
async function observeViewAccelerators(project) {
  const contents = project.window.webContents;
  const press = (keyCode, modifiers = []) => {
    contents.sendInputEvent({type: 'keyDown', keyCode, modifiers});
    contents.sendInputEvent({type: 'keyUp', keyCode, modifiers});
  };
  press('F11');
  await delay(300);
  const fullScreen = project.window.isFullScreen();
  if (fullScreen) {press('F11'); await delay(300)}

  press('=', ['control']); press('=', ['control']);
  await delay(300);
  const zoomIn = contents.getZoomLevel();
  press('0', ['control']);
  await delay(300);
  const zoomReset = contents.getZoomLevel();

  press('I', ['control', 'shift']);
  await delay(400);
  const devTools = contents.isDevToolsOpened();
  if (devTools) {press('I', ['control', 'shift']); await delay(400)}

  let reloads = 0;
  const count = () => {reloads += 1};
  contents.on('did-finish-load', count);
  press('R', ['control']);
  await delay(600);
  contents.off('did-finish-load', count);
  return {fullScreen, zoomIn, zoomReset, devTools, reloads};
}

/**
 * Read one probe expression inside the project renderer.
 * @param {any} project - an open project resource from the smoke harness.
 * @param {string} body - JavaScript statements returning the probe result.
 * @returns {Promise<any>} the value produced inside the renderer.
 */
function probe(project, body) {
  return project.window.webContents.executeJavaScript(`(async () => {
    const text = element => (element?.textContent ?? '').trim();
    const buttons = () => [...document.querySelectorAll('.dshShellTitlebarButton')];
    const button = label => buttons().find(item => text(item) === label);
    const items = () => [...document.querySelectorAll('.dshShellMenuItem')].map(item => ({
      label: text(item.querySelector('.dshShellMenuItemLabel')),
      shortcut: text(item.querySelector('.dshShellMenuItemShortcut'))}));
    const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    ${body}
  })()`);
}

/**
 * Read the titlebar's own labels after the app locale changed.
 *
 * The titlebar detects its language from the document when it mounts, so a locale switch made in
 * the running app is exactly the case where stale text would go unnoticed by a fresh-window check.
 * @param {any} project - an open project resource from the smoke harness.
 * @returns {Promise<{lang: string, menus: string[]}|null>} the document language and menu labels.
 */
export async function readTitlebarLocale(project) {
  if (DARWIN_SKIP) return null;
  return await probe(project, `return {lang: document.documentElement.lang, menus: buttons().map(text)};`);
}

/**
 * Assert that the self-drawn titlebar follows a live application-language switch.
 *
 * macOS draws the official application menu instead of the Shell titlebar, so there is no
 * titlebar language to read there and this check only applies where the menus are self-drawn.
 * The locale switch happens in the running app on purpose: the titlebar reads its language when
 * it mounts, which is exactly when stale text would go unnoticed by a fresh-window check.
 * @param {{project: any}} options - one open project resource, after the app locale changed.
 */
export async function checkTitlebarLocale({project}) {
  if (DARWIN_SKIP) return;
  const deadline = Date.now() + 5000;
  let state = await readTitlebarLocale(project);
  while (!state.menus.some(label => /Project Tools/u.test(label)) && Date.now() < deadline) {
    await delay(100);
    state = await readTitlebarLocale(project);
  }
  assert.ok(state.menus.some(label => /Project Tools/u.test(label)),
    `the self-drawn titlebar must follow the app language: ${JSON.stringify(state)}`);
}

/**
 * Assert that the self-drawn titlebar opens its menus and shows the expected entries.
 * @param {{project: any}} options - one open project resource.
 */
export async function checkTitlebarMenus({project}) {
  if (DARWIN_SKIP) return;
  const bar = await probe(project, `return {present: Boolean(document.querySelector('.dshShellTitlebar')),
    menus: buttons().map(text)};`);
  assert.equal(bar.present, true, 'the self-drawn titlebar must be registered in the project window');
  const tools = bar.menus.find(label => /项目工具|Project Tools/.test(label));
  const edit = bar.menus.find(label => /编辑|Edit/.test(label));
  assert.ok(tools, `titlebar menus: ${JSON.stringify(bar.menus)}`);
  assert.ok(edit, `titlebar menus: ${JSON.stringify(bar.menus)}`);

  const toolsMenu = await probe(project, `
    button(${JSON.stringify(tools)}).click();
    await settle();
    return {open: Boolean(document.querySelector('.dshShellTitlebarMenu')), items: items()};`);
  assert.equal(toolsMenu.open, true, 'clicking 项目工具 must open its menu');
  const terminal = toolsMenu.items.find(item => /打开项目终端|Open Project Terminal/.test(item.label));
  assert.ok(terminal, `project tools menu items: ${JSON.stringify(toolsMenu.items)}`);
  assert.equal(terminal.shortcut, '', 'the terminal entry has no accelerator in the official menu either');

  const editMenu = await probe(project, `
    button(${JSON.stringify(edit)}).click();
    await settle();
    return {items: items()};`);
  const shortcuts = Object.fromEntries(editMenu.items.map(item => [item.label, item.shortcut]));
  // Electron's own accelerators for these roles on Windows/Linux; the native menu bar that would
  // normally print them is unreachable here, so the titlebar has to spell them out.
  for (const [label, expected] of Object.entries({'撤销': 'Ctrl+Z', 'Undo': 'Ctrl+Z', '重做': 'Ctrl+Y', 'Redo': 'Ctrl+Y',
    '剪切': 'Ctrl+X', 'Cut': 'Ctrl+X', '复制': 'Ctrl+C', 'Copy': 'Ctrl+C', '粘贴': 'Ctrl+V', 'Paste': 'Ctrl+V',
    '全选': 'Ctrl+A', 'Select All': 'Ctrl+A'})) {
    if (label in shortcuts) assert.equal(shortcuts[label], expected, `edit menu shortcut for ${label}`);
  }
  const shown = Object.values(shortcuts).filter(Boolean);
  assert.equal(shown.length, Object.keys(shortcuts).length,
    `every edit entry must show its accelerator: ${JSON.stringify(editMenu.items)}`);

  const closed = await probe(project, `
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await settle();
    return Boolean(document.querySelector('.dshShellTitlebarMenu'));`);
  assert.equal(closed, false, 'Escape must close the titlebar menu');

  // The printed accelerators are a promise, and the promise is not free: the pinned Windows
  // strategy removes the native menu bar, so Electron's own role accelerators cannot be assumed
  // to fire in this window. Drive the real key path through Chromium and read the selection back.
  project.focus();
  await probe(project, `const input = document.createElement('input');
    input.id = 'dshTitlebarAcceleratorProbe'; input.value = 'probe'; document.body.append(input); input.focus(); return true;`);
  project.window.webContents.sendInputEvent({type: 'keyDown', keyCode: 'A', modifiers: ['control']});
  project.window.webContents.sendInputEvent({type: 'keyUp', keyCode: 'A', modifiers: ['control']});
  await new Promise(resolve => setTimeout(resolve, 200));
  const selection = await probe(project, `const input = document.getElementById('dshTitlebarAcceleratorProbe');
    if (!input) return null;
    const value = {start: input.selectionStart, end: input.selectionEnd, length: input.value.length};
    input.remove(); return value;`);
  assert.deepEqual(selection, {start: 0, end: 5, length: 5},
    'Ctrl+A must reach the focused editor, or the printed accelerator is a false promise');

  // The View menu prints no shortcut text today. Record what this window really honours so the
  // decision to print (or to install window-level bindings first) rests on a measurement.
  console.log('titlebar view accelerators:', JSON.stringify(await observeViewAccelerators(project)));
}
