# 独立 Shell 架构

## 设计目标

`dsh-project-desktop` 是独立的项目桌面壳，仅适配 stable。保留需要的官方能力，项目创建使用独立引导窗口，在组合边界选择启用的官方功能。项目内能力由独立 Project 插件维护。

官方 Desktop 与 DSH 都在快速变化，stable 仅指发行通道。目标是把升级影响限制在清晰的接入边界，避免长期维护 Desktop fork，并非保证每次升级零修改。

## 所有权

| 内容 | 负责方 |
| --- | --- |
| 应用身份、主进程、窗口、托盘、原生菜单 | 新 Shell |
| 创建项目引导、打开/最近项目、项目环境身份 | 新 Shell |
| 项目 Host 启停与恢复协调、应用共享明暗主题 | 新 Shell |
| 聊天、Agent、官方基础 UI、advanced 框架、底层 Profile/恢复算法 | 固定官方依赖 |
| Tasks、Resources、Memory、项目会话及工具 | 现有 Project 插件 |
| 官方私有接口及升级适配 | `src/desktop-adapter/stable/` |

## 第一批实现

上游源码从固定 Git 对象导出到 `.upstream/`。重算 tree hash 可检测文件内容、增删、可执行位与符号链接变化；源码内不放依赖和构建产物。构建输出在 `.cache/runtime/`，包身份保持官方原值，独立应用将另设自身身份。

Host 通过自有 `bootProjectHost()` 组合官方 Harness `boot()`、Profile 解析器、日志、命令环境与原生动作服务。不实例化应用级 Profile、market 和 DesktopSettingsController；Profile 管理由主进程按项目接入官方选择／创建窗口与 `profile-manager`。图形应用使用 Electron `utilityProcess`，无图形检查使用 Node 子进程；两者共享同一入口和 RPC。`DSH_HOME` 与 cwd 在创建进程时确定，Profile 使用官方模板，状态根只接受本应用明确拥有的目录。

每个项目拥有独立 DSH Home，其中可包含多个 Profile，但同一时间只有一个正常 Host。`projects/<项目路径哈希>/profile-selection/state.json` 使用官方 `{version: 2, active}` 记录本机选择，不修改共享项目文件。默认 `desktop` 保留既有数据；新建 Profile 使用官方 Web 模板并加入项目所有权标记，每次启动统一接入自有 Shell、Project 插件及同一项目文件。Profile 选择保存后当前 Host 身份不变，重启当前项目才加载新选择。所选非默认 Profile 缺失时进入恢复助手，不静默换回其他环境。项目工具菜单提供官方 Profile 选择窗口；恢复助手内也可切换／新建。

Profile 分隔插件依赖、补丁和检查点，不代表整个 Home 独立。普通设置默认仍位于项目 Home 的 `settings.yaml`，市场 provider 选择也是项目共享设置；市场包操作绑定实际运行的 Profile。官方检查点包含 Home 的 `settings.yaml`／`cordis.patch.yml`，回滚可能影响同项目其他 Profile 的共享配置，项目资料与会话不在配置检查点内。

原生能力桥使用官方 `HostRpc`、`createHostRuntime`、`bindNativeRuntime`。我们给自己提供的 runtime 增加项目窗口能力，官方桥和源码保持不变。每个窗口使用唯一 Chromium partition、官方 sandbox/contextIsolation preload，在该 Session 内换取官方认证 Cookie；专属访问头只注入所属 Renderer 的同源 HTTP/WebSocket，不随外链或 iframe 泄漏。窗口 Session **不安装任何 Web 权限处理器**，与官方 Desktop runtime 一致：官方客户端 UI 的消息、代码块、终端、表格和 JSON 树复制入口都走 `navigator.clipboard.writeText`，而 Electron 43 把该请求报成 `clipboard-read`，一旦按 deny-all 拦截就会让复制静默失效（UI 侧吞掉异常且不显示反馈）。Web 安全边界因此只由 webPreferences、导航／弹窗／webview 拦截和专属访问头承担，权限与下载都交回 Electron 默认行为（官方同样没有 `will-download` 策略）；`tests/renderer-security.test.mjs` 断言两个窗口模块不再出现权限处理器或 `will-download`，避免该缺陷回归。

适配器常在自有文件里**自己实现**官方对象，而非包一层官方实例，此时官方对象对外提供的字段就是与固定官方代码之间的契约：官方的桥、URL 构造器、设置页和能力门都会按名读取它们，缺一个既不报类型错也不抛异常，只会让对应能力静默失效。改写这类实现时先照搬官方那份完整行为再叠加我们的裁剪，只删除我们确实要裁的能力，并保留官方能力位与探测入口。项目窗口材质即判例：官方 `ElectronDesktopRuntime` 在主进程构造时自行解析 `windowsBuild`，而项目的 native runtime 是 `src/desktop-adapter/native.mjs` 里的自有对象；该字段缺失使官方 `runtimeSnapshot` 送出的 `windowsBuild` 为 `undefined`，能力位随即在**两处**同时失守——`desktopRendererUrl` 按官方门槛写出 `dsh-desktop-mica=0`，自有设置页因 `micaSupported` 为假只列出「纯色背景」；`effectiveDesktopWindowMaterial` 也把已持久化的 `mica` 当作系统不支持，回落为 `off`，于是选项既不显示、也不会生效。修法是从官方 `window-material` 读 `windowsBuildNumber` 并原样放进自有 runtime（`tests/windows-build-capability.test.mjs` 固定快照契约与静默降级，并按文本断言该字段仍来自官方探测）。桥接方补齐的其余字段同样按此处理；不要因为某字段暂时没有自有消费者就省掉它。

同一条规则也管**副作用**，不只是字段：官方实现在状态变化时会顺带修正系统层的陈旧状态，只搬字段而把方法留成空实现，症状会在下一次实时变化时才出现。第二个判例是材质重涂——官方 `ElectronDesktopRuntime.setThemeSource` 在换主题时除了设置 `nativeTheme.themeSource`，还要经平台策略重涂一次窗口材质，注释写明 Windows 会保留上一次的 DWM Mica 调色板直到窗口重组；自有 `setThemeSource` 曾写成空实现（因为应用级 `SharedTheme` 已是 `nativeTheme` 的唯一所有者），于是实时换主题只改了页面配色，窗口材质从不重涂，DWM 继续用旧调色板。高级侧栏在材质生效时本就是透明的（`--dsw-specific-sidebar-fill: transparent`），因此从深色切到浅色后右区随主题变浅、左栏却停在旧调色板，表现为"浅色主题下左栏是黑的"。修法是保留壳的职责分工（仍不设 `nativeTheme`，因为 `SharedTheme` 独占），但恢复官方那一步：经 `electronPlatformStrategy().refreshThemeMaterial` 重涂，并在首次上屏时（`window.once('show')`）也重涂一次，因为 Windows 缓存的正是首次合成那次调色板。`src/windows/window-material-refresh.mjs` 承载这段决策，`tests/window-material-refresh.test.mjs` 固定三种缺失场景下的静默行为，并守卫该钩子不会被改回空实现。

`dsh-project-shell` 是我们自己的双面插件。Host 面只注册固定 advanced/loopback 的设置 schema、窗口规格及官方健康上报端点；原官方 desktop-shell 条目被配置禁用。Client 面调用官方 advanced、窗口几何、主题呈现与健康报告，接入 Project 客户端，不调用官方应用设置的全量注册函数。

Harness 的模型插件把设置页面和首次弹窗注册放在同一个入口中，因此使用约 30 行自有组合，直接导入固定的 ModelsSection、store、operations、schema 和 locale，实现原始模型页面与刷新订阅。源文件与 CSS 保持原样，只不注册 `settings.onboarding` 两个条目。不存在 CSS 隐藏、修改上游 bundle 或伪造 onboarding 完成状态。

预 Host 的欢迎窗口使用本地 CSP 页面、隔离 preload、限选 IPC，负责最近项目、新建／打开和丢失项目文件的重新定位，不再承载检查点／安全模式操作。欢迎页及原生菜单的新建入口复用一个独立 BrowserWindow，使用单独 Chromium partition 和 `?mode=create` 页面，只显示左侧项目组合与右侧创建表单；再次打开时聚焦已有窗口并保留草稿，取消只关闭创建窗口。新建项目的父目录可输入或通过原生选择器取得，由主进程 bootstrap 校验；关联资源目录及项目重新定位文件仍由主进程原生选择器取得。项目创建由自有 bootstrap 事务负责：根目录初始化一个 Git 仓库，新建资源各自初始化独立 Git 仓库并写入 `AGENT.md`，根 Git 精确忽略子资源目录；已有外部资源只记录本机绑定，不初始化、不覆盖、不删除。Host 通过自有 Shell 适配器在每次项目上下文组装时读取根目录和资源根目录的 `AGENT.md`，单文件和总上下文都有大小上限；外部资源有就读取，没有就跳过。复用插件构建出的项目文件工具，以排他创建方式落盘；失败后重试会复用唯一已有项目。控件、图标、theme CSS 和 LocaleRuntime 来自同一固定 Harness；独立打包时强制 React/ReactDOM 使用同一份 stable 实例。

项目创建中的 Git 初始化、检查和远程克隆通过异步子进程执行，网络等待不会阻塞 Electron 主进程。每次操作保留五分钟超时及有界输出；关闭创建窗口或退出应用会取消尚未完成的创建，先停止 Git 及其传输子进程，再异步清理本次新建的目录。应用退出等待清理完成。创建期间禁止重复创建或提前打开该项目，完成后的 Host 启动失败仍可复用项目文件重试。

新建资源的“关联远程仓库”使用弹窗填写地址与可选初始分支，保存时校验格式并立即异步克隆。Project 固定提交更新为 `77f0430`，复用其中的 `ResourceCloneManager`、`ProjectResourceStore`、`ResourceGitAuthentication` 和原始认证弹窗／控制器／设置布局；固定 Desktop/Harness stable 未变。预 Host 的 IPC 适配与源码导入都集中在 `desktop-adapter/stable/guide-resources*`，构建直接编译固定源码，不复制插件实现，也不为引导启动共享 Host。认证先沿用系统 Git，需要时请求本次操作的 HTTPS 用户名与密码／令牌或 SSH 私钥与口令；仍保留插件的地址重写、SSH 主机验证与凭据不落盘边界。

Shell 的 `GuideClones` 仅负责临时目录及创建事务衔接：每个资源在应用 userData 的 `creation-drafts/draft-*` 中独立克隆，卡片显示阶段／进度、取消或错误；项目名称与目标父目录仍可编辑。只有状态为 completed 且地址和分支匹配的资源才能安装，创建时复制完整仓库到最终相对路径并再次检查 Git 根、origin 与指定分支，不重复请求远端。原 staging 保留到整个创建成功，保证创建失败能重试；切换模板、取消关联、移除资源、关闭窗口与退出应用负责取消并清理对应 staging，不删除外部关联目录。启动持有单实例锁后清理带有本应用标记的遗留草稿。引导克隆使用插件原有的 30 分钟操作超时及 5 分钟认证等待，普通 bootstrap Git 操作继续使用上述五分钟超时。

手动“添加资源”沿用资源页的先填写、后加入流程，默认本地目录，也可切换 Git 仓库；模板仍可以预置空资源。Shell 的 `AddResourceModal` 只管理尚未创建项目的表单草稿，直接复用插件的 `ProjectSelect`、`ProjectScrollableModal`、`ProjectSettingRow`、`ProjectSettingsCard`、文案和样式，不挂载需要现有项目 Host 的 ResourcesPanel。主进程只检测原生选择器选中的目录，适配器调用固定插件的 `inspectResourceGit`，返回名称与安全的 Git 信息。选择 Git 类型的本地资源在最终创建时重新核验 origin，并保存类型与 URL；引用文件保持原位。远程名称和目标目录按地址建议，手动修改后不被覆盖；名称与目标路径独立，编辑名称／仓库不重置已选目标。客户端和创建事务共同校验目录边界及目标重叠，确认远程添加立即开始复用的异步克隆／认证，取消未保存表单不新增卡片。

全新检出后项目根下没有 `resources/` 目录：根 Git 精确忽略每个子资源，所以新机器上所有 Git 资源都是缺失状态。项目窗口进入 `open` 后，主进程读取 Host 的资源快照，对「类型为 Git、声明了远端地址、目录为 ENOENT、没有机器本地绑定、也没有既有克隆作业」的资源逐个调用插件的资源克隆 API，并等前一个作业终结再推进（插件一次只允许一个克隆）。打开不等待克隆，失败只记录日志、仍可在资源页手动重试；安全模式、自检与测试模式不触发。机器本地绑定与项目外目录是用户决定，不覆盖；已有失败作业留给插件面板重试，避免每次打开都重复一次注定失败的克隆。

`ProjectRegistry` 管理同一项目并发打开、启动取消和关闭。若 Host 停止未确认，继续保留所有权并拒绝再次打开，避免两个 Host 同时写一个 Profile。

`ProjectWorkspace` 在 Registry 上增加每项目独立的操作队列，把打开、关闭、重启和恢复串行化。`workspace-session.json` 保存恢复集合、最近激活项目及独立窗口布局，和 `recent-projects.json` 的历史记录分开。打开前记 `opening`，完整健康后记 `open`，异常记 `failed`，恢复窗口使用 `recovering`；主动进入恢复不记为故障。正常退出关闭资源但保留集合，主动关闭项目才删除集合成员。下次启动并行恢复 `open`，有效项目的 `opening/failed/recovering` 自动进入官方恢复助手，丢失项目文件留在欢迎页。每项目恢复独立，等待用户操作不占用生命周期队列，退出应用可正常关闭恢复窗口。

检查点适配器只在完整 Host/Renderer 健康后调用官方 `captureHealthy()`，保留每 Profile 三槽轮换及恢复后跳过覆盖的规则。恢复入口先停止所属 Host，然后使用官方 `DesktopStartupRecoveryWindow`、`startup-recovery-controller` 的代际绑定、短期预览 token、文件校验及恢复。依赖声明变化时调用官方 materializer；自有 pending 文件按 Profile 跨进程保留恢复未完成状态，只阻止相应 Profile 启动。旧 `desktop` journal 保持原路径。选择另一 Profile 后旧预览失效，不能再写入旧 Profile。插件卸载委托官方 `removeRecoveryPlugin`，自带 Project 插件仍受开发依赖边界保护。

手动恢复、启动失败、Host／Renderer 崩溃均打开所属项目的官方恢复助手，语言沿用该项目。修复后重启／安全模式／关闭仅作用于该项目；安全模式关闭后返回恢复助手。未确认 Host 停止或状态所有权时，仅提供官方诊断界面，不授予配置、Profile 切换或恢复写入能力。应用级 DSH Home 迁移和工厂重置不提供能力，官方对应页显示不可用。恢复 UI 不依赖失败项目的 Host、Renderer 或插件。

`project-native-windows.mjs` 集中持有官方窗口实例。stable 2.0.11 没有 ready/dispose 公共接口，因此适配器只读取其 `window` 引用，增加项目标题并在后台操作结束后销毁该 BrowserWindow；结果结算仍走官方 `closed` 处理，不修改内部字段。升级时检查此处并优先替换为官方公开接口。官方本地窗口继续使用原有 sandbox、无 preload／Node 的内存 Session；操作 token 与回调按项目窗口隔离。

桌面设置通过原始 settingsScope / settings.section 注册，复用官方 Button/Menu/Switch。仅组合通知、材质、日志和当前项目原生操作，不注册原来的模式/Profile/应用更新页面。设置页头通过框架正式的 `settings.action` 插槽复用固定 Desktop 的原生操作组件，提供导出诊断、打开 DSH 终端及重新加载/重启/恢复模式菜单；通用设置框架继续提供打开配置文件。所有重启操作由项目窗口自己的 runtime 处理，不影响其他项目。Switch 尺寸按未导出的 DesktopSettingsSection.ToggleRow 最小适配；日志直接接入官方 FileExporter 的阈值。模型、主题、语言等其他页面仍由已有官方服务提供。

材质保存后沿用官方设置监听流程，异步请求所属项目的重启确认。设置页菜单、原生菜单和 Host 发起的重启／恢复请求共用该确认入口：直接调用 `desktop-dialog-window.showDesktopMessageBox` 和原始 `DesktopDialogWindow`，使用官方 `desktop-dialog` 页面、组件、图标、字体与主题样式，不调用系统 `dialog.showMessageBox`。构建在临时目录通过官方 Vite/React/Tailwind 配置编译原封不动的 native-ui 源文件，产物放在官方模块预期的 `lib/native-ui/`，随运行时一同打包。文案复用 `tray-locale.desktopRestartConfirmationCopy`，仅将应用级描述适配为当前项目，默认聚焦取消。取消保留已保存设置和当前窗口；确认后才停止该项目 Host 并重建窗口或进入恢复界面。同一项目的并发请求合并为一次确认，关闭期间不再执行重启；日志、通知与主题的即时更新不触发该弹窗。

stable 默认启用随固定 Desktop 依赖提供的 `dsh-market`，也可在当前项目设置中关闭；官方 Profile 组合负责过滤未选中的 provider，并把 `dsh-market` 显式绑定到实际运行的 Profile。Shell 向市场提供只读的当前 Profile 身份，使其使用官方 `desktopPnpm` 可恢复包操作服务；该身份不提供创建、选择或删除 Profile 的能力，Profile 窗口由主进程管理。产品自带 Project 插件使用 `devDependencies` 本地 link，市场只管理普通依赖，不能从市场误卸载产品核心插件。`dsh-community-market` 当前要求 DSH 0.1.6 alpha，在 stable 页面中只展示为不可用选项。

欢迎窗口只承载应用级入口，不创建共享 Host。普通设置默认在项目 Home 内共享；不同项目保持独立，应用只共享明暗主题。

`SharedTheme` 拥有应用级 preference，只同步 `system/light/dark`。各 Host 的官方 `settings/updated` 事件触发协调，原子保存应用 theme.json 后统一更新 Electron nativeTheme 及所有 Host 的 ui-theme；广播写入不再广播。不共享字体、语言、模型；菜单语言随当前项目窗口改变。

欢迎窗口默认 900×640，新建窗口默认 980×720。二者通过 `guide-window-options` 直接调用官方 `advancedWindowOptions`，复用主窗口的 native traffic lights、32px 拖动区域及 macOS sidebar vibrancy；Windows 使用官方能力校验后的 Mica，不支持时使用实体背景。入口窗口材质不依赖项目 Profile，明暗由应用共享 `nativeTheme` 驱动。项目窗口走同一条官方 Mica 门槛，构建号由自有 runtime 的 `windowsBuild` 提供（见上文字段契约）。

`GuideFrame` 是官方 `AdvancedFrame.tsx` 的双栏最小适配：直接复用 `installDesktopOwnedStyles`、原始 pointer-capture／RAF 拖拽和原生标题栏布局，补充键盘调整与取消清理。固定 stable 的 1024px 自动折叠阈值、`DesktopLayoutState` 与列宽计算的侧栏上下限不可配置，私有 ResizeHandle 也未导出，因此适配器仅保留左右面板，并将侧栏上下限按官方值的三分之二独立管理：范围 176–280px，欢迎页默认 187px、新建页默认 190px；双击分隔线恢复各自默认值。保护右侧至少 400px；小于 576px 时转为顶部导航，新建页保留官方下拉选择项目组合。分隔线沿用官方透明悬停，仅键盘聚焦时提供焦点提示。扩宽恢复偏好宽度，拖拽结束／键盘调整分别保存 welcome、create 的本机宽度到 `guide-window-state.json`；v2 将旧 v1 宽度按三分之二一次性迁移。欢迎页品牌采用左侧 42×42px 图标、右侧标题与版本上下两行的排列，图文间距 4px，在侧栏和顶部导航中保持一致；底部说明下边距为 0。组合名称按需换行，适应更窄的导航。正文与导航各自使用稳定滚动槽，正文独立滚动，底部操作固定；不启动 Host、不修改官方源码。

内容区统一左右 24px 留白、底部 padding 为 0；正文的右侧留白分为组件与滚动槽之间 8px、官方滚动槽 8px、槽外 8px，稳定槽保持表单宽度不随溢出变化。标题、表单和 footer 共用同一左右边界，两个窗口 footer 均为 0 padding、最小高度 65px。新建页进入顶部下拉导航后隐藏重复的正文 header，恢复双栏时重新显示；添加资源与浏览使用同尺寸的官方 outline Button。分隔线显式区分鼠标与键盘焦点：从输入框点击分隔线时，不继承 Chromium 的 `:focus-visible` 高亮；按下、拖动与松开都保持透明，键盘操作仍有焦点提示。

正文与左侧导航保留官方滚动条的尺寸、形状和主题色，仅适配可见性：真实 scroll 事件立即显示，停止 800ms 后用 180ms 淡出，拖住滑块时保持可见。固定 stable 未提供自动隐藏控制器，因此由 GuideFrame 捕获本窗口的滚动事件并在卸载时清理计时器；CSS 注册透明度变量完成淡出，减少动态效果偏好下直接隐藏。隐藏不改变 overflow、滚动槽或组件宽度，不影响主项目窗口和官方弹窗。

欢迎与新建页的加载反馈位于操作入口：最近项目的右侧状态区、打开按钮和创建按钮，不在正文末尾追加提示。固定 stable 的 Button 没有 loading 属性，因此组合其公开 Button 与 IconLoadingOutline16；通过重叠的隐藏标签和卡片状态槽预留宽度，保持卡片、按钮和表单尺寸稳定。浏览目录、选择文件和移除历史只锁定相关操作，不显示项目正在打开；文件选择确认后才接收打开阶段。创建文件与仓库完成后，主进程通过所属窗口的 guide-progress 事件报告 opening，每次操作携带独立 id，Renderer 忽略过期事件并同步拦截重复提交。等待超过一秒时固定 footer 显示真实阶段，阶段切换沿用同一位置；失败后清理加载状态、恢复操作并保留表单草稿。底栏最多两行，窄窗口不会挤掉底部按钮；减少动态效果偏好下加载图标保持静止。

## 官方内部接入清单

新增恢复规则：初始 Profile 及早期无锁检查点，仅在依赖恰为自带 Project 的本地 link 时生成锁文件，不自动解析任意新增依赖。其他恢复必须使用冻结锁文件。固定 pnpm 11 的损坏缓存复用问题由自有适配器规避：通过官方 materializer 的 embedder spawn 接口附加新临时 store、force 和 copy 参数，重新校验下载内容，结束后清理该次 store；不改全局 pnpm 设置。失败保留 pending 和官方脱敏诊断。

安全模式复用官方 `safe-mode` 的路径/标记/reset/cleanup，并接入恢复助手的原始入口与确认窗口，不调用 compatibility 或首次向导入口。每项目停止确认后创建临时 dsh-home、desktop-state 和空白工作目录，仅加载官方基础 Profile 与自有 advanced Shell。Host 环境采用允许列表，阻止继承 API key、代理、npm hook 和 DSH 路径覆盖。Renderer 使用随机非持久 Session。退出等待 Host 停止后清除 Session 和临时目录，再打开原项目恢复助手；下次启动在所有 Host 创建前清理遗留临时树。故障项目不自动启动正常 Host；安全模式不捕获正常检查点、不覆盖正常窗口布局，主题不传播到正常项目。

原生菜单显式指定 app/edit/view/window 每个 role 的文案，保留原生行为和快捷键，避免默认子项继续跟随操作系统语言。macOS 应用名称菜单直接调用官方 `macApplicationMenuTemplate` 的应用分组，将应用级检查更新作为 additions 放在“关于”之后、“服务”之前；File 与项目工具仍由 Shell 组合。欢迎页聚焦时沿用最近项目语言。托盘与欢迎页继续提供更新入口；不额外建立帮助菜单或设置页版本浮层。应用 bundle 身份由打包配置负责，不修改开发用 Electron.app。

这些是编译自固定官方源码的库，不是上游承诺的稳定 API。只允许适配器导入。

| 模块组 | 原因 |
| --- | --- |
| `profile`、`profile-manager` | 使用官方模板和 Profile 组合，安装依赖解析边界 |
| `host-rpc`、`host-runtime-bridge` | 保留官方进程通信契约；`runtimeSnapshot` 决定自有 runtime 必须提供哪些能力字段 |
| `module-resolution`、`desktop-actions`、`log-files`、`file-exporter` | 自有 Host 组合所需的解析、命令和日志能力 |
| `desktop-browser-access`、`lan-https-runtime` | 保留 Renderer 认证；项目仅开放本机，LAN 不启用 |
| `desktop-runtime-environment`、`launch-environment` | 命令环境与项目环境变量 |
| `index` 的 Config/desktopRendererUrl、`window-material`、`renderer-boot` | 原始窗口参数、URL 标记与健康报告协议 |
| `window-options`、`preload`、`renderer-actions-dispatch` | 安全窗口配置、文件拖放/原生命令及重启先应答语义 |
| `window-material`、`client/layout-state`、`client/styles`，私有 `AdvancedFrame.ResizeHandle` 最小适配 | 欢迎／新建窗口的官方玻璃、内嵌标题栏、双栏拖拽和紧凑布局；固定版本升级时检查适配 |
| `tray-locale` 的 `desktopRestartConfirmationCopy` | 原生重启／恢复警告文案，按当前项目语言与操作范围适配 |
| `native-menu` 的 `macApplicationMenuTemplate` | 直接复用官方 macOS 应用名称菜单及 additions 插入位置，传入当前项目语言和自有品牌；其余项目菜单由 Shell 组合 |
| `desktop-dialog-window`、native-ui 的 `desktop-dialog` 与官方 Vite 配置 | 完整复用官方独立确认窗口、页面及样式，保留窗口安全策略、取消和键盘行为 |
| `update-lifecycle`、`update-checker`、`update-download`、`native-dialog-copy` | 主进程仅创建一个官方更新生命周期。通过 request 适配自有 GitHub Release，保留官方版本比较、检查合并、通知去重、临时下载/原子替换及安装包清理。私有 ElectronRuntime 提示和平台交接在 `project-updates.mjs` 最小适配为自有品牌、动态所属窗口和全项目退出；上游源码及 bundle 不改写。官方下载器既无进度回调也不经过 Electron download manager，Shell 因此只在自有校验流上额外上报字节进度（`project-release-feed.mjs` 的 `onProgress`），由 `createUpdateProgress` 折算为 `downloading` 阶段与节流后的百分比，只供欢迎窗口按钮使用；应用菜单与托盘保持官方文案不变 |
| `desktop-terminal`、`diagnostic-export` | 原始命令环境和诊断归档；尚待人工验收 |
| `profile-checkpoint`、`startup-recovery-controller` | 健康配置检查点、预览与确认 token、恢复校验，不调用官方应用级重启 |
| `startup-recovery-window`、`profile-selection-window`、`profile-create-window` 及其 native-ui 页面 | 完整复用官方恢复／选择／创建界面与交互，回调限定当前项目；仅补生命周期归属 |
| `recovery-plugin-uninstall` | 在确认 Host 停止后通过官方 CLI 移除当前 Profile 的第三方依赖 |
| `profile-materializer`、`mask-secrets` | 恢复后的依赖重建，以及展示启动错误时的脱敏 |
| `safe-mode` 的 paths/reset/cleanup | 临时环境路径及清理；不使用官方 compatibility 默认组合或应用启动 |
| Desktop client 的 `desktop-settings-api`、`DesktopTerminalSettingsAction`、locale 与 settings styles | 原生 preload 动作协议及设置页头正式操作组件；终端、诊断及单项目重新加载/重启/恢复方法 |
| Desktop `index.ts` 私有 `desktopLocalePreference` | Host 桥按官方逻辑只传递 `zh/en`；`system` 及扩展语言采用原生回退。启动读取和实时设置共用解析，避免未解析语言进入官方菜单或弹窗 |
| Desktop client 的 advanced/window/boot-health/footer 模块 | 复用原始框架、主题、侧栏及生命周期 |
| Harness locale、theme styles、ui-settings-models 源子树 | 预 Host 引导及无需首次弹窗的官方模型页；独立 tree 固定与校验 |
| Project resource-clones、project-resources、resource-auth、resource-git（含 inspectResourceGit）及认证客户端／设置组件／styles／locales | 预 Host 克隆、认证及本地 Git 检测复用；固定提交直接构建，Shell 适配临时存储、原生选择、IPC 和创建前草稿／事务衔接 |
| 构建脚本中的 `package-win`、`electron-builder-environment`、`verify-win-installer` | 原样复用无签名 Windows 构建环境、依赖遍历策略及 PE 验证；自有应用身份、产物和安装自检留在 Shell 打包脚本 |
| 构建脚本中的 `release-preflight`、`prepare-fs-ext`、`mac-universal` 与官方 `build.mac` | 原样复用无证书环境、双架构 Electron ABI 构建与原生模块清单；合并规则只增加 Shell 的隐藏运行时目录前缀，避免 glob 跳过 `.cache`；仅在私有 staging 准备绑定，不修改开发缓存 |
| 官方锁定 electron-builder 的 `TraversalNodeModulesCollector`、`NodeModuleCopyHelper` 和 DMG target | 直接复用生产依赖遍历、版本提升、包文件过滤及 HFS+ 压缩镜像生成；为 Shell 的两个运行时根目录分别收集，保留插件 peers 和许可 |

编译官方顶层库时使用独立输出目录，以保留官方基于 `import.meta.url` 的资源定位。原样构建 `desktop-dialog.html`、`recovery.html`、`profile-create.html`、`profile-selector.html`，不使用官方 `main`、`bin` 或 fork 的 `workbench`。

## 功能取舍

- 自己的创建项目引导取代官方首次向导；不写伪造的 completed/skipped 标记。
- 官方 `desktop-updates` 从 Host 组合中关闭，不检查或安装官方应用更新。
- 应用级更新由 Shell 主进程的 `createProjectUpdates` 管理，与项目、Profile、欢迎或恢复窗口是否存活无关。`product.mjs` 从应用 package.json 提供唯一产品版本；上游锁文件只承担运行时兼容性校验。原生入口调用同一个服务，状态写入应用 userData/updates，不写入项目目录。
- 官方 `desktop-profiles` 的应用级 Host 菜单条目禁用；主进程使用项目范围的官方 Profile 窗口／管理函数，DesktopSettingsController 和应用设置页面不实例化。
- 不实例化官方全局 Market Controller 或 Profile 管理器；市场 provider 从项目设置读取，在该项目启动前交给官方 Profile 组合。只读 Profile 身份仅用于让市场绑定当前项目并选择 `desktopPnpm` 包操作通道。
- fixed advanced、随机 loopback 端口、禁止 ordinary browser/LAN，由正式 settings schema 校验；非法变更在持久化前被拒绝。
- 模型页面与项目页保留；强制模型首次弹窗不参与组合。通知、终端、诊断、材质和日志已经接入自有设置及菜单。
- 已实现项目集合/窗口布局恢复、项目内多 Profile、官方恢复助手、配置检查点、第三方插件卸载接入、临时安全模式和本地 macOS x64 打包流程。工厂重置、环境迁移、Developer ID 签名公证和正式分发仍为后续工作。
- 开发期可用 `DSH_PROJECT_PLUGIN_SOURCE` 把配套插件指向本地工作区（见[开发说明](development.md)）：构建读取工作区源码，跳过固定树校验并打印警告；该开关不进入运行时，打包流程在设置时直接拒绝，发布产物始终使用锁定的插件提交。

GitHub Actions 的 `Package Desktop` 工作流按锁定提交从公开仓库准备依赖，在 Apple Silicon runner 生成 Universal DMG，分别在 arm64 和 Intel runner 启动同一产物；Windows x64 runner 生成 NSIS 与 ZIP。两平台共用独立 staging、生产依赖收集、许可保留与链接边界审计，选中的依赖文件实体化，安装包不回链构建目录。源码构建使用平台无关的路径判断；运行时 Profile 在 Windows 使用目录 junction，安全模式按不区分大小写的允许列表保留系统环境。各平台安装自检均在开发目录外启动打包应用，实际验收以对应 job 为准；产物、触发方式和签名限制见 [打包说明](packaging.md)。

## 升级策略

打包版默认启动 60 秒后、此后每 6 小时读取自有 Release 的 `latest/download/update.json` 静态附件。`src/app/update-manifest.mjs` 定义客户端与发布脚本共用的 schema：stable 版本、构建提交、固定仓库发布页，以及三个安装包的精确文件名、下载地址、字节数和 SHA-256。清单限制为 16 KiB，拒绝不完整、重复、异仓库或无效校验信息；选中安装包仍受官方下载大小上限约束。客户端不调用 GitHub REST API，不受其匿名 API 额度影响，也不向 GitHub 传递安装标识、认证令牌或上游专用请求头。

后台失败不打扰工作，同一版本只通知一次；手动检查复用官方确认、最新版本和失败窗口，并补充不含私有网络详情的连接、超时、无效清单或 HTTP 错误说明。GitHub ETag 只复用已经校验的清单；下载时重新读取已确认版本的 `download/v<version>/update.json`，以该版本的大小和 SHA-256 校验完整下载流，失败不得替换已有文件。不回退到匿名 API；GitHub 文件访问仍受网络、代理及其独立服务限制影响。下载期间欢迎窗口按钮按官方 `downloadingUpdate` 语义显示「正在下载 <n>%」，`busy` 只负责禁用；应用菜单与托盘保持官方文案，不追加百分比——macOS 不会重绘已展开的原生菜单，菜单里的百分比只能是打开那一刻的快照。进度刷新按整数百分比变化且不短于 500 ms 节流，且只推送到欢迎窗口，不重建原生菜单。

macOS 下载后打开 Universal DMG，用户替换应用；Windows 确认安装后先正常停止全部项目 Host，再启动可见 NSIS 安装器并退出。保留项目恢复集合；安装器启动失败则恢复项目并显示官方错误窗口。退出中止未完成下载，升级成功后沿用官方安装包保留/删除确认。便携 ZIP 在发布页面保留手动替换入口，暂不实现静默安装。

发布由 CI 在 Mac/Windows 打包、原生更新弹窗和同一 DMG 的 Intel 验收完成后执行。先上传并验证私有候选草稿；显式重发同版本时，旧版转为可恢复草稿，随后移动标签并公开候选。切换失败会尝试恢复旧标签和旧公开版。一般发布递增版本，`replace_existing` 仅供明确要求的重发；同版本的新旧包不会互相提示升级。

发布脚本从已校验的两平台产物生成 `update.json`，不包含本机路径或 CI 日志；三个安装包、三个校验文件及清单共七个附件在候选草稿中上传并验证摘要后才公开。随后通过无令牌的真实静态下载地址校验 latest、版本清单与校验文件，允许短暂 CDN 传播但不接受同版本旧提交。`yarn run smoke:updates:live` 在独立 Electron/userData 使用系统网络复验公开清单与真实官方“最新版本”窗口；可用 `DSH_PROJECT_UPDATE_COMMIT` 指定期望提交。它仅检查当前已发布版本，不下载安装包或触碰日常项目。

显式选择配套的 Desktop/Harness 版本，更新锁文件，在独立分支运行源码完整性、依赖版本、双 Host 与图形验收。验证通过才改变开发/发行基线。保留上一个锁定组合，不自动追踪最新版本。

不通过复制整个官方运行时大文件、打补丁或修改私有字段规避边界。确实需要拥有的窗口或产品逻辑写在 Shell 内；必要私有模块访问留在清单中，升级时逐项审查。
