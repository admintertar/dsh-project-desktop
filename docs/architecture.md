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

Host 通过自有 `bootProjectHost()` 组合官方 Harness `boot()`、Profile 解析器、日志、命令环境与原生动作服务。刻意不实例化官方应用的 Profile、market 和 DesktopSettingsController，避免仅隐藏菜单后仍保留切换入口。图形应用使用 Electron `utilityProcess`，无图形检查使用 Node 子进程；两者共享同一入口和 RPC。`DSH_HOME` 与 cwd 在创建进程时确定，Profile 使用官方模板，状态根只接受本应用明确拥有的目录。

原生能力桥使用官方 `HostRpc`、`createHostRuntime`、`bindNativeRuntime`。我们给自己提供的 runtime 增加项目窗口能力，官方桥和源码保持不变。每个窗口使用唯一 Chromium partition、官方 sandbox/contextIsolation preload，在该 Session 内换取官方认证 Cookie；专属访问头只注入所属 Renderer 的同源 HTTP/WebSocket，不随外链或 iframe 泄漏。

`dsh-project-shell` 是我们自己的双面插件。Host 面只注册固定 advanced/loopback 的设置 schema、窗口规格及官方健康上报端点；原官方 desktop-shell 条目被配置禁用。Client 面调用官方 advanced、窗口几何、主题呈现与健康报告，接入 Project 客户端，不调用官方应用设置的全量注册函数。

Harness 的模型插件把设置页面和首次弹窗注册放在同一个入口中，因此使用约 30 行自有组合，直接导入固定的 ModelsSection、store、operations、schema 和 locale，实现原始模型页面与刷新订阅。源文件与 CSS 保持原样，只不注册 `settings.onboarding` 两个条目。不存在 CSS 隐藏、修改上游 bundle 或伪造 onboarding 完成状态。

预 Host 的欢迎窗口使用本地 CSP 页面、隔离 preload、限选 IPC，包含最近项目搜索和失败项目恢复。欢迎页及原生菜单的新建入口复用一个独立 BrowserWindow，使用单独 Chromium partition 和 `?mode=create` 页面，只显示左侧项目组合与右侧创建表单；再次打开时聚焦已有窗口并保留草稿，取消只关闭创建窗口。新建项目的父目录可输入或通过原生选择器取得，由主进程 bootstrap 校验；关联资源目录及项目重新定位文件仍由主进程原生选择器取得；恢复只能操作主进程已登记的失败项目及确认 token。项目创建由自有 bootstrap 事务负责：根目录初始化一个 Git 仓库，新建资源各自初始化独立 Git 仓库并写入 `AGENT.md`，根 Git 精确忽略子资源目录；已有外部资源只记录本机绑定，不初始化、不覆盖、不删除。Host 通过自有 Shell 适配器在每次项目上下文组装时读取根目录和资源根目录的 `AGENT.md`，单文件和总上下文都有大小上限；外部资源有就读取，没有就跳过。复用插件构建出的项目文件工具，以排他创建方式落盘；失败后重试会复用唯一已有项目。控件、图标、theme CSS 和 LocaleRuntime 来自同一固定 Harness；独立打包时强制 React/ReactDOM 使用同一份 stable 实例。

项目创建中的 Git 初始化、检查和远程克隆通过异步子进程执行，网络等待不会阻塞 Electron 主进程。每次操作保留五分钟超时及有界输出；关闭创建窗口或退出应用会取消尚未完成的创建，先停止 Git 及其传输子进程，再异步清理本次新建的目录。应用退出等待清理完成。创建期间禁止重复创建或提前打开该项目，完成后的 Host 启动失败仍可复用项目文件重试。

新建资源的“关联远程仓库”使用弹窗填写地址与可选初始分支，保存时校验格式并立即异步克隆。Project 固定提交更新为 `77f0430`，复用其中的 `ResourceCloneManager`、`ProjectResourceStore`、`ResourceGitAuthentication` 和原始认证弹窗／控制器／设置布局；固定 Desktop/Harness stable 未变。预 Host 的 IPC 适配与源码导入都集中在 `desktop-adapter/stable/guide-resources*`，构建直接编译固定源码，不复制插件实现，也不为引导启动共享 Host。认证先沿用系统 Git，需要时请求本次操作的 HTTPS 用户名与密码／令牌或 SSH 私钥与口令；仍保留插件的地址重写、SSH 主机验证与凭据不落盘边界。

Shell 的 `GuideClones` 仅负责临时目录及创建事务衔接：每个资源在应用 userData 的 `creation-drafts/draft-*` 中独立克隆，卡片显示阶段／进度、取消或错误；项目名称与目标父目录仍可编辑。只有状态为 completed 且地址和分支匹配的资源才能安装，创建时复制完整仓库到最终相对路径并再次检查 Git 根、origin 与指定分支，不重复请求远端。原 staging 保留到整个创建成功，保证创建失败能重试；切换模板、取消关联、移除资源、关闭窗口与退出应用负责取消并清理对应 staging，不删除外部关联目录。启动持有单实例锁后清理带有本应用标记的遗留草稿。引导克隆使用插件原有的 30 分钟操作超时及 5 分钟认证等待，普通 bootstrap Git 操作继续使用上述五分钟超时。

手动“添加资源”沿用资源页的先填写、后加入流程，默认本地目录，也可切换 Git 仓库；模板仍可以预置空资源。Shell 的 `AddResourceModal` 只管理尚未创建项目的表单草稿，直接复用插件的 `ProjectSelect`、`ProjectScrollableModal`、`ProjectSettingRow`、`ProjectSettingsCard`、文案和样式，不挂载需要现有项目 Host 的 ResourcesPanel。主进程只检测原生选择器选中的目录，适配器调用固定插件的 `inspectResourceGit`，返回名称与安全的 Git 信息。选择 Git 类型的本地资源在最终创建时重新核验 origin，并保存类型与 URL；引用文件保持原位。远程名称和目标目录按地址建议，手动修改后不被覆盖；名称与目标路径独立，编辑名称／仓库不重置已选目标。客户端和创建事务共同校验目录边界及目标重叠，确认远程添加立即开始复用的异步克隆／认证，取消未保存表单不新增卡片。

`ProjectRegistry` 管理同一项目并发打开、启动取消和关闭。若 Host 停止未确认，继续保留所有权并拒绝再次打开，避免两个 Host 同时写一个 Profile。

`ProjectWorkspace` 在 Registry 上增加每项目独立的操作队列，把打开、关闭、重启和恢复串行化。`workspace-session.json` 保存恢复集合、最近激活项目及独立窗口布局，和 `recent-projects.json` 的历史记录分开。打开前记 `opening`，完整健康后记 `open`，异常记 `failed`；正常退出关闭资源但保留集合，主动关闭项目才删除集合成员。下次启动并行恢复 `open`，`opening/failed` 留在欢迎页等待显式操作。每项目恢复独立，窗口恢复完成后激活上次使用的项目。

检查点适配器只在完整 Host/Renderer 健康后调用官方 `captureHealthy()`，保留三槽轮换及恢复后跳过覆盖的规则。恢复入口先停止所属 Host，持有该项目队列，然后使用官方控制器的代际绑定、短期预览 token、文件校验及恢复。依赖声明变化时调用官方 materializer；自有 pending 文件跨进程保留恢复未完成状态，在成功恢复和依赖重建前拒绝启动。主进程的恢复 UI 不依赖失败项目的 Host、Renderer 或插件。项目内容和会话存储不在配置检查点范围内。

桌面设置通过原始 settingsScope / settings.section 注册，复用官方 Button/Menu/Switch。仅组合通知、材质、日志和当前项目原生操作，不注册原来的模式/Profile/应用更新页面。设置页头通过框架正式的 `settings.action` 插槽复用固定 Desktop 的原生操作组件，提供导出诊断、打开 DSH 终端及重新加载/重启/恢复模式菜单；通用设置框架继续提供打开配置文件。所有重启操作由项目窗口自己的 runtime 处理，不影响其他项目。Switch 尺寸按未导出的 DesktopSettingsSection.ToggleRow 最小适配；日志直接接入官方 FileExporter 的阈值。模型、主题、语言等其他页面仍由已有官方服务提供。

插件市场选择属于项目 Profile。stable 默认启用随固定 Desktop 依赖提供的 `dsh-market`，也可在当前项目设置中关闭；官方 Profile 组合负责过滤未选中的 provider，并把 `dsh-market` 显式绑定到项目的 `desktop` Profile。Shell 向市场提供只读的当前 Profile 身份，使其使用官方 `desktopPnpm` 可恢复包操作服务；该身份不提供创建、选择或删除 Profile 的能力。产品自带 Project 插件使用 `devDependencies` 本地 link，市场只管理普通依赖，不能从市场误卸载产品核心插件。`dsh-community-market` 当前要求 DSH 0.1.6 alpha，在 stable 页面中只展示为不可用选项。

欢迎窗口只承载应用级入口，不创建共享 Host。模型与项目配置属于各自 Profile；应用共享明暗主题，其他设置保持项目独立。

`SharedTheme` 拥有应用级 preference，只同步 `system/light/dark`。各 Host 的官方 `settings/updated` 事件触发协调，原子保存应用 theme.json 后统一更新 Electron nativeTheme 及所有 Host 的 ui-theme；广播写入不再广播。不共享字体、语言、模型；菜单语言随当前项目窗口改变。

## 官方内部接入清单

新增恢复规则：初始 Profile 及早期无锁检查点，仅在依赖恰为自带 Project 的本地 link 时生成锁文件，不自动解析任意新增依赖。其他恢复必须使用冻结锁文件。固定 pnpm 11 的损坏缓存复用问题由自有适配器规避：通过官方 materializer 的 embedder spawn 接口附加新临时 store、force 和 copy 参数，重新校验下载内容，结束后清理该次 store；不改全局 pnpm 设置。失败保留 pending 和官方脱敏诊断。

安全模式只复用官方 `safe-mode` 的路径/标记/reset/cleanup，不调用 compatibility 或首次向导入口。每项目停止确认后创建临时 dsh-home、desktop-state 和空白工作目录，仅加载官方基础 Profile 与自有 advanced Shell。Host 环境采用允许列表，阻止继承 API key、代理、npm hook 和 DSH 路径覆盖。Renderer 使用随机非持久 Session。退出等待 Host 停止后清除 Session 和临时目录；下次启动在所有 Host 创建前清理遗留临时树。故障项目保持 failed，不自动重开；安全模式不捕获正常检查点、不覆盖正常窗口布局，主题不传播到正常项目。

原生菜单显式指定 app/edit/view/window 每个 role 的文案，保留原生行为和快捷键，避免默认子项继续跟随操作系统语言。欢迎页聚焦时沿用最近项目语言。应用 bundle 身份由打包配置负责，不修改开发用 Electron.app。

这些是编译自固定官方源码的库，不是上游承诺的稳定 API。只允许适配器导入。

| 模块组 | 原因 |
| --- | --- |
| `profile`、`profile-manager` | 使用官方模板和 Profile 组合，安装依赖解析边界 |
| `host-rpc`、`host-runtime-bridge` | 保留官方进程通信契约 |
| `module-resolution`、`desktop-actions`、`log-files`、`file-exporter` | 自有 Host 组合所需的解析、命令和日志能力 |
| `desktop-browser-access`、`lan-https-runtime` | 保留 Renderer 认证；项目仅开放本机，LAN 不启用 |
| `desktop-runtime-environment`、`launch-environment` | 命令环境与项目环境变量 |
| `index` 的 Config/desktopRendererUrl、`window-material`、`renderer-boot` | 原始窗口参数、URL 标记与健康报告协议 |
| `window-options`、`preload`、`renderer-actions-dispatch` | 安全窗口配置、文件拖放/原生命令及重启先应答语义 |
| `desktop-terminal`、`diagnostic-export` | 原始命令环境和诊断归档；尚待人工验收 |
| `profile-checkpoint`、`startup-recovery-controller` | 健康配置检查点、预览与确认 token、恢复校验，不调用官方应用级重启 |
| `profile-materializer`、`mask-secrets` | 恢复后的依赖重建，以及展示启动错误时的脱敏 |
| `safe-mode` 的 paths/reset/cleanup | 临时环境路径及清理；不使用官方 compatibility 默认组合或应用启动 |
| Desktop client 的 `desktop-settings-api`、`DesktopTerminalSettingsAction`、locale 与 settings styles | 原生 preload 动作协议及设置页头正式操作组件；只使用终端、诊断及单项目重新加载/重启/恢复方法 |
| Desktop client 的 advanced/window/boot-health/footer 模块 | 复用原始框架、主题、侧栏及生命周期 |
| Harness locale、theme styles、ui-settings-models 源子树 | 预 Host 引导及无需首次弹窗的官方模型页；独立 tree 固定与校验 |
| Project resource-clones、project-resources、resource-auth、resource-git（含 inspectResourceGit）及认证客户端／设置组件／styles／locales | 预 Host 克隆、认证及本地 Git 检测复用；固定提交直接构建，Shell 适配临时存储、原生选择、IPC 和创建前草稿／事务衔接 |

编译官方顶层库时使用独立输出目录，以保留官方基于 `import.meta.url` 的资源定位。此阶段未构建官方原生向导/恢复 HTML，也不使用官方 `main`、`bin` 或 fork 的 `workbench`。

## 功能取舍

- 自己的创建项目引导取代官方首次向导；不写伪造的 completed/skipped 标记。
- 官方 `desktop-updates` 从 Host 组合中关闭，不检查或安装官方应用更新。
- 官方 `desktop-profiles` 条目禁用，对应 Profile 服务和 DesktopSettingsController 不实例化，应用设置页面不注册。
- 不实例化官方全局 Market Controller 或 Profile 管理器；市场 provider 从项目设置读取，在该项目启动前交给官方 Profile 组合。只读 Profile 身份仅用于让市场绑定当前项目并选择 `desktopPnpm` 包操作通道。
- fixed advanced、随机 loopback 端口、禁止 ordinary browser/LAN，由正式 settings schema 校验；非法变更在持久化前被拒绝。
- 模型页面与项目页保留；强制模型首次弹窗不参与组合。通知、终端、诊断、材质和日志已经接入自有设置及菜单。
- 已实现项目集合/窗口布局恢复、崩溃处理、配置检查点、临时安全模式和本地 macOS x64 打包流程。插件卸载/工厂重置、环境迁移、Developer ID 签名公证和正式分发仍为后续工作。

## 升级策略

显式选择配套的 Desktop/Harness 版本，更新锁文件，在独立分支运行源码完整性、依赖版本、双 Host 与图形验收。验证通过才改变开发/发行基线。保留上一个锁定组合，不自动追踪最新版本。

不通过复制整个官方运行时大文件、打补丁或修改私有字段规避边界。确实需要拥有的窗口或产品逻辑写在 Shell 内；必要私有模块访问留在清单中，升级时逐项审查。
