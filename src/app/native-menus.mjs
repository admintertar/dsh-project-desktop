/** Explicit labels are necessary: Electron's role defaults follow the OS locale. */
export function nativeRoleMenus(locale, platform = process.platform, product = 'DSH Project Desktop', applicationItems = []) {
  const zh = locale === 'zh';
  const role = (role, chinese, english) => ({role, label: zh ? chinese : english});
  const separator = {type: 'separator'};
  // 菜单由 Shell 自己定义，官方运行模式不能在启动时加载社区 Desktop 的 native-menu。
  // 这些 role 与 Electron 的标准应用菜单一致，项目命令由调用方追加到末尾。
  const application = {
    label: product,
    submenu: [
      role('about', `关于 ${product}`, `About ${product}`), separator,
      role('services', '服务', 'Services'), separator,
      role('hide', `隐藏 ${product}`, `Hide ${product}`), role('hideOthers', '隐藏其他', 'Hide Others'),
      role('unhide', '全部显示', 'Show All'), separator,
      ...applicationItems, separator, role('quit', `退出 ${product}`, `Quit ${product}`),
    ],
  };
  return {
    application: platform === 'darwin' ? [application] : [],
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
