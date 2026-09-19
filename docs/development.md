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

In `dsh-plugin-project`, follow its README: `npm ci`, setup from the official
Desktop source, then `npm run check`. The plugin Git repository must contain the
exact `project.commit` recorded in this shell's `upstream.lock.json`. A source ZIP
without that Git object cannot serve as the setup source. New plugin work must
be committed and its commit/tree adopted explicitly; dirty files are not exported.

在插件目录按其 README 准备依赖并检查。壳需要锁文件中的插件 Git 提交；只有源码 ZIP
不够。插件修改需要提交后显式更新壳的 commit/tree，不能通过修改 `.upstream/project/`
替代升级。两个新仓库保留各自独立历史。

## 3. Shell / 桌面壳

Run the `npm ci`, `npm run setup` and `npm run check` commands in the README.
Setup copies dependencies into `.cache/`, audits their links and verifies source
trees. The exported `.upstream/` source is never modified by the build. Start
with `npm start` only after the checks complete.

If Electron was downloaded after setup, import just its matching binary with:

```sh
npm run setup:electron -- ../dsh-desktop-source/dsh-plugin-desktop/node_modules/electron
```

The import refuses an already prepared destination. Do not overwrite an active
runtime or rebuild dependencies used by running windows. For an upstream upgrade,
use a separate checkout/cache and rerun acceptance before adopting the lock.

## Checks and limits / 验证范围

| Command | Scope |
| --- | --- |
| `npm test` | Application logic and fixtures; requires the first build |
| `npm run verify:upstream` | Desktop/Harness/plugin source trees and runtime inventory |
| `npm run check` | Unit tests, build, recovery, safe mode, project files and dual-Host smoke |
| `npm run smoke:native` | Native creation/UI/preview/recovery checks; graphical session required |
| `npm run smoke:profiles` | Official Profile creation/selection, Recovery Assistant, checkpoint confirmation, Safe Mode and crash isolation |
| `npm run smoke:guide` | Compact welcome/create windows, official chrome, mouse/keyboard sidebar resizing, persistence, locale/theme and resource form regression |
| `npm run smoke:resources` | Native resource status and remote-association checks |
| `npm run smoke:lifecycle` | Native lifecycle and single-instance behavior |
| `npm run test:recovery:network` | Network dependency recovery with an isolated test registry |
| `npm run package:mac` | Native macOS x64 / arm64 DMG with ad-hoc signing and relocated-app verification |
| `npm run package:win` | Native Windows x64 NSIS installer and portable ZIP with extracted-app verification |

Automated checks use synthetic temporary projects and do not call models. Native
checks are separate and require Electron. The local acceptance baseline is macOS
x64; the packaging workflow runs each additional platform's own checks. Developer
ID and Authenticode signing require separate validation. See [packaging](packaging.md)
for manual/tag Actions triggers and artifact downloads. No script automatically
pushes source or publishes a release.
