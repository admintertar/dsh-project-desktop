# 桌面壳前端规范 / Shell frontend guidelines

修改本仓库的组件、样式、引导窗口或原生交互前，必须阅读本文件及插件仓库的 [通用前端规范](https://github.com/admintertar/dsh-plugin-project/blob/master/docs/frontend-guidelines.md)。通用组件、表单、弹窗、滚动、主题与验收规则在插件文档统一维护；本文件补充 Shell 的窗口与生命周期约束。

本地同级检出时，通用规范位于工作区的 `dsh-plugin-project/docs/frontend-guidelines.md`；不依赖旧私有仓库。开发规范由维护中的仓库提供，实际构建依赖仍严格遵循 `upstream.lock.json`，不得因文档更新跳过固定提交。

English summary: read the companion plugin's shared frontend guidelines and this Shell supplement before changing UI. Reuse complete official workflows and immutable stable sources, keep adapters at the desktop boundary, and preserve project isolation. Welcome/create layouts and native acceptance requirements are detailed below.

## 1. 功能所有权与官方复用

- Shell 负责应用入口、欢迎/创建窗口、原生菜单、窗口与 Host 生命周期。项目内 Resources、Tasks、Memory、技能与 MCP 由插件负责；聊天、设置、主题及 advanced 框架复用固定官方能力。
- 接入或恢复官方功能时，先追踪入口、配置保存、确认/取消、生命周期和实际窗口，直接复用完整组件、窗口或服务。官方有自己的对话框时，不换成系统消息框或自制弹窗。
- 需要原生 UI 资源时，从固定官方源码原样编译。不得修改 `.upstream/`、官方产物或内部字段来绕过接入边界。
- 只有不能直接复用的部分才做最小适配，集中在 `src/desktop-adapter/` 和构建脚本，注明官方来源及适配原因，并更新 [架构说明](architecture.md) 的内部接入清单。升级时优先替换成官方公开能力。
- 自有创建项目引导不调用官方首次向导，不伪造 completed/skipped 状态。功能裁剪在组合与能力边界完成，不只用 CSS 隐藏入口。

## 2. 组件与项目窗口

普通控件、locale、主题和长弹窗遵守通用规范。欢迎/创建窗口与项目窗口使用同一固定 stable 的 React 和官方组件依赖。

创建引导的资源表单通过 [guide-resources-client.tsx](../src/desktop-adapter/stable/guide-resources-client.tsx) 复用固定插件的 `ProjectSelect`、`ProjectScrollableModal`、`ProjectSettingRow`、`ProjectSettingsCard`、认证界面及样式；不复制实现、不挂载依赖已启动项目 Host 的完整 ResourcesPanel。底层克隆与认证同样复用插件逻辑，Shell 只接入草稿、原生选择器、IPC 和创建事务。

项目窗口直接复用官方 advanced 框架、侧栏插槽和材质。设置页复用官方设置注册与动作插槽，重启确认使用官方 `DesktopDialogWindow`，恢复及 Profile 选择/创建使用官方窗口。确认、取消、语言和键盘行为都属于复用范围。

欢迎窗口只管理新建、打开、最近项目及丢失路径；有效项目启动失败或主动进入恢复时，打开所属项目的官方恢复助手。每个项目可以有多个 Profile，但最多运行一个正常 Host。重启、恢复或关闭只影响所属项目。

共享 `system/light/dark` 偏好由 Workbench 管理，统一同步正常项目窗口和 Electron `nativeTheme`；字体、语言与其他设置保持各自范围。欢迎/创建窗口沿用应用主题，原生菜单跟随当前项目语言，欢迎页沿用最近项目语言。安全模式维持隔离，不把临时主题传播给正常项目。

## 3. 欢迎与创建窗口的布局基线

这两个窗口复用官方窗口参数和 [GuideFrame](../src/desktop-adapter/stable/GuideFrame.tsx) 的最小双栏适配。固定版本的布局限制及适配原因见 [架构说明](architecture.md)，不得为了调整引导尺寸改写上游框架。

| 项目 | 当前约定 |
| --- | --- |
| 默认窗口大小 | 欢迎 900×640，创建 980×720 |
| 侧栏宽度 | 欢迎默认 187px，创建默认 190px；范围 176–280px，右侧至少保留 400px |
| 调整与保存 | 鼠标拖动、键盘调整；双击恢复各自默认值；分别保存本机宽度 |
| 窄窗口 | 小于 576px 转顶部导航；创建页保留下拉组合选择，隐藏重复的正文 header |
| 原生窗口外观 | 官方内嵌窗口按钮、32px 拖动区；macOS sidebar vibrancy，Windows 使用官方检测后的 Mica 或实体回退 |
| 正文 | 左右有效留白 24px，内容外框底部 padding 为 0；导航与正文独立滚动 |
| 底部操作 | 固定显示，两个 footer 均为 0 padding、最小高度 65px，与标题/表单左右对齐 |
| 右侧滚动留白 | 组件至滚动槽 8px、官方滚动槽 8px、槽外 8px，总计 24px，稳定槽始终保留 |
| 分隔线 | 鼠标悬停、按下、拖动、松开都不出现黑线；键盘操作保留焦点提示 |
| 欢迎品牌 | 左侧 42×42px 图标，右侧标题与版本上下两行，图文间距 4px；`navCaption` 下 margin 为 0 |

添加资源与浏览按钮使用同尺寸的官方 outline Button。创建页继续采用设置行布局，不增加另一套表单控件。

滚动条只在真实滚动时显示，停止 800ms 后以 180ms 淡出，拖动滑块期间保持显示；减少动态效果偏好下直接隐藏。仅适配可见性，不改变官方尺寸、形状、主题色、overflow 或稳定槽，不影响主项目窗口和官方弹窗。

## 4. 异步操作反馈

- 在触发操作的位置展示加载状态：最近项目卡片右侧、打开按钮或创建按钮。组合官方 `Button` 与 `IconLoadingOutline16`，提前预留文字和状态区宽度，避免内容跳动。
- 创建过程按真实阶段显示“创建中…”与“打开中…”。浏览目录、选择文件、移除历史只锁定相关操作，不误报项目正在打开；选择文件确认后才进入打开阶段。
- 超过一秒的等待在固定 footer 显示真实阶段，不在正文末尾追加一行提示。窄窗口提示不挤掉操作按钮，减少动态效果偏好下加载图标保持静止。
- 同步阻止重复提交；进度事件按所属窗口和操作 id 隔离，忽略过期事件。失败后清理忙碌状态、恢复按钮并保留草稿，重试沿用实际业务状态。

## 5. 验收与维护

通用规范的语言、主题、键盘、禁用、窄窗口和滚动验收同样适用。涉及原生功能时，必须打开并操作真实官方界面，核对外观、确认、取消与所属项目的实际结果；仅模拟返回值不算完成 UI 复用验收。

- 修改引导窗口：验证鼠标/键盘调整、双击恢复、宽度持久化、紧凑导航、滚动稳定性、加载/失败/重试和关闭后草稿行为，按范围运行 `yarn run smoke:guide`。
- 修改 Profile、重启或恢复：验证完整官方对话框、取消、Profile 切换、恢复与安全模式隔离，按范围运行 `yarn run smoke:profiles`。
- 修改共享主题：验证多个正常项目窗口即时同步、重新打开、跟随系统、折叠侧栏和与系统明暗不一致；安全模式不传播临时偏好。
- 源码变更执行 `yarn run check`，其余原生检查按 [开发说明](development.md) 选择；记录真实平台与未覆盖项，不能从 macOS x64 结果推断其他平台验收通过。

仅文档改动检查内容、链接和差异，不需要重新构建或启动应用。布局基线变更时同步更新本文件、架构说明及相应验收依据；通用规则在插件文档维护，避免在两个仓库分别发展一套基础组件规范。
