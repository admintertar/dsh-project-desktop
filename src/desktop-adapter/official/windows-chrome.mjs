/** 官方 main.ts Windows 菜单/外观处理，保留校验与编辑键行为，应用命令来自 Shell。 */
export function installOfficialWindowsChrome({electron, services, window, shortcuts, handle, on, context}) {
  let language;
  const popups = new Map();
  const messages = () => services.resolveDesktopLocale(language ?? context.getLocale()).messages;
  handle('dsh-desktop:windows-menu', (name, x, y) => {
    if ((name !== 'application' && name !== 'edit') || ![x, y].every(value =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100000)) {
      throw new Error('desktop menu: invalid popup request');
    }
    const edit = (key, keyCode, modifiers = ['control'], accelerator) => ({label: messages()[key],
      ...(accelerator ? {accelerator} : {}), click: () => shortcuts.sendEditingKey(keyCode, modifiers)});
    const items = name === 'application' ? context.applicationItems() : [
      edit('undo', 'Z', ['control'], 'Ctrl+Z'), edit('redo', 'Y', ['control'], 'Ctrl+Y'), {type: 'separator'},
      edit('cut', 'X', ['control'], 'Ctrl+X'), edit('copy', 'C', ['control'], 'Ctrl+C'),
      edit('paste', 'V', ['control'], 'Ctrl+V'), edit('delete', 'Delete', []), {type: 'separator'},
      edit('selectAll', 'A', ['control'], 'Ctrl+A'),
    ];
    const zoom = window.webContents.getZoomFactor();
    return new Promise(resolve => {
      const menu = electron.Menu.buildFromTemplate(items);
      const done = () => {popups.delete(menu); resolve()};
      popups.set(menu, done);
      try {menu.popup({window, x: Math.round(x * zoom), y: Math.round(y * zoom), callback: done})}
      catch (error) {popups.delete(menu); throw error}
    });
  });
  on('dsh-desktop:windows-appearance', (nextLanguage, color, symbolColor) => {
    if (typeof nextLanguage === 'string' && /^[a-zA-Z]+(?:-[a-zA-Z0-9]+)*$/u.test(nextLanguage)) language = nextLanguage;
    const validColor = value => typeof value === 'string' && /^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\))$/iu.test(value);
    if (validColor(color) && validColor(symbolColor) && !window.isDestroyed()) window.setTitleBarOverlay({color, symbolColor});
  });
  return () => {
    for (const [menu, done] of popups) {try {menu.closePopup(window)} finally {done()}}
  };
}
