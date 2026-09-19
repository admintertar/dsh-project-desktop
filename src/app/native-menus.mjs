/** Explicit labels are necessary: Electron's role defaults follow the OS locale. */
export function nativeRoleMenus(locale, platform = process.platform, product = 'DSH Project Desktop') {
  const zh = locale === 'zh';
  const role = (role, chinese, english) => ({role, label: zh ? chinese : english});
  const separator = {type: 'separator'};
  return {
    application: platform === 'darwin' ? [{label: product, submenu: [
      role('about', `关于 ${product}`, `About ${product}`), separator,
      {...role('services', '服务', 'Services'), submenu: []}, separator,
      role('hide', `隐藏 ${product}`, `Hide ${product}`), role('hideOthers', '隐藏其他应用', 'Hide Others'),
      role('unhide', '显示全部', 'Show All'), separator, role('quit', `退出 ${product}`, `Quit ${product}`),
    ]}] : [],
    edit: {label: zh ? '编辑' : 'Edit', submenu: [
      role('undo', '撤销', 'Undo'), role('redo', '重做', 'Redo'), separator,
      role('cut', '剪切', 'Cut'), role('copy', '复制', 'Copy'), role('paste', '粘贴', 'Paste'),
      role('pasteAndMatchStyle', '粘贴并匹配样式', 'Paste and Match Style'), role('delete', '删除', 'Delete'),
      role('selectAll', '全选', 'Select All'),
    ]},
    view: {label: zh ? '视图' : 'View', submenu: [
      role('reload', '重新加载', 'Reload'), role('toggleDevTools', '切换开发者工具', 'Toggle Developer Tools'), separator,
      role('resetZoom', '实际大小', 'Actual Size'), role('zoomIn', '放大', 'Zoom In'), role('zoomOut', '缩小', 'Zoom Out'),
      separator, role('togglefullscreen', '切换全屏', 'Toggle Full Screen'),
    ]},
    window: {role: 'windowMenu', label: zh ? '窗口' : 'Window', submenu: [
      role('minimize', '最小化', 'Minimize'), role('zoom', '缩放', 'Zoom'),
      ...(platform === 'darwin' ? [separator, role('front', '前置全部窗口', 'Bring All to Front')] : []),
    ]},
  };
}
