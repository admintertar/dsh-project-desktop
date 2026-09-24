# Development / 开发准备

The shell imports immutable source snapshots and independent dependency caches.
It does not require a private repository or a fork. Commands below use sibling
directories as shown in the README. On macOS, install Xcode Command Line Tools
for native module builds. Keep the Node version within package.json engines.

壳读取固定源码和独立依赖，不要求私有仓库或 fork。以下目录均为 README 中的同级路径。
macOS 原生模块需要 Xcode Command Line Tools；Node 版本应符合 package.json。

Before UI work, read the required [Shell frontend guidelines](frontend-guidelines.md)
and the shared component guidelines linked there. 修改界面前，必须阅读该前端规范及其引用的通用组件规则。

## 1. Official source and dependencies / 官方源码与依赖

Run from the parent workspace directory / 在这几个仓库的父目录执行：

```sh
git clone https://github.com/anywhere-labs/dsh-desktop.git dsh-desktop-source
git -C dsh-desktop-source checkout --detach 01fa59e6688d82fa34b59fc507e3a6f5d695fa17
git clone --filter=blob:none --no-checkout https://github.com/deepseek-ai/deepseek-harness.git deepseek-harness-source
cd dsh-desktop-source
corepack yarn install --immutable
```

Run Corepack from inside the official Desktop directory so it selects that
repository's pinned Yarn version. Its unmodified lockfile controls runtime
archives, upstream dependency patches and native packages. The official
workspace installs multiple channels; the shell imports only stable. No
official application build or launch is needed.

必须在官方 Desktop 目录内运行 Corepack，才能选中其固定 Yarn 版本。官方锁文件管理
运行时归档、依赖补丁和原生包。官方工作区可能安装多个通道，但壳只导入 stable；
无需构建或启动官方桌面应用。

For native launch and packaging, prepare the official Electron/native dependencies
before copying the cache / 原生启动及打包前，先准备官方 Electron 和原生依赖：

```sh
cd dsh-plugin-desktop
node node_modules/electron/install.js
corepack yarn prepare:electron-native
```

Downloads use the official package sources and may need network access. Existing
verified caches may be supplied instead. The root source checkout is a disposable
cache; no ongoing fork maintenance is involved.

## 2. Companion plugin / 配套插件

In `dsh-plugin-project`, follow its README: `yarn install --immutable`, setup from the official
Desktop source, then `yarn run check`. The plugin Git repository must contain the
exact `project.commit` recorded in this shell's `upstream.lock.json`. A source ZIP
without that Git object cannot serve as the setup source. New plugin work must
be committed and its commit/tree adopted explicitly; dirty files are not exported.

在插件目录按其 README 准备依赖并检查。壳需要锁文件中的插件 Git 提交；只有源码 ZIP
不够。插件修改需要提交后显式更新壳的 commit/tree，不能通过修改 `.upstream/project/`
替代升级。两个新仓库保留各自独立历史。

### Local plugin source (development only) / 本地插件源码（仅开发）

`DSH_PROJECT_PLUGIN_SOURCE=/path/to/dsh-plugin-project` compiles the companion
plugin from that local working tree instead of the pinned snapshot, so
uncommitted UI edits reach a development shell without committing, updating the
lock or re-exporting `.upstream/project`. The pinned tree check becomes a
repository identity check plus a warning, and release packaging refuses to run
while the variable is set. Rebuild after every edit; the shell then needs a page
reload, or a restart when it still serves the cached bundle:

```sh
DSH_PROJECT_PLUGIN_SOURCE=../dsh-plugin-project yarn run build
DSH_PROJECT_DESKTOP_USER_DATA=/tmp/dsh-dev-shell yarn start -- /path/to/project
```

`DSH_PROJECT_PLUGIN_SOURCE=...` 让壳直接从本地工作区编译配套插件，未提交的界面改动不再需要提交、更新锁文件或重新导出 `.upstream/project`。固定树校验改为仓库身份校验并打印警告；设置该变量时打包会直接拒绝。每次改动后重新构建，然后刷新壳页面（若仍加载旧 bundle 则重启壳）。

## 3. Shell / 桌面壳

Run the `yarn install --immutable`, `yarn run setup` and `yarn run check` commands in the README.
Setup copies dependencies into `.cache/`, audits their links and verifies source
trees. The exported `.upstream/` source is never modified by the build. Start
with `yarn start` only after the checks complete.

An installed copy owns the default application data directory and its
single-instance lock, so starting another build there quits immediately. Run a
development build beside it with an isolated directory:

```sh
DSH_PROJECT_DESKTOP_USER_DATA=/tmp/dsh-dev-shell yarn start
```

The override applies to normal launches only; test modes keep the directory their
harness supplies through `DSH_PROJECT_DESKTOP_SMOKE_DATA`. Everything the shell
persists — recent projects, window sessions, theme, per-project DSH homes and
Chromium partitions — then lives under the isolated directory, so deleting it
resets the build without touching the installed copy.

已安装的副本占用默认应用数据目录和单实例锁，在默认位置启动第二个构建会立即退出。
用上面的环境变量指定独立目录即可与其并行运行；该覆盖只作用于正常启动，测试模式仍
使用 `DSH_PROJECT_DESKTOP_SMOKE_DATA` 指定的目录。

If Electron was downloaded after setup, import just its matching binary with:

```sh
yarn run setup:electron -- ../dsh-desktop-source/dsh-plugin-desktop/node_modules/electron
```

The import refuses an already prepared destination. Do not overwrite an active
runtime or rebuild dependencies used by running windows. For an upstream upgrade,
use a separate checkout/cache and rerun acceptance before adopting the lock.

### Startup and project-open timing / 启动与打开项目耗时

每次启动都会写 `<userData>/boot.log`（`DSH_PROJECT_DESKTOP_USER_DATA` 生效时就在该目录下），
不需要事先打开任何开关：`boot` 段是一次启动，`project/open:<项目>` 段是一次打开，
Host 进程内部的阶段（首次 Profile 准备的 pnpm 依赖实体化、官方插件树、渲染进程注册）也追加在
同一段里。每行是 `+该段开始以来的偏移` + `该阶段自己的耗时`，单阶段 ≥ 1 秒会带 `[SLOW >1000ms]`，
段落结束时给出 `total` 与最慢阶段；文件超过 `DSH_PROJECT_BOOT_LOG_BYTES`（默认 256 KiB）时按半量
截断，只保留最新记录。

Every launch writes `<userData>/boot.log`, with no switch to remember first: `boot` covers the
launch, `project/open:<name>` one project open, and the Host process appends its own stages
(first-run pnpm materialization, the official plugin tree, renderer registration) to the same
trace. Each line carries the offset since that trace began and the stage's own cost, a stage of
1000 ms or more is marked `[SLOW >1000ms]`, and the trace ends with `total` and its slowest
stage. The file is truncated to its newest half once it passes `DSH_PROJECT_BOOT_LOG_BYTES`
(256 KiB by default).

Follow it live while reproducing a slow launch:

```sh
DSH_PROJECT_BOOT_TRACE=1 DSH_PROJECT_DESKTOP_USER_DATA=/tmp/dsh-dev-shell yarn start
```

`DSH_PROJECT_BOOT_LOG` points the trace at another file, and setting it to the empty string turns
the trace off. In the app, 项目工具 → 导出日志与诊断… writes the whole trace plus each project's
recovery reasons and the project's official diagnostics archive into one folder and reveals it.
That entry implements the official `DesktopRuntime.exportDiagnostics` contract, so the method keeps
its official name, and the official duplicate "导出诊断信息…" contribution is dropped from the menu
(see `stable/official-tray.mjs`); `tests/desktop-runtime-contract.test.mjs` fails if either drifts.

```powershell
yarn probe:startup-trace <label>
```

runs one real native smoke launch with the trace on and fails unless the launch trace, a
project-open trace, the Host-process stages and a `[SLOW >1000ms]` line are all present; its
evidence lands in `.runtime/startup-trace-<stamp>-<label>-*/boot.log`.

## Checks and limits / 验证范围

| Command | Scope |
| --- | --- |
| `yarn run test` | Application logic and fixtures; requires the first build |
| `yarn run verify:upstream` | Desktop/Harness/plugin source trees and runtime inventory |
| `yarn run check` | Unit tests, build, recovery, safe mode, project files and dual-Host smoke |
| `yarn run smoke:native` | Native creation/UI/preview/recovery checks; graphical session required |
| `yarn run probe:startup-trace` | Real launch writes a usable startup/open trace (`boot`, `project/open:*`, Host stages, a marked slow stage) |
| `yarn run smoke:profiles` | Official Profile creation/selection, Recovery Assistant, checkpoint confirmation, Safe Mode and crash isolation |
| `yarn run smoke:guide` | Compact welcome/create windows, official chrome, mouse/keyboard sidebar resizing, persistence, locale/theme and resource form regression |
| `yarn run smoke:resources` | Native resource status and remote-association checks |
| `yarn run smoke:lifecycle` | Native lifecycle and single-instance behavior |
| `yarn run smoke:updates` | Real official update dialogs with synthetic release/download fixtures, menu/state/error checks and two unaffected Hosts |
| `yarn run smoke:updates:live` | After publication: real anonymous static downloads, manifest/checksum validation and the official latest-version dialog in isolated Electron; optionally pin `DSH_PROJECT_UPDATE_COMMIT` |
| `yarn run test:recovery:network` | Network dependency recovery with an isolated test registry |
| `yarn run package:mac` | Universal macOS DMG, built on a Mac, with ad-hoc signing and verification of the mounted artifact |
| `yarn run package:win` | Native Windows x64 NSIS installer and portable ZIP with extracted-app verification |

Automated checks use synthetic temporary projects and do not call models. Native
checks are separate and require Electron. The local acceptance baseline is macOS
x64; the packaging workflow runs each additional platform's own checks. Developer
ID and Authenticode signing require separate validation. See [packaging](packaging.md)
for manual/tag Actions triggers and artifact downloads. Local checks do not push
source or publish releases; the explicitly triggered release workflow owns publication.
