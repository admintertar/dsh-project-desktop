/**
 * Self-drawn titlebar menu for project windows.
 *
 * Windows never shows a native menu bar on our window shape (measured: `GetMenu(hwnd) == 0`,
 * Alt / F10 / `setMenuBarVisibility` all fail), so the project commands live in a titlebar row
 * we draw ourselves — the same place Codex puts its menu: collapse control on the left, then
 * the menus, then the native window controls on the right.
 *
 * Geometry comes from the official client contract (`ctx.desktopWindow.dragRegion`), the sidebar
 * toggle from the official layout service (`ctx.layout.toggleSidebar`), and commands travel over
 * the official renderer bridge. No official source is modified.
 *
 * Text comes from the official locale service, not from `document.documentElement.lang`: measured
 * in the running app, switching the preference to English leaves `<html lang>` at `zh-CN`, so a
 * titlebar that read the document language kept showing the old language. The namespace is
 * registered here and the slot declares it, which is what the official settings sections do.
 */
import {createElement as h, useCallback, useEffect, useRef, useState} from 'react';
import {DESKTOP_RENDERER_ACTIONS_BRIDGE} from '../../../.upstream/desktop/dsh-plugin-desktop/src/renderer-actions-contract.ts';
import {SHELL_TITLEBAR_ACTIONS, SHELL_TITLEBAR_REQUEST} from './shell-titlebar-actions.mjs';

type Item = {id: string; label?: string; shortcut?: string; action?: string; argument?: string; official?: string; separator?: boolean};
type Menu = {id: string; label: string; items: Item[]};

/** Locale namespace owned by the Shell titlebar. */
export const SHELL_TITLEBAR_LOCALE = 'project.shell';

/** Every label the titlebar prints, in both supported languages. */
export const SHELL_TITLEBAR_COPY = {
  zh: {
    file: '文件', edit: '编辑', view: '视图', tools: '项目工具',
    newProject: '新建项目…', openProject: '打开项目…', welcome: '欢迎窗口', closeProject: '关闭项目',
    undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    reload: '重新加载', developerTools: '切换开发者工具', zoomReset: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullscreen: '切换全屏',
    terminal: '打开项目终端', diagnostics: '导出项目诊断…', profile: 'Profile…', restart: '重启当前项目',
    safeMode: '在安全模式中打开', recover: '项目恢复…', updates: '检查更新…', about: '关于 DSH Project Desktop',
    recentProjects: '最近项目', loading: '读取中…', noRecentProjects: '暂无记录',
    applicationMenu: '应用菜单', collapseSidebar: '收起/展开侧栏', collapseSidebarLabel: '收起或展开侧栏',
  },
  en: {
    file: 'File', edit: 'Edit', view: 'View', tools: 'Project Tools',
    newProject: 'New Project…', openProject: 'Open Project…', welcome: 'Welcome Window', closeProject: 'Close Project',
    undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    reload: 'Reload', developerTools: 'Toggle Developer Tools', zoomReset: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Full Screen',
    terminal: 'Open Project Terminal', diagnostics: 'Export Project Diagnostics…', profile: 'Profiles…', restart: 'Restart Current Project',
    safeMode: 'Open in Safe Mode', recover: 'Project Recovery…', updates: 'Check for Updates…', about: 'About DSH Project Desktop',
    recentProjects: 'Recent Projects', loading: 'Loading…', noRecentProjects: 'No recent projects',
    applicationMenu: 'Application menu', collapseSidebar: 'Collapse/expand sidebar', collapseSidebarLabel: 'Collapse or expand the sidebar',
  },
};

const FILE: Menu = {
  id: 'file',
  label: 'file',
  items: [
    {id: 'new', label: 'newProject', shortcut: 'Ctrl+Shift+N', action: SHELL_TITLEBAR_ACTIONS.newProject},
    {id: 'open', label: 'openProject', shortcut: 'Ctrl+O', action: SHELL_TITLEBAR_ACTIONS.openProject},
    {id: 'welcome', label: 'welcome', action: SHELL_TITLEBAR_ACTIONS.welcome},
    {id: 'sep-1', separator: true},
    {id: 'close', label: 'closeProject', shortcut: 'Ctrl+W', action: SHELL_TITLEBAR_ACTIONS.closeProject},
  ],
};

const EDIT: Menu = {
  id: 'edit',
  label: 'edit',
  // The accelerators are Electron's own defaults for these roles on Windows/Linux
  // (`MenuItem` `role` accelerators, read back from the pinned runtime: undo=CommandOrControl+Z,
  // redo=Control+Y, cut/copy/paste=CommandOrControl+X/C/V, selectAll=CommandOrControl+A).
  // This titlebar replaces the native menu bar, which Windows can never show, so the text has to
  // be spelled out here or the items look like they have no shortcut at all. The smoke check
  // verifies the printed chord really reaches a focused editor instead of only looking right.
  items: [
    {id: 'undo', label: 'undo', shortcut: 'Ctrl+Z', action: SHELL_TITLEBAR_ACTIONS.edit, argument: 'undo'},
    {id: 'redo', label: 'redo', shortcut: 'Ctrl+Y', action: SHELL_TITLEBAR_ACTIONS.edit, argument: 'redo'},
    {id: 'sep-1', separator: true},
    {id: 'cut', label: 'cut', shortcut: 'Ctrl+X', action: SHELL_TITLEBAR_ACTIONS.edit, argument: 'cut'},
    {id: 'copy', label: 'copy', shortcut: 'Ctrl+C', action: SHELL_TITLEBAR_ACTIONS.edit, argument: 'copy'},
    {id: 'paste', label: 'paste', shortcut: 'Ctrl+V', action: SHELL_TITLEBAR_ACTIONS.edit, argument: 'paste'},
    {id: 'selectAll', label: 'selectAll', shortcut: 'Ctrl+A', action: SHELL_TITLEBAR_ACTIONS.edit, argument: 'selectAll'},
  ],
};

const VIEW: Menu = {
  id: 'view',
  label: 'view',
  // No shortcut column on purpose: measured in a real project window, F11 and Ctrl+Shift+I do
  // fire, but Ctrl+R and the zoom chords do not, because the pinned Windows strategy removes the
  // native menu bar that would have carried their role accelerators. Printing them before the
  // window owns those bindings would promise keys that do nothing.
  items: [
    {id: 'reload', label: 'reload', action: SHELL_TITLEBAR_ACTIONS.view, argument: 'reload'},
    {id: 'developerTools', label: 'developerTools', action: SHELL_TITLEBAR_ACTIONS.view, argument: 'developerTools'},
    {id: 'sep-1', separator: true},
    {id: 'zoomReset', label: 'zoomReset', action: SHELL_TITLEBAR_ACTIONS.view, argument: 'zoomReset'},
    {id: 'zoomIn', label: 'zoomIn', action: SHELL_TITLEBAR_ACTIONS.view, argument: 'zoomIn'},
    {id: 'zoomOut', label: 'zoomOut', action: SHELL_TITLEBAR_ACTIONS.view, argument: 'zoomOut'},
    {id: 'sep-2', separator: true},
    {id: 'fullscreen', label: 'fullscreen', action: SHELL_TITLEBAR_ACTIONS.view, argument: 'fullscreen'},
  ],
};

const TOOLS: Menu = {
  id: 'tools',
  label: 'tools',
  items: [
    {id: 'terminal', label: 'terminal', official: 'terminal'},
    {id: 'diagnostics', label: 'diagnostics', official: 'diagnostics'},
    {id: 'sep-1', separator: true},
    {id: 'profile', label: 'profile', action: SHELL_TITLEBAR_ACTIONS.profile},
    {id: 'restart', label: 'restart', action: SHELL_TITLEBAR_ACTIONS.restart},
    {id: 'safeMode', label: 'safeMode', action: SHELL_TITLEBAR_ACTIONS.safeMode},
    {id: 'recover', label: 'recover', action: SHELL_TITLEBAR_ACTIONS.recover},
    {id: 'sep-2', separator: true},
    {id: 'updates', label: 'updates', official: 'check-for-updates'},
    {id: 'sep-3', separator: true},
    // Windows never shows the native application menu, so its About entry has to live here —
    // the same panel macOS reaches from the application menu.
    {id: 'about', label: 'about', action: SHELL_TITLEBAR_ACTIONS.about},
  ],
};

const MENUS: Menu[] = [FILE, EDIT, VIEW, TOOLS];

const STYLE_ID = 'dsh-shell-titlebar-styles';

function stylesheet(height: number, rightInset: number): string {
  return `
body:is([data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="win32"], [data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="linux"]) .dshDesktopUpstreamSidebar { padding-top: ${height}px; }
/* Collapsed rail: the sidebar owns the top-left corner again (official look — its first entry
   sits at the very top), so the titlebar drops its toggle + project name there and starts after
   the rail width, with a fill that leaves the rail's own surface visible. */
body:is([data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="win32"], [data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="linux"]) .dshDesktopFrame[data-sidebar-collapsed] .dshDesktopUpstreamSidebar { padding-top: 0; }
.dshDesktopFrame[data-sidebar-collapsed] .dshShellTitlebar { padding-left: 62px; background: transparent; }
.dshDesktopFrame[data-sidebar-collapsed] .dshShellTitlebar::before { content: ""; position: absolute; z-index: -1; top: 0; right: 0; bottom: 0; left: 62px; background: var(--dsh-shell-titlebar-fill); }
.dshDesktopFrame[data-sidebar-collapsed] .dshShellTitlebarToggle,
.dshDesktopFrame[data-sidebar-collapsed] .dshShellTitlebarProject { display: none; }
/* The official sidebar paints its divider as a full-height border, which then shows through the
   translucent titlebar. Keep the official border for the collapsed rail, and for the expanded
   sidebar draw the same divider from below the titlebar instead. */
.dshDesktopFrame:not([data-sidebar-collapsed]) .dshDesktopSidebarSurface { border-right-color: transparent; }
.dshDesktopFrame:not([data-sidebar-collapsed]) .dshDesktopSidebarSurface::after { content: ""; position: absolute; z-index: 1; top: ${height}px; right: 0; bottom: 0; width: 1px; background: var(--dsw-alias-border-l1, rgba(127,127,127,.28)); }
/* The official scrim sits BELOW the official overlay we render into, so the titlebar used to float
   above the scrim (never dimmed) and cover the top of the dialog. Keep the bar rendered, but drop
   the overlay underneath the scrim while a modal is open: the bar then dims together with the rest
   of the window, matching the main window's own chrome instead of disappearing. */
html:has([role="dialog"], [aria-modal="true"]) .dshDesktopOverlay { z-index: 0; }
/* Codex layout: the project identity lives in the titlebar, so the expanded sidebar hides its own
   identity row (the official suffix *_logoRow, which holds the brand button and its collapse control).
   The collapsed rail keeps everything: it is the official compact rail, and the titlebar already
   offers expand/collapse in both states. Classes are CSS-module hashes, matched by their stable suffix. */
body:is([data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="win32"], [data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="linux"]) .dshDesktopFrame:not([data-sidebar-collapsed]) .dshDesktopUpstreamSidebar [class*="_logoRow"] { display: none; }
.dshShellTitlebarProject { display: inline-flex; align-items: center; height: 28px; margin-right: 6px; margin-left: -4px; padding: 0 8px 0 0; color: inherit; font: inherit; font-size: 15px; font-weight: 500; -webkit-app-region: drag; }
.dshShellTitlebarProjectName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Titlebar fill follows the window material exactly like the official frame titlebar:
   a translucent wash over Mica/transparent, the layer-1 surface when material is off. */
body { --dsh-shell-titlebar-fill: var(--dsw-alias-bg-layer-1); }
body:not([data-dsh-desktop-material="off"]) { --dsh-shell-titlebar-fill: color-mix(in srgb, var(--dsw-alias-bg-base) 18%, transparent); }
body:not([data-dsh-desktop-material="off"]) .dshDesktopWindowsCaptionRow { background: transparent; }
.dshShellTitlebar { position: fixed; z-index: 1001; top: 0; left: 0; right: 0; height: ${height}px; display: flex; align-items: center; gap: 4px; box-sizing: border-box; padding: 0 ${rightInset + 6}px 0 8px; background: var(--dsh-shell-titlebar-fill); color: var(--dsw-alias-label-primary); font: 13px/1.2 var(--dsw-font-family, "Segoe UI", system-ui, sans-serif); user-select: none; -webkit-app-region: drag; }
.dshShellTitlebarButton { display: inline-flex; align-items: center; justify-content: center; height: 26px; min-width: 28px; padding: 0 8px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; letter-spacing: .01em; cursor: default; -webkit-app-region: no-drag; transition: background var(--ds-transition-duration-fast, 120ms) var(--ds-ease-in-out, ease); }
.dshShellTitlebarButton:hover, .dshShellTitlebarButton[data-open="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16)); }
.dshShellTitlebarButton:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe); outline-offset: -1px; }
.dshShellTitlebarMenu { position: fixed; z-index: 1002; min-width: 236px; padding: 5px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28)); border-radius: 10px; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 12px 32px rgba(0,0,0,.22); -webkit-app-region: no-drag; }
.dshShellTitlebarMenu[hidden] { display: none; }
.dshShellMenuItem { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: default; -webkit-app-region: no-drag; }
.dshShellMenuItem:hover, .dshShellMenuItem:focus-visible { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.16)); outline: none; }
.dshShellMenuItem[disabled] { color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.7)); }
.dshShellMenuItemLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshShellMenuItemShortcut { color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.8)); font-size: 12px; }
.dshShellMenuSeparator { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l1, rgba(127,127,127,.24)); }
.dshShellMenuGroup { padding: 6px 10px 2px; color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9)); font-size: 12px; }
`;
}

type RecentEntry = {title: string; path: string; available?: boolean};

function bridgeInvoke(payload: unknown): Promise<unknown> {
  const bridge = (window as unknown as Record<string, {invoke: (value: unknown) => Promise<unknown>} | undefined>)[DESKTOP_RENDERER_ACTIONS_BRIDGE];
  if (!bridge) throw new Error('Shell titlebar: the Desktop renderer bridge is unavailable');
  return bridge.invoke(payload);
}

function ShellTitlebar({enabled, height, rightInset, toggleSidebar, t}: {
  enabled: boolean; height: number; rightInset: number; toggleSidebar: () => void; t: (key: string) => string;
}) {
  const [openMenu, setOpenMenu] = useState<string>();
  const [anchor, setAnchor] = useState<{left: number; top: number}>();
  const [recent, setRecent] = useState<RecentEntry[]>();
  const [projectTitle, setProjectTitle] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState<number>();
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const word = (item: Item | Menu) => t(item.label ?? '');
  // The project name may never outgrow the sidebar column (which the operator can drag),
  // so the cap follows the live column width of the official frame instead of a fixed value.
  const projectMaxWidth = sidebarWidth === undefined ? 320 : Math.max(84, Math.round(sidebarWidth - 46));

  // The project name moves into the titlebar (Codex layout), so the sidebar's own
  // brand/project rows are hidden by the stylesheet below.
  useEffect(() => {
    let live = true;
    void bridgeInvoke({type: SHELL_TITLEBAR_REQUEST, action: SHELL_TITLEBAR_ACTIONS.title})
      .then(value => {if (live && typeof value === 'string') setProjectTitle(value)})
      .catch(() => {});
    return () => {live = false};
  }, []);

  useEffect(() => {
    const surface = document.querySelector('.dshDesktopSidebarSurface');
    if (!surface) return undefined;
    const read = () => {
      const width = surface.getBoundingClientRect().width;
      // The collapsed rail (56px) also passes through here while the sidebar animates; ignore it
      // and keep the last expanded width, otherwise the cap sticks at the rail size and a short
      // project name gets truncated even in a maximised window.
      if (width > 100) setSidebarWidth(width);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = stylesheet(height, rightInset);
    document.head.append(style);
    return () => {style.remove()};
  }, [enabled, height, rightInset]);

  const close = useCallback(() => {setOpenMenu(undefined)}, []);

  useEffect(() => {
    if (!openMenu) return undefined;
    const onKey = (event: KeyboardEvent) => {if (event.key === 'Escape') {event.preventDefault(); close()}};
    const onPointer = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) close();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [openMenu, close]);

  const loadRecent = useCallback(async () => {
    try {
      const value = await bridgeInvoke({type: SHELL_TITLEBAR_REQUEST, action: SHELL_TITLEBAR_ACTIONS.listRecent});
      setRecent(Array.isArray(value) ? value as RecentEntry[] : []);
    } catch {
      setRecent([]);
    }
  }, []);

  const run = useCallback(async (item: Item) => {
    close();
    try {
      if (item.official) await bridgeInvoke(item.official);
      else if (item.action) await bridgeInvoke({type: SHELL_TITLEBAR_REQUEST, action: item.action, argument: item.argument});
    } catch (error) {
      console.error('Shell titlebar action failed:', error);
    }
  }, [close]);

  const openRecent = useCallback(async (path: string) => {
    close();
    try {
      await bridgeInvoke({type: SHELL_TITLEBAR_REQUEST, action: SHELL_TITLEBAR_ACTIONS.openRecent, argument: path});
    } catch (error) {
      console.error('Shell titlebar: opening a recent project failed:', error);
    }
  }, [close]);

  if (!enabled) return null;
  const active = MENUS.find(menu => menu.id === openMenu);
  return h('div', {className: 'dshShellTitlebar', ref: root, role: 'menubar', 'aria-label': t('applicationMenu')},
    h('button', {
      type: 'button',
      className: 'dshShellTitlebarButton dshShellTitlebarToggle',
      title: t('collapseSidebar'),
      'aria-label': t('collapseSidebarLabel'),
      onClick: () => {toggleSidebar()},
    }, h('svg', {width: 18, height: 18, viewBox: '0 0 16 16', 'aria-hidden': 'true'},
      h('rect', {x: 1.5, y: 2.5, width: 13, height: 11, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3}),
      h('path', {d: 'M6 2.5v11', stroke: 'currentColor', strokeWidth: 1.3}))),
    h('span', {className: 'dshShellTitlebarProject', style: {maxWidth: `${projectMaxWidth}px`}, title: projectTitle || undefined},
      h('span', {className: 'dshShellTitlebarProjectName'}, projectTitle || 'DSH Project Desktop')),
    MENUS.map(menu => h('button', {
      key: menu.id,
      type: 'button',
      ref: (element: HTMLButtonElement | null) => {buttons.current[menu.id] = element},
      className: 'dshShellTitlebarButton',
      'data-open': openMenu === menu.id ? 'true' : undefined,
      'aria-haspopup': 'menu',
      'aria-expanded': openMenu === menu.id,
      onClick: () => {
        const next = openMenu === menu.id ? undefined : menu.id;
        const rect = buttons.current[menu.id]?.getBoundingClientRect();
        setAnchor(rect ? {left: Math.round(rect.left), top: Math.round(rect.bottom) + 3} : undefined);
        setOpenMenu(next);
        if (next === 'file') void loadRecent();
      },
    }, word(menu))),
    active && h('div', {className: 'dshShellTitlebarMenu', role: 'menu', style: {top: anchor?.top ?? height, left: anchor?.left ?? 8}},
      active.items.map(item => item.separator
        ? h('div', {key: item.id, className: 'dshShellMenuSeparator', role: 'separator'})
        : h('button', {
          key: item.id,
          type: 'button',
          role: 'menuitem',
          className: 'dshShellMenuItem',
          onClick: () => {void run(item)},
        },
        h('span', {className: 'dshShellMenuItemLabel'}, word(item)),
        item.shortcut && h('span', {className: 'dshShellMenuItemShortcut'}, item.shortcut))),
      active.id === 'file' && h('div', null,
        h('div', {className: 'dshShellMenuSeparator', role: 'separator'}),
        h('div', {className: 'dshShellMenuGroup'}, t('recentProjects')),
        recent === undefined
          ? h('div', {className: 'dshShellMenuGroup'}, t('loading'))
          : recent.length === 0
            ? h('div', {className: 'dshShellMenuGroup'}, t('noRecentProjects'))
            : recent.slice(0, 8).map(entry => h('button', {
              key: entry.path,
              type: 'button',
              role: 'menuitem',
              className: 'dshShellMenuItem',
              disabled: entry.available === false,
              onClick: () => {void openRecent(entry.path)},
            }, h('span', {className: 'dshShellMenuItemLabel'}, entry.title || entry.path))))));
}

/**
 * Register the self-drawn titlebar into the official overlay slot.
 * @param {any} ctx - client plugin context (slots + official Desktop services).
 * @param {{platform: string}} environment - parsed Desktop client environment.
 */
export function applyShellTitlebar(ctx: any, environment: {platform: string}): void {
  if (environment.platform === 'darwin') return;
  ctx.effect(() => ctx.locale.register(SHELL_TITLEBAR_LOCALE, SHELL_TITLEBAR_COPY), 'project-desktop: titlebar copy');
  const t = ctx.locale.bind(SHELL_TITLEBAR_LOCALE);
  const dragRegion = ctx.desktopWindow?.dragRegion;
  const height = Number.isFinite(dragRegion?.height) ? dragRegion.height : 40;
  const rightInset = Number.isFinite(dragRegion?.rightInset) ? dragRegion.rightInset : 138;
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'project-desktop-titlebar',
    order: 0,
    locale: SHELL_TITLEBAR_LOCALE,
    inject: () => ({
      enabled: true,
      height,
      rightInset,
      t,
      toggleSidebar: () => {ctx.layout?.toggleSidebar?.()},
    }),
  }, ShellTitlebar));
}
