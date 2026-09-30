# 独立 Shell 架构

## 设计目标

`dsh-project-desktop` 是独立的项目桌面壳，仅适配 stable。保留需要的官方能力，项目创建使用独立引导窗口，在组合边界选择启用的官方功能。项目内能力由独立 Project 插件维护。

官方 Desktop 与 DSH 都在快速变化，stable 仅指发行通道。目标是把升级影响限制在清晰的接入边界，避免长期维护 Desktop fork，并非保证每次升级零修改。

## 当前官方主进程（0.2.0-rc.2 开发分支）

`src/app/main.mjs` 已直接接入 `src/desktop-adapter/official/`。默认 setup、build、start 和 check
均不读取 `upstream.lock.json`、社区 Desktop 源码或旧 `.cache/runtime`。唯一上游 pin 是
`official-source.lock.json`；配套插件候选提交由独立 `project-source.lock.json` 固定。

| 负责方 | 当前职责 |
| --- | --- |
| Shell | 欢迎/创建/打开/切换项目，菜单、窗口位置、多窗口生命周期、共享主题与 DeepSeek 登录账号 |
| Project 插件 | 官方主窗口中的项目页面与工作区替换 |
| DeepSeek | Host、Web 主界面、聊天/模型/设置，以及已有原生桥接实现 |

### 官方模块与适配理由

- `project-window.mjs` 直接使用从官方 `apps/desktop/src/host-process.ts` 编译的 `DesktopHostProcess`。
  每个项目有独立 DSH Home、`profiles/desktop`、随机 loopback 端口、Cookie 和持久化 Chromium 分区。
  原生窗口参数以官方 `main.ts/createWindow` 为来源，Shell 补窗口位置、标题、焦点和关闭回调。
- `profile.mjs` 调用官方 `dsh-app-boot/initProfile`，添加 Project bundle 和随机端口。
  只接管带有本适配器来源/项目标记的 Home。旧 Stable Home 会被拒绝且保留原字节，等待独立迁移。
- `web-session.mjs` 复用官方 `web-document.ts` 的静态页面、认证与 HTTP 转发逻辑。
  WebSocket 同时校验项目 Session、WebContents、Host 地址和 Origin；重开前释放旧协议处理器。
  关闭时取消该 Session 的在途 HTTP 转发；正常关闭导致的取消返回 410，其他错误保持原样，不影响别的项目。
- `build-official-native.mjs` 原样编译官方 `keyboard.ts`、`directory-picker.ts`、`welcome-backend.ts`、
  `device-info.ts`、`locale.ts`、`browser-guests.ts`、`platform-view.ts` 和 `microphone-permissions.ts`。
  `scoped-electron.mjs` 将单窗口实现的 IPC 注册点改为 `webContents.ipc`，不改官方快捷键/目录选择行为。
  当前键位配置保存在各项目状态目录，避免两个官方单写入协调器竞争同一文件。
  「文件 → 关闭页面」保留官方 `page.close` 的弹窗/右侧页面/窗口上下文语义；
  Shell 的「关闭当前项目」放在「项目」菜单，与重启相邻，沿用 `CmdOrCtrl+Shift+W` 及项目关闭确认。
  Platform 账号分区名另加项目命名空间，避免相同账号跨项目共享 Cookie。
- `project-ipc.mjs` 只接收所属 `dsh-app://app/` 主 Frame；API Key 和语言读取官方 Welcome Backend，
  不伪造 onboarding 完成。浏览器、平台页面和麦克风桥接继续复用上述官方 helper。
- `account-session.mjs` 适配官方 `main.ts` 的账号订阅，直接调用 `welcome-backend.account.watch`。
  每次授权只打开一次带当前 nativeTheme 的官方链接，失败/过期/成功聚焦所属项目；关闭先释放订阅。
  官方 Host 负责 PKCE、state、loopback `/oauth/callback` 和凭据，Renderer 负责登录弹窗、账号状态与注销。
  自有欢迎页不随单项目注销被全局替换。错误日志不携带授权 URL。
- `shared-account-store.mjs` 在启动所有 Host 前接入应用级 `userData/account/.credentials.yaml`。
  首次仅从本壳拥有的官方 Home 接入单一已有登录；多个不同登录明确报冲突。共享文件即使为空也作为权威，
  退出后不会从旧项目记录恢复登录；旧文件保留用于回退。使用官方 parser、跨进程锁和 0600 原子写入。
- `shared-credentials-host.mjs` 是壳自己的 Host 适配入口。`account-credentials.mjs` 完整继承官方
  `LocalCredentialProvider`，只把 `deepseek-account-platform/default`、`device` 路由到共享的第二个官方 provider。
  `resolve/describe/set/unset` 的环境优先级及其他 record 原样继承；API Key、第三方授权与
  `client-connection/browser-session` 仍按项目隔离。共享记录变更通知官方账号服务，删除时触发官方账号任务取消。
  `profile.mjs` 只在 Host 启动前切换凭据 provider 的组合入口，保留已有配置和 YAML 注释；不修改运行中的 Profile。
- `shared-account-sessions.mjs` 在所属项目的 `dsh-app` HTTP 转发处协调官方账号请求，先执行官方参数验证。
  所有窗口的登录/退出操作进入同一队列，后发登录取消另一窗口的旧尝试；退出等待其他 Host 的授权提交结束，
  再通过官方 signOut 清除和撤销账号。官方确认弹窗的任务影响查询汇总全部打开的 Host，查询失败保留“未知”提示。
  关闭项目撤销新账号请求并等待已受理操作，账号凭据从不进入 Renderer、项目 manifest 或任务记录。
- `deep-links.mjs` 接收 macOS `open-url` 与启动/第二实例参数中的精确 `dsh://open[/]`，准备完成前排队。
  协议仅唤起，不能传 token/code；多项目优先最近发起登录且仍存活的窗口，取消/关闭撤销该目标。
  成功状态先聚焦所属窗口，解决协议本身不携带项目 id 的限制。仅 packaged 或显式
  `DSH_DESKTOP_DEV_APP=1` 注册系统协议，普通开发不抢占安装版关联；签名安装包的协议声明仍待发行接入。
- `host-environment.mjs` 全应用共享一次官方 `login-shell-environment.ts` 读取，给 Finder/Dock 启动的 Host
  补回用户 shell 环境。官方保留 DSH/ELECTRON 启动变量；Shell 最后覆盖项目 DSH_HOME、manifest 和遥测禁用。
  退出取消官方 shell 探针。环境值不写日志，也不全局覆盖 Shell 的 `process.env`。
- `windows-chrome.mjs` 适配官方 `main.ts` 中未导出的 Windows 菜单/外观处理；标题栏高度直接编译
  `windows-layout.ts`。保留主 Frame 身份校验、颜色/坐标校验、缩放换算与 `shortcuts.sendEditingKey`。
  Application 菜单组合 Shell 的创建/打开/切换/重启命令，销毁窗口主动关闭在途 popup。
  官方右键菜单的分隔与 Windows 当前语言文案一并保留。Windows 原生验收仍待执行。
- `session-end.mjs` 沿用官方系统关机/注销识别：Windows 只接受确定的 `session-end`，不把
  `query-session-end` 当退出；macOS 接收 power shutdown，用户重新显示/聚焦窗口时清除取消的关机标记。
  系统退出沿用整个应用收尾并保存恢复集合，跳过交互确认；普通项目关闭仍走官方运行任务确认。
- `host-settings.mjs` 使用官方 `settings/describe`、`settings/update` RPC 同步共享主题，携带 namespace revision。
  官方 `ThemeRuntime.setTheme` 先更新 DOM，再异步保存 `ConfigForm`。`theme-sync.mjs` 在最多 10 秒内等候
  Host 保存值与通知一致，再同步 SharedTheme 和 nativeTheme；单次读取不一致不能丢弃通知。
  后续通知取消过时读取，关闭项目取消等待及在途请求。启动临时色同样经过保存值校验，避免覆盖全局选择。
- 窗口等待官方 boot gate、transport 和加载页退出。启动失败统一清理；Host 停止未确认时保留 Registry
  所有权并允许重试，不能启动第二个 Host。运行中失败回欢迎页，只影响所属项目。
- `quit-guard.mjs` 复用从官方 `quit-confirmation.ts` 编译的 `DesktopQuitConfirmation`，检查来自真实
  `DesktopHostProcess.inspectQuit()`。关闭/重启检查单个项目，应用退出汇总所有项目；检查失败按可能有运行任务提示，
  同时保留其他 Host 已知的计划提醒。只适配品牌、动作与项目范围文案，保留官方按钮顺序、默认键和取消行为。
  `ProjectWorkspace` 在项目队列内检查，重复动作合并；应用退出先等待已受理的打开/关闭操作，确认前不停止 Host。
  取消或弹窗失败保留运行状态；确认退出后才取消创建事务、停止所有项目，并保留下次恢复的项目集合。
  Host 停止前先等待已受理的 IPC 请求与单向主题通知完成，并撤销旧 Session 的 HTTP 转发。
- 引导页使用 Shell 自有布局常量与 CSS，直接编译固定官方 locale/primitives/theme 和 Project 的资源控件。
  不再加载社区 AdvancedFrame、样式安装器或 window-options。

`tests/official-shell-imports.test.mjs` 校验实际主进程模块图和欢迎页构建输入中没有社区依赖。
`tests/*.legacy.mjs` 与下方旧架构用于删除审计，不进入默认测试。

### 原生接入的验证范围与发行门禁

`yarn smoke:official-shell` 检查真实双窗口、官方 bridge、browser lease 分区、所属 Host 请求阻断及其他 Host 认证。
`DSH_OFFICIAL_ACCOUNT_SMOKE=1` 额外在线调用官方登录初始化/取消，从真实官方菜单与弹窗操作，并在 OS
`shell.openExternal` 边界截获 URL，验证原生监听、主题参数与项目唤回；不提交用户凭据，不代表账号授权成功。
官方 browser helper 直接阻断当前 Host；其他项目 Host 由独立 Cookie 认证拒绝访问，不宣称 guest 禁止所有 loopback 网络。

`yarn smoke:official-account-sharing` 在临时 userData 和本机 Platform 夹具上执行真实官方 PKCE、回调、
授权交换、账号状态订阅与注销；验证只登录一次、双窗口与新窗口/重启、官方取消/确认、并发登录及退出期间的回调清理。
该夹具不使用真实账号，不代表线上账号授权或平台充值验收。

`project-updates.mjs` 通过官方预加载 `updates.status/open/subscribe` 接入原样的账号右侧
`DesktopUpdateIndicator` 与 `DesktopUpdateBadge`；空闲隐藏，连接状态优先，多个项目共享同一应用状态。
`build-official-updates.mjs` 从固定官方源码编译 `DesktopUpdateCoordinator`、`DesktopUpdateSchedule`、
`DesktopUpdateDialog`、`DesktopUpdateOverlays` 和 presentation，原始 renderer/preload 输出到自有 dist。
对话框走独立 default Session 的 `dsh-app://shell` 白名单；项目 Host 和分区不接管 shell 文档。
更新弹窗期间快捷键使用官方 overlay input 状态。长更新操作归应用持有，项目 IPC 不等待安装关闭自身。

自有 `ProjectReleaseUpdater` 适配官方检查、下载和事件契约，仅访问本仓库 `update.json` 与固定版本安装包。
下载前重读版本清单并核对已确认的 commit/资产，限制清单与包大小，验证流的字节数与 SHA-256 后原子落盘；
交接前再次校验本地包。手动检查入口位于应用菜单/托盘，打包版启动 60 秒后开始后台检查及 6 小时间隔轮询。
失败、取消和关闭弹窗不授权安装。官方安装器要求不同的发行格式，因此仅复用其完整 check/download 协调逻辑；
本壳保留已发布安装包契约：macOS 明确提示打开 DMG 后手动安装，Windows 确认后先关闭全部项目再启动 NSIS，
启动安装器失败则恢复项目。Windows 安装交接仍需真实机器验收。

`yarn smoke:official-updates` 使用临时发行传输夹具验证官方侧栏及弹窗、双窗口状态、检查与下载失败、
进度、确认/取消、窗口关闭和重开；安装交接边界被截获，不运行测试安装包。

发行前仍须完成强制版本策略、全局 CLI 安装、签名安装包与协议关联、Windows/macOS Intel 实机验收、
真实账号授权后的用量/充值交互、Stable 数据迁移回退。
Windows 官方 preload 的 mandatory overlay 在开发无策略时允许 status 请求失败，本壳沿用此开发行为；
不能接入官方发行源让其安装原版覆盖 Shell。原版 Welcome/CLI 专用窗口及 IPC 不计作当前项目主窗口漏接。

### 验证边界

当前真实平台为 macOS arm64。正式主进程已验证欢迎页创建、两个项目、真实 API Key 状态、快捷键 IPC、
关闭/重开/重启、共享主题、旧数据拒绝接管和关闭后 owner/协议释放。
关闭确认另以真实 Jobs 后台任务和显式启用的官方 Schedule 提醒完成原生确认/取消、多项目隔离、应用退出、
中英文、明暗和键盘验收；Schedule 测试组合不改变默认生产 Profile。
开发运行目录保持未签名。0.2.0 打包阶段会校验并嵌入官方运行时与固定插件的生产依赖闭包，见本文末尾发行边界。
登录后账号页面、真实浏览器会话、麦克风、完整快捷键编辑/物理按键、`dsh://open`、
用户数据迁移回退仍未实现。Windows 与 macOS Intel 安装产物必须由对应 CI 原生任务验证，具体发行结果以该版本 CI 为准。

## 旧 Stable 架构（仅供删除审计）

以下章节描述已发布 0.1.11 的社区实现。其中的“官方 Desktop”历史措辞指社区包装层，
不能据此恢复社区私有模块。当前实现以以上分工与官方源码 pin 为准。

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

Profile 分隔插件依赖、补丁和检查点，不代表整个 Home 独立。Harness 0.1.7 把可编辑设置写入当前 Profile 的 `cordis.patch.yml`；旧 `settings.yaml` 会由官方设置服务导入并保留改名后的副本。市场选择也保存在当前 Profile 的自有 Shell 条目，重启该 Profile 后生效。市场包操作绑定实际运行的 Profile。项目资料与会话不在配置检查点内。

原生能力桥使用官方 `HostRpc`、`createHostRuntime`、`bindNativeRuntime`。我们给自己提供的 runtime 增加项目窗口能力，官方桥和源码保持不变。每个窗口使用唯一 Chromium partition、官方 sandbox/contextIsolation preload，在该 Session 内换取官方认证 Cookie；专属访问头只注入所属 Renderer 的同源 HTTP/WebSocket，不随外链或 iframe 泄漏。窗口 Session **不安装任何 Web 权限处理器**，与官方 Desktop runtime 一致：官方客户端 UI 的消息、代码块、终端、表格和 JSON 树复制入口都走 `navigator.clipboard.writeText`，而 Electron 43 把该请求报成 `clipboard-read`，一旦按 deny-all 拦截就会让复制静默失效（UI 侧吞掉异常且不显示反馈）。Web 安全边界因此只由 webPreferences、导航／弹窗／webview 拦截和专属访问头承担，权限与下载都交回 Electron 默认行为（官方同样没有 `will-download` 策略）；`tests/renderer-security.test.mjs` 断言两个窗口模块不再出现权限处理器或 `will-download`，避免该缺陷回归。

适配器常在自有文件里实现官方对象，此时字段和副作用都属于与固定官方代码之间的契约。升级需对照官方 `runtimeSnapshot`、窗口创建、设置和 Renderer 消费者逐项检查。Desktop 2.0.15 移除了 Windows Mica/Acrylic 和平台策略的材质刷新方法；项目和引导窗口在 Windows 使用实体背景。macOS 的透明玻璃由官方 `advancedWindowOptions` 在创建窗口时配置，主题变化由应用级 `SharedTheme` 更新 `nativeTheme`，不再额外刷新材质。

应用共享的 `SharedTheme` 负责设置 `nativeTheme`；项目窗口的 runtime 负责把主题变化传播给当前 Renderer。材质切换依赖官方平台策略，且只对当前项目窗口提示重启。

`dsh-project-shell` 是我们自己的双面插件。Host 面只注册固定 advanced/loopback 的设置 schema、窗口规格及官方健康上报端点；原官方 desktop-shell 条目被配置禁用。Client 面调用官方 advanced、窗口几何、主题呈现与健康报告，接入 Project 客户端，不调用官方应用设置的全量注册函数。

Harness 的模型插件把设置页面和首次弹窗注册放在同一个入口中，因此使用约 30 行自有组合，直接导入固定的 ModelsSection、store、operations、schema 和 locale，实现原始模型页面与刷新订阅。源文件与 CSS 保持原样，只不注册 `settings.onboarding` 两个条目。不存在 CSS 隐藏、修改上游 bundle 或伪造 onboarding 完成状态。

预 Host 的欢迎窗口使用本地 CSP 页面、隔离 preload、限选 IPC，负责最近项目、新建／打开和丢失项目文件的重新定位，不再承载检查点／安全模式操作。欢迎页及原生菜单的新建入口复用一个独立 BrowserWindow，使用单独 Chromium partition 和 `?mode=create` 页面，只显示左侧项目组合与右侧创建表单；再次打开时聚焦已有窗口并保留草稿，取消只关闭创建窗口。新建项目的父目录可输入或通过原生选择器取得，由主进程 bootstrap 校验；关联资源目录及项目重新定位文件仍由主进程原生选择器取得。项目创建由自有 bootstrap 事务负责：根目录初始化一个 Git 仓库，新建资源各自初始化独立 Git 仓库并写入 `AGENT.md`，根 Git 精确忽略子资源目录；已有外部资源只记录本机绑定，不初始化、不覆盖、不删除。Host 通过自有 Shell 适配器在每次项目上下文组装时读取根目录和资源根目录的 `AGENT.md`，单文件和总上下文都有大小上限；外部资源有就读取，没有就跳过。复用插件构建出的项目文件工具，以排他创建方式落盘；失败后重试会复用唯一已有项目。控件、图标、theme CSS 和 LocaleRuntime 来自同一固定 Harness；独立打包时强制 React/ReactDOM 使用同一份 stable 实例。

项目创建中的 Git 初始化、检查和远程克隆通过异步子进程执行，网络等待不会阻塞 Electron 主进程。每次操作保留五分钟超时及有界输出；关闭创建窗口或退出应用会取消尚未完成的创建，先停止 Git 及其传输子进程，再异步清理本次新建的目录。应用退出等待清理完成。创建期间禁止重复创建或提前打开该项目，完成后的 Host 启动失败仍可复用项目文件重试。

新建资源的“关联远程仓库”使用弹窗填写地址与可选初始分支，保存时校验格式并立即异步克隆。Project 固定提交更新为 `77f0430`，复用其中的 `ResourceCloneManager`、`ProjectResourceStore`、`ResourceGitAuthentication` 和原始认证弹窗／控制器／设置布局；固定 Desktop/Harness stable 未变。预 Host 的 IPC 适配与源码导入都集中在 `desktop-adapter/stable/guide-resources*`，构建直接编译固定源码，不复制插件实现，也不为引导启动共享 Host。认证先沿用系统 Git，需要时请求本次操作的 HTTPS 用户名与密码／令牌或 SSH 私钥与口令；仍保留插件的地址重写、SSH 主机验证与凭据不落盘边界。

Shell 的 `GuideClones` 仅负责临时目录及创建事务衔接：每个资源在应用 userData 的 `creation-drafts/draft-*` 中独立克隆，卡片显示阶段／进度、取消或错误；项目名称与目标父目录仍可编辑。只有状态为 completed 且地址和分支匹配的资源才能安装，创建时复制完整仓库到最终相对路径并再次检查 Git 根、origin 与指定分支，不重复请求远端。原 staging 保留到整个创建成功，保证创建失败能重试；切换模板、取消关联、移除资源、关闭窗口与退出应用负责取消并清理对应 staging，不删除外部关联目录。启动持有单实例锁后清理带有本应用标记的遗留草稿。引导克隆使用插件原有的 30 分钟操作超时及 5 分钟认证等待，普通 bootstrap Git 操作继续使用上述五分钟超时。

欢迎窗口的“打开”原生选择器同时允许文件和文件夹（Windows/Linux 无法在一个对话框里双选，会退化为文件夹选择，遇到一个目录里有多个项目文件时再补一次文件选择）。选中的路径先由 Shell 的 `classifyProjectTarget` 分类，再交给固定插件的项目文件解析，因此“没有项目文件”“有多个项目文件”都以欢迎窗口自己的中英文案呈现，而不是只拿到插件的中文提示；菜单与窗口标题栏的“打开项目…”走同一套判定。

“克隆仓库”复用同一套克隆与认证链：`RepositoryImports` 在选定父目录下为仓库名新建目标，校验地址、分支、文件夹名和目标是否存在后交给 `GuideClones` 克隆，完成后复制到目标并只接受根目录恰好一个 `.agent-project` 项目文件；没有项目文件时删除刚克隆的内容，有多个时保留并在提示中给出路径，成功则直接打开该项目。欢迎窗口的导入弹窗复用插件的 `ProjectScrollableModal`、`ProjectSettingRow` 与认证控制器，显示真实克隆阶段与百分比。

欢迎窗口的导入弹窗与项目内的目录选择都记住上次用过的目录（`src/app/last-directories.mjs`，写在应用 userData 的 `last-directories.json`；读取时重新确认目录仍然存在，损坏或非法的状态文件重命名保留而不是阻塞窗口）。欢迎窗口用 `import` 键：浏览选中或成功发起一次导入即记住。项目内的资源、资源重定位与技能导入共用 `resource` 键：走 Shell 自有 runtime 的 `pickDirectory` 时以它为 `defaultPath`，选完即记住。Windows 的目录选择正好落在这条路径上：固定 Desktop 的 `profile.ts` 在 win32 上禁用 `directory-picker`（auto 后端）并插入 `dsh-host-directory-picker-browse`，Host 侧 `directoryPicker` 的能力位因此是 `browse`，插件的 `pickSource` 选择 `desktop`，目录选择交给 Shell 自有的 runtime。macOS 与 Linux 保留 auto 后端，由它按平台探测（Linux 还看 zenity/kdialog 是否存在）决定 native 还是 browse；走 native 时由固定 Desktop 的官方选择器负责，Shell 不介入那条路径，那里沿用官方实现与系统对话框自身的行为。

手动“添加资源”沿用资源页的先填写、后加入流程，默认本地目录，也可切换 Git 仓库；模板仍可以预置空资源。Shell 的 `AddResourceModal` 只管理尚未创建项目的表单草稿，直接复用插件的 `ProjectSelect`、`ProjectScrollableModal`、`ProjectSettingRow`、`ProjectSettingsCard`、文案和样式，不挂载需要现有项目 Host 的 ResourcesPanel。主进程只检测原生选择器选中的目录，适配器调用固定插件的 `inspectResourceGit`，返回名称与安全的 Git 信息。选择 Git 类型的本地资源在最终创建时重新核验 origin，并保存类型与 URL；引用文件保持原位。远程名称和目标目录按地址建议，手动修改后不被覆盖；名称与目标路径独立，编辑名称／仓库不重置已选目标。客户端和创建事务共同校验目录边界及目标重叠，确认远程添加立即开始复用的异步克隆／认证，取消未保存表单不新增卡片。

全新检出后项目根下没有 `resources/` 目录：根 Git 精确忽略每个子资源，所以新机器上所有 Git 资源都是缺失状态。项目窗口进入 `open` 后，主进程读取 Host 的资源快照，对「类型为 Git、声明了远端地址、目录为 ENOENT、没有机器本地绑定、也没有既有克隆作业」的资源逐个调用插件的资源克隆 API，并等前一个作业终结再推进（插件一次只允许一个克隆）。打开不等待克隆，失败只记录日志、仍可在资源页手动重试；安全模式、自检与测试模式不触发。机器本地绑定与项目外目录是用户决定，不覆盖；已有失败作业留给插件面板重试，避免每次打开都重复一次注定失败的克隆。

`ProjectRegistry` 管理同一项目并发打开、启动取消和关闭。若 Host 停止未确认，继续保留所有权并拒绝再次打开，避免两个 Host 同时写一个 Profile。

`ProjectWorkspace` 在 Registry 上增加每项目独立的操作队列，把打开、关闭、重启和恢复串行化。`workspace-session.json` 保存恢复集合、最近激活项目及独立窗口布局，和 `recent-projects.json` 的历史记录分开。打开前记 `opening`，完整健康后记 `open`，异常记 `failed`，恢复窗口使用 `recovering`；主动进入恢复不记为故障。正常退出关闭资源但保留集合，主动关闭项目才删除集合成员。下次启动并行恢复 `open`，有效项目的 `opening/failed/recovering` 自动进入官方恢复助手，丢失项目文件留在欢迎页。每项目恢复独立，等待用户操作不占用生命周期队列，退出应用可正常关闭恢复窗口。

检查点适配器只在完整 Host/Renderer 健康后调用官方 `captureHealthy()`，保留每 Profile 三槽轮换及恢复后跳过覆盖的规则。恢复入口先停止所属 Host，然后使用官方 `DesktopStartupRecoveryWindow`、`startup-recovery-controller` 的代际绑定、短期预览 token、文件校验及恢复。依赖声明变化时调用官方 materializer；自有 pending 文件按 Profile 跨进程保留恢复未完成状态，只阻止相应 Profile 启动。旧 `desktop` journal 保持原路径。选择另一 Profile 后旧预览失效，不能再写入旧 Profile。插件卸载委托官方 `removeRecoveryPlugin`，自带 Project 插件仍受开发依赖边界保护。

手动恢复、启动失败、Host／Renderer 崩溃均打开所属项目的官方恢复助手，语言沿用该项目。修复后重启／安全模式／关闭仅作用于该项目；安全模式关闭后返回恢复助手。未确认 Host 停止或状态所有权时，仅提供官方诊断界面，不授予配置、Profile 切换或恢复写入能力。应用级 DSH Home 迁移和工厂重置不提供能力，官方对应页显示不可用。恢复 UI 不依赖失败项目的 Host、Renderer 或插件。恢复原因只作为窗口 query 参数交给官方恢复助手，窗口一关就消失，而 Host 日志在恢复之后才可能存在；因此壳把每次进入恢复的原因追加到项目状态目录的 `recovery-events.jsonl`（`src/app/recovery-journal.mjs`，有界且只保留最近记录），字段含来源（`startup-restore`／`open`／`restart`／`runtime`／`safe-mode`／`manual` 等）、`requested`、只读降级、失败阶段与详情、会话阶段和 manifest 路径。写入失败只记一行错误，不改变恢复行为；该文件是壳自有诊断记录，不进入官方诊断包（导出器只收 `dsh-<日期>.log`）。

应用启动与打开项目的耗时有同一条常开追踪（`src/app/boot-log.mjs`）。启动失败会给出一句“Host call cancelled or timed out”，离线探针只在开发机上分阶段测量，两者都答不了“这台机器上到底是哪一段慢”，所以在真实进程里按阶段打时间戳：`boot` 是一次启动（从 `run()` 入口到欢迎窗口或首个项目窗口出现），`project/open:<项目>` 是打开一个项目（解析项目文件 → Host 监督 → 分阶段启动 → 建窗 → 渲染进程认证 → `loadURL` 与健康上报 → 启动检查点）。追踪对象显式传递而不是模块级“当前会话”——一次启动可能并行打开多个项目，它们的阶段会交错。写 `<userData>/boot.log`，每次写入都是同步追加一行（微秒级），超过 `DSH_PROJECT_BOOT_LOG_BYTES`（默认 256 KiB）时按半量截断保留最新记录；`DSH_PROJECT_BOOT_LOG` 指定别的文件（设为空字符串即关闭），`DSH_PROJECT_BOOT_TRACE=1` 同时把同样的行打到 stdout。单阶段 ≥ 1000 ms 打 `[SLOW >1000ms]`，一条追踪结束时输出 `total` 与最慢阶段。

Host 是独立 `utilityProcess`，而打开项目最贵的一段就在它内部：首次 Profile 准备会跑受 120 秒预算约束的 pnpm 依赖实体化，之后还有官方插件树与 loopback 渲染服务器。因此监督进程把日志路径与会话标签经子进程环境传下去（`DSH_PROJECT_BOOT_LOG_FILE`／`DSH_PROJECT_BOOT_SESSION`），Host 用 `hostTrace()` 追加进同一段追踪（`profile prepare: pnpm dependencies`、官方 Host 启动、渲染进程注册），否则壳只能说“boot RPC 花了 25 秒”。恢复原因除了写入 `recovery-events.jsonl`，也一并记进该次追踪，方便一次性带走。

官方 `boot()` 内部原本只有一个数字（`official host booted`），而它同时盖住 Loader 装载、整棵插件树与 loopback 渲染服务器——同一份追踪在 Windows 上是 28 秒、在 macOS 上是 3 秒，读起来完全一样。因此 Host 把这段等待拆成自己可计时的几段（`official host modules resolved`、`official host log sink ready`、`official loader mounted`、`official runtime services provided`、`official actions service mounted`、`official cmdline provided`），并由 `stable/plugin-load-trace.mjs` 监听 Loader 的生命周期事件，在 `official host booted` 之后补一行 `official plugin tree settled`（已装载入口数、失败数、最慢入口），超过 1000 ms 的入口再记一行 `official plugin loads over 1000ms`。汇总写在 `official host booted` 之后，是为了不改动那一阶段一直报告的等待量；`FiberState` 在 vendor 里是 `const enum`、运行时无导出，所以该模块把它读取的两个状态值固定在文件里，未知状态一律忽略而不是猜测。

项目工具菜单里的“导出日志与诊断…”是这些证据的唯一出口：它实现官方 `DesktopRuntime.exportDiagnostics` 契约——**方法名必须保持官方名**，因为固定 Host 的 `bindNativeRuntime` 按名分发 `native:exportDiagnostics`（0.1.9 曾把它改名为 `exportLogs`，官方入口随即以 `Cannot read properties of undefined (reading 'apply')` 失败）——写入一份报告（环境与数据来源、启动与打开项目追踪全文、各项目恢复原因清单），并把项目自己的官方诊断 zip（`dsh-diagnostics-*.zip`）复制到同一目录，随后在文件管理器中定位。固定 Host 的 `desktop-diagnostics` 插件还会注册自己的“导出诊断信息…”条目（`group: 'tools'`、`order: 20`），它与本入口写同一份证据，因此壳在 `registerTrayItem` 里按组、序号与官方文案三者同时匹配后丢弃该重复项（`stable/official-tray.mjs`）；三者任一不符即保留，避免误删未知命令。报告与 zip 并排放置而不是互相替换：日志要能直接用编辑器打开，压缩包则满足官方诊断格式。导出失败复用官方 `diagnosticsErrorTitle`／`diagnosticsErrorMessage` 文案。

`project-native-windows.mjs` 集中持有官方窗口实例。stable 2.0.15 没有 ready/dispose 公共接口，因此适配器只读取其 `window` 引用，增加项目标题并在后台操作结束后销毁该 BrowserWindow；结果结算仍走官方 `closed` 处理，不修改内部字段。升级时检查此处并优先替换为官方公开接口。官方本地窗口继续使用原有 sandbox、无 preload／Node 的内存 Session；操作 token 与回调按项目窗口隔离。

桌面设置使用 Harness 0.1.7 的 `configForms` 和官方 `settings.section` 插槽，复用官方 Button/Menu/Switch。自有 Shell 设置由当前 Profile 的 `cordis.patch.yml` 持有；仅组合通知、macOS 材质、日志和当前项目原生操作，不注册原来的模式/Profile/应用更新页面。设置页头通过 `settings.action` 插槽提供导出诊断、打开 DSH 终端及重新加载/重启/恢复模式菜单。所有重启操作由项目窗口自己的 runtime 处理，不影响其他项目。模型、主题、语言等其他页面仍由已有官方服务提供。

材质保存后沿用官方设置监听流程，异步请求所属项目的重启确认。设置页菜单、原生菜单和 Host 发起的重启／恢复请求共用该确认入口：直接调用 `desktop-dialog-window.showDesktopMessageBox` 和原始 `DesktopDialogWindow`，使用官方 `desktop-dialog` 页面、组件、图标、字体与主题样式，不调用系统 `dialog.showMessageBox`。构建在临时目录通过官方 Vite/React/Tailwind 配置编译原封不动的 native-ui 源文件，产物放在官方模块预期的 `lib/native-ui/`，随运行时一同打包。文案复用 `tray-locale.desktopRestartConfirmationCopy`，仅将应用级描述适配为当前项目，默认聚焦取消。取消保留已保存设置和当前窗口；确认后才停止该项目 Host 并重建窗口或进入恢复界面。同一项目的并发请求合并为一次确认，关闭期间不再执行重启；日志、通知与主题的即时更新不触发该弹窗。

stable 默认启用随固定 Desktop 依赖提供的 `dsh-market`，也可在当前项目设置中关闭；官方 Profile 组合负责过滤未选中的 provider，并把 `dsh-market` 显式绑定到实际运行的 Profile。Shell 向市场提供只读的当前 Profile 身份，使其使用官方 `desktopPnpm` 可恢复包操作服务；该身份不提供创建、选择或删除 Profile 的能力，Profile 窗口由主进程管理。产品自带 Project 插件使用 `devDependencies` 本地 link，市场只管理普通依赖，不能从市场误卸载产品核心插件。`dsh-community-market` 当前要求 DSH 0.1.6 alpha，在 stable 页面中只展示为不可用选项。

欢迎窗口只承载应用级入口，不创建共享 Host。普通设置默认在项目 Home 内共享；不同项目保持独立，应用只共享明暗主题。

`SharedTheme` 拥有应用级 preference，只同步 `system/light/dark`。各 Host 的官方 `settings/updated` 事件触发协调，原子保存应用 theme.json 后统一更新 Electron nativeTheme 及所有 Host 的 ui-theme；广播写入不再广播。不共享字体、语言、模型；菜单语言随当前项目窗口改变。

欢迎窗口默认 900×640，新建窗口默认 980×720。二者通过 `guide-window-options` 直接调用官方 `advancedWindowOptions`，复用主窗口的原生标题栏与 macOS sidebar vibrancy。Desktop 2.0.15 在 Windows 使用实体背景；入口窗口材质不依赖项目 Profile，明暗由应用共享 `nativeTheme` 驱动。

`GuideFrame` 是官方 `AdvancedFrame.tsx` 的双栏最小适配：直接复用 `installDesktopOwnedStyles`、原始 pointer-capture／RAF 拖拽和原生标题栏布局，补充键盘调整与取消清理。固定 stable 的 1024px 自动折叠阈值、`DesktopLayoutState` 与列宽计算的侧栏上下限不可配置，私有 ResizeHandle 也未导出，因此适配器仅保留左右面板，并将侧栏上下限按官方值的三分之二独立管理：范围 176–280px，欢迎页默认 187px、新建页默认 190px；双击分隔线恢复各自默认值。保护右侧至少 400px；小于 576px 时转为顶部导航，新建页保留官方下拉选择项目组合。分隔线沿用官方透明悬停，仅键盘聚焦时提供焦点提示。扩宽恢复偏好宽度，拖拽结束／键盘调整分别保存 welcome、create 的本机宽度到 `guide-window-state.json`；v2 将旧 v1 宽度按三分之二一次性迁移。欢迎页品牌采用左侧 42×42px 图标、右侧标题与版本上下两行的排列，图文间距 4px，在侧栏和顶部导航中保持一致；底部说明下边距为 0。组合名称按需换行，适应更窄的导航。正文与导航各自使用稳定滚动槽，正文独立滚动，底部操作固定；不启动 Host、不修改官方源码。

内容区统一左右 24px 留白、底部 padding 为 0；正文的右侧留白分为组件与滚动槽之间 8px、官方滚动槽 8px、槽外 8px，稳定槽保持表单宽度不随溢出变化。标题、表单和 footer 共用同一左右边界，两个窗口 footer 均为 0 padding、最小高度 65px。新建页进入顶部下拉导航后隐藏重复的正文 header，恢复双栏时重新显示；添加资源与浏览使用同尺寸的官方 outline Button。分隔线显式区分鼠标与键盘焦点：从输入框点击分隔线时，不继承 Chromium 的 `:focus-visible` 高亮；按下、拖动与松开都保持透明，键盘操作仍有焦点提示。

正文与左侧导航保留官方滚动条的尺寸、形状和主题色，仅适配可见性：真实 scroll 事件立即显示，停止 800ms 后用 180ms 淡出，拖住滑块时保持可见。固定 stable 未提供自动隐藏控制器，因此由 GuideFrame 捕获本窗口的滚动事件并在卸载时清理计时器；CSS 注册透明度变量完成淡出，减少动态效果偏好下直接隐藏。隐藏不改变 overflow、滚动槽或组件宽度。官方弹窗与官方聊天表面保持官方常驻滚动条；项目窗口内插件页面的同类适配由插件侧 `src/client/scrollbar-auto-hide.ts` 与生成的滚动条规则实现，滚动容器清单在同一文件集中登记。

欢迎与新建页的加载反馈位于操作入口：最近项目的右侧状态区、打开按钮和创建按钮，不在正文末尾追加提示。固定 stable 的 Button 没有 loading 属性，因此组合其公开 Button 与 IconLoadingOutline16；通过重叠的隐藏标签和卡片状态槽预留宽度，保持卡片、按钮和表单尺寸稳定。浏览目录、选择文件和移除历史只锁定相关操作，不显示项目正在打开；文件选择确认后才接收打开阶段。创建文件与仓库完成后，主进程通过所属窗口的 guide-progress 事件报告 opening，每次操作携带独立 id，Renderer 忽略过期事件并同步拦截重复提交。等待超过一秒时固定 footer 显示真实阶段，阶段切换沿用同一位置；失败后清理加载状态、恢复操作并保留表单草稿。底栏最多两行，窄窗口不会挤掉底部按钮；减少动态效果偏好下加载图标保持静止。

项目 Host 的启动环境在继承壳进程环境之上补齐 Git 的连通性：壳在打开项目时通过 Chromium `resolveProxy`（含 PAC）解析一次本机系统代理，并对本地代理做短超时 TCP 预检；只有操作者没有自己导出 `http_proxy`/`https_proxy`（任一大写形式）时才注入解析结果。`no_proxy`/`NO_PROXY` 始终是「产品默认排除项 + 操作者既有排除项」的合并：不丢操作者或系统代理里配置的例外，同时保证 loopback（整个 `127.0.0.0/8` 与 `::1`）、私网与产品自有 fixture 不经代理。解析不出代理、结果为 DIRECT 或本地端口不可达时完全不注入，Git 保持直连；Safe Mode 沿用裁剪环境，不继承代理。

## 官方内部接入清单

新增恢复规则：初始 Profile 及早期无锁检查点，仅在依赖恰为自带 Project 的本地 link 时生成锁文件，不自动解析任意新增依赖。其他恢复必须使用冻结锁文件。固定 pnpm 11 的损坏缓存复用问题由自有适配器规避：通过官方 materializer 的 embedder spawn 接口附加新临时 store、force 和 copy 参数，重新校验下载内容，结束后清理该次 store；不改全局 pnpm 设置。失败保留 pending 和官方脱敏诊断。

安全模式复用官方 `safe-mode` 的路径/标记/reset/cleanup，并接入恢复助手的原始入口与确认窗口，不调用 compatibility 或首次向导入口。每项目停止确认后创建临时 dsh-home、desktop-state 和空白工作目录，仅加载官方基础 Profile 与自有 advanced Shell。Host 环境采用允许列表，阻止继承 API key、代理、npm hook 和 DSH 路径覆盖。Renderer 使用随机非持久 Session。退出等待 Host 停止后清除 Session 和临时目录，再打开原项目恢复助手；下次启动在所有 Host 创建前清理遗留临时树。故障项目不自动启动正常 Host；安全模式不捕获正常检查点、不覆盖正常窗口布局，主题不传播到正常项目。

原生菜单显式指定 app/edit/view/window 每个 role 的文案，保留原生行为和快捷键，避免默认子项继续跟随操作系统语言。macOS 应用名称菜单直接调用官方 `macApplicationMenuTemplate` 的应用分组，将应用级检查更新作为 additions 放在“关于”之后、“服务”之前；File 与项目工具仍由 Shell 组合。欢迎页聚焦时沿用最近项目语言。托盘与欢迎页继续提供更新入口；不额外建立帮助菜单或设置页版本浮层。关于面板由主进程用 `app.setAboutPanelOptions` 统一配置：应用名与壳版本取自有 `product.mjs`，并把当前固定运行时的 Harness 版本一并显示出来（锁与实际安装版本不符时 Host 拒绝启动，因此该值即实际运行版本）。macOS 把它放进 `version` 字段，面板的版本行因此渲染成「版本 0.1.8（DSH 0.1.7-rc.2）」——DSH 版本与壳版本同处一行、同一字号；Win32/Linux 的面板没有构建号字段，改由 credits 行输出 `DSH (DeepSeek Harness) <lock.harness.version>`。macOS 的「关于 DSH Project Desktop」走官方菜单的 `role: 'about'`；Windows/Linux 看不到原生应用菜单，因此自绘顶栏「项目工具」末尾追加同一面板的入口，经 Shell titlebar action `about` 调用 `app.showAboutPanel()`，两处显示内容一致。应用 bundle 身份由打包配置负责，不修改开发用 Electron.app。

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
| Harness `@deepseek-ai/dsh-native-command` 的 `revealNativePath`（经 `api-session-controller` 的 `sessionController.revealPath`） | 固定版本在 Windows 上用 `execFile('explorer.exe', …, {windowsHide:true})` 执行 reveal：explorer 是唯一“被启动进程本身即窗口进程”的 native 命令，隐藏启动使资源管理器窗口以不可见方式创建，表现为「在文件资源管理器中显示」点击无反应（同一菜单的「用默认应用打开」走 powershell，不受影响）。壳在自己的 Host 插件里只替换这一个方法（`src/desktop-adapter/stable/windows-reveal.mjs`），保留官方对 `/select,` 的 URI 目标（避免路径中的逗号被 explorer 截断）与“exit 1 视为委派成功”的容忍，仅改为不隐藏窗口；macOS/Linux 保留官方实现。`revealPath` 是官方内部字段，适配前做存在性校验并在缺失时明确报错，避免静默失效。上游到 `0.1.7-rc.1`（master）仍未修，pin 升级后需复查此适配是否可移除 |
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

## 0.2.0 官方发行边界

构建与发布工作流完全使用 DeepSeek 官方 `apps/desktop`，不再检出社区 Desktop。运行时沿用官方核心 tarball、过滤、描述清单、native/Office smoke；壳复用固定官方 `electron-builder`，仅适配独立主进程、品牌、自有插件、GitHub 发行和未签名安装包。插件位于已打包官方 `dsh/node_modules/dsh-plugin-project`，与其官方 peers 在同一运行时，生产依赖通过官方 builder collector 单独收集。源码路径配置文件不进入安装包。

原生目标为 mac-arm64、mac-x64、win-x64，每个目标必须通过搬移安装验收。macOS 无 Developer ID，因此保留本项目的 ad-hoc 签名；Windows NSIS 沿用本项目安装行为，不接官方 COS、签名账户或发布身份。v2 自有更新清单包含两种 macOS 架构，更新器保留 v1 读取能力。
