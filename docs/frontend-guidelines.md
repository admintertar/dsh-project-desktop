# 桌面壳前端规范 / Shell frontend guidelines

修改本仓库的组件、样式、引导窗口或原生交互前，必须阅读本文件及插件仓库的 [通用前端规范](https://github.com/admintertar/dsh-plugin-project/blob/master/docs/frontend-guidelines.md)。通用组件、表单、弹窗、滚动、主题与验收规则在插件文档统一维护；本文件补充 Shell 的窗口与生命周期约束。

本地同级检出时，通用规范位于工作区的 `dsh-plugin-project/docs/frontend-guidelines.md`；不依赖旧私有仓库。当前官方迁移分支的构建来源由 `official-source.lock.json` 和 `project-source.lock.json` 固定；`upstream.lock.json` 仅描述已发布的社区基线，不进入当前构建与运行链。

English summary: read the companion plugin's shared frontend guidelines and this Shell supplement before changing UI. Reuse complete official workflows and immutable stable sources, keep adapters at the desktop boundary, and preserve project isolation. Welcome/create layouts and native acceptance requirements are detailed below.

## 1. 功能所有权与官方复用

- Shell 负责应用入口、欢迎/创建窗口、原生菜单、窗口与 Host 生命周期。项目内 Resources、Tasks、Memory、技能、MCP 与工作区替换由插件负责；主界面、聊天、设置、模型及原生桥接复用固定 DeepSeek 官方能力。
- 接入或恢复官方功能时，先追踪入口、配置保存、确认/取消、生命周期和实际窗口，直接复用完整组件、窗口或服务。官方有自己的对话框时，不换成系统消息框或自制弹窗。
- 需要原生 UI 资源时，从固定官方源码原样编译。不得修改 `.upstream/`、官方产物或内部字段来绕过接入边界。
- 只有不能直接复用的部分才做最小适配，集中在 `src/desktop-adapter/` 和构建脚本，注明官方来源及适配原因，并更新 [架构说明](architecture.md) 的内部接入清单。升级时优先替换成官方公开能力。
- 自有创建项目引导不调用官方首次向导，不伪造 completed/skipped 状态。功能裁剪在组合与能力边界完成，不只用 CSS 隐藏入口。

## 2. 组件与项目窗口

普通控件、locale、主题和长弹窗遵守通用规范。欢迎/创建窗口与项目窗口使用同一固定 stable 的 React 和官方组件依赖。

创建引导的资源表单通过 [guide-resources-client.tsx](../src/desktop-adapter/official/guide-resources-client.tsx) 复用固定插件的 `ProjectSelect`、`ProjectScrollableModal`、`ProjectSettingRow`、`ProjectSettingsCard`、认证界面及样式；不复制实现、不挂载依赖已启动项目 Host 的完整 ResourcesPanel。底层克隆与认证同样复用插件逻辑，Shell 只接入草稿、原生选择器、IPC 和创建事务。

项目窗口加载官方 Web 主界面和 Project 插件，快捷键、目录选择、浏览器、账号页面及权限桥接从固定官方源码构建。所有 IPC、Host、DSH Home 和 Chromium Session 均按项目隔离。确认、取消、语言和键盘行为都属于复用范围；已接入 helper 不等于完整交互已验收，覆盖范围见 [架构说明](architecture.md)。

欢迎窗口管理新建、打开、最近项目及丢失路径；项目启动失败回欢迎页重试。每项目使用独立官方 `profiles/desktop` 和单个 Host，重启或关闭只影响所属项目。社区 Profile 选择/创建、恢复助手与安全模式全部弃用。旧 Stable Home 在迁移验证完成前拒绝接管，保留原始数据。

共享 `system/light/dark` 偏好由 Shell 的 SharedTheme 管理，经官方 settings RPC 同步项目窗口和 Electron `nativeTheme`；字体、语言与其他设置保持各自范围。欢迎/创建窗口沿用应用主题，原生菜单跟随当前项目语言，欢迎页沿用最近项目语言。Renderer 启动时的临时主题不得覆盖已经保存的共享偏好。

DeepSeek 登录账号由 Shell 按应用共享，继续使用官方登录和退出界面。一次登录同步所有项目窗口，退出确认的账号任务影响涵盖所有打开项目，取消不改变账号。模型 API Key、第三方授权、Host 认证密钥与浏览器分区仍按项目隔离。

更新入口原样复用官方账号右侧的 DesktopUpdateIndicator 与折叠侧栏的 DesktopUpdateBadge，Shell 通过官方预加载协议广播自有更新状态；不在插件中重建按钮。无更新时按官方规则隐藏，连接状态保留官方优先级。检查、下载失败与安装确认复用官方 DesktopUpdateDialog；macOS 的 DMG 手动交接说明按实际安装方式适配。原生验收入口为 `yarn smoke:official-updates`，覆盖多个项目、语言、主题、窄窗、失败、取消和确认。

## 3. 欢迎与创建窗口的布局基线

这两个窗口复用官方窗口参数，由 Shell 自有 [GuideFrame](../src/desktop-adapter/official/GuideFrame.tsx) 管理双栏布局，控件、locale 与主题来自固定官方源码。布局常量归 Shell，不依赖社区 AdvancedFrame；不得为了调整引导尺寸改写上游源码。

| 项目 | 当前约定 |
| --- | --- |
| 默认窗口大小 | 欢迎 900×640，创建 980×720 |
| 侧栏宽度 | 欢迎默认 187px，创建默认 190px；范围 176–280px，右侧至少保留 400px |
| 调整与保存 | 鼠标拖动、键盘调整；双击恢复各自默认值；分别保存本机宽度 |
| 窄窗口 | 小于 576px 转顶部导航；创建页保留下拉组合选择，隐藏重复的正文 header |
| 原生窗口外观 | 官方窗口按钮与 32px 拖动区；macOS sidebar vibrancy，Windows 当前使用实体背景，原生验收待完成 |
| 正文 | 左右有效留白 24px，内容外框底部 padding 为 0；导航与正文独立滚动 |
| 底部操作 | 固定显示，两个 footer 均为 0 padding、最小高度 65px，与标题/表单左右对齐 |
| 右侧滚动留白 | 组件至滚动槽 8px、官方滚动槽 8px、槽外 8px，总计 24px，稳定槽始终保留 |
| 分隔线 | 鼠标悬停、按下、拖动、松开都不出现黑线；键盘操作保留焦点提示 |
| 欢迎品牌 | 左侧 42×42px 图标，右侧标题与版本上下两行，图文间距 4px；`navCaption` 下 margin 为 0 |

添加资源与浏览按钮使用同尺寸的官方 outline Button。创建页继续采用设置行布局，不增加另一套表单控件。

滚动条只在真实滚动时显示，停止 800ms 后以 180ms 淡出，拖动滑块期间保持显示；减少动态效果偏好下直接隐藏。仅适配可见性，不改变官方尺寸、形状、主题色、overflow 或稳定槽。该可见性规则同样覆盖项目窗口内的插件页面、侧栏与长弹窗，由插件侧统一实现并登记滚动容器清单（见插件前端规范的滚动章节）；官方弹窗与官方聊天表面保持官方常驻滚动条。

## 4. 异步操作反馈

- 在触发操作的位置展示加载状态：最近项目卡片右侧、打开按钮或创建按钮。组合官方 `Button` 与 `IconLoadingOutline16`，提前预留文字和状态区宽度，避免内容跳动。
- 创建过程按真实阶段显示“创建中…”与“打开中…”。浏览目录、选择文件、移除历史只锁定相关操作，不误报项目正在打开；选择文件确认后才进入打开阶段。
- 超过一秒的等待在固定 footer 显示真实阶段，不在正文末尾追加一行提示。窄窗口提示不挤掉操作按钮，减少动态效果偏好下加载图标保持静止。
- 同步阻止重复提交；进度事件按所属窗口和操作 id 隔离，忽略过期事件。失败后清理忙碌状态、恢复按钮并保留草稿，重试沿用实际业务状态。

## 5. 验收与维护

通用规范的语言、主题、键盘、禁用、窄窗口和滚动验收同样适用。涉及原生功能时，必须打开并操作真实官方界面，核对外观、确认、取消与所属项目的实际结果；仅模拟返回值不算完成 UI 复用验收。

- 修改引导窗口：验证鼠标/键盘调整、双击恢复、宽度持久化、紧凑导航、滚动稳定性、加载/失败/重试和关闭后草稿行为，按范围运行 `yarn run smoke:guide`。
- 修改项目生命周期：运行 `yarn run smoke:official-shell`，验证创建、双项目、原生关闭、重开、重启、失败清理与另一个项目存活。运行/计划任务的关闭确认使用 `yarn run smoke:official-close`，验证官方原生弹窗、确认/取消及项目范围；旧数据迁移单独验收，不恢复社区 Profile/Recovery 流程。
- 修改共享主题：验证多个项目窗口即时同步、重新打开、跟随系统、折叠侧栏和与系统明暗不一致；启动临时主题不覆盖保存值。
- 源码变更执行 `yarn run check`，其余原生检查按 [开发说明](development.md) 选择；记录真实平台与未覆盖项，不能从 macOS x64 结果推断其他平台验收通过。

仅文档改动检查内容、链接和差异，不需要重新构建或启动应用。布局基线变更时同步更新本文件、架构说明及相应验收依据；通用规则在插件文档维护，避免在两个仓库分别发展一套基础组件规范。
