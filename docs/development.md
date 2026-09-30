# 官方 Desktop 开发 / Official Desktop development

当前运行、构建、打包和 CI 仅使用固定的 DeepSeek 官方 `deepseek-harness/apps/desktop` 及自有 Project 插件。历史社区源码和 `upstream.lock.json` 只作为归档，不用于安装或构建。

## 准备

推荐 Node 24、Git、Corepack 与平台编译工具；Windows 使用原生 PowerShell，启用 Git longpaths，关闭 autocrlf。先按 `official-source.lock.json` 检出官方 tag，确认 commit 一致，保留该 tag 引用：

```sh
cd ../deepseek-harness
corepack pnpm install --frozen-lockfile
cd ../dsh-project-desktop
corepack yarn install --immutable
cd ../dsh-plugin-project
corepack yarn install --immutable
cd ../dsh-project-desktop
yarn prepare:official-package-set ../deepseek-harness
yarn setup --official-source ../deepseek-harness --project-source ../dsh-plugin-project
yarn prepare:official-runtime ../deepseek-harness
yarn check
```

`setup` 校验并构建 pin 中的插件。插件开发时可用 `DSH_PROJECT_PLUGIN_SOURCE=../dsh-plugin-project yarn build` 显式选择本地工作树；打包拒绝该开关和含本地来源标记的产物。官方源码必须干净，commit、Desktop tree、tag 与依赖锁 blob 均校验。

## 启动与验证

```sh
DSH_PROJECT_DESKTOP_USER_DATA=/tmp/dsh-development yarn start /path/to/Project.agent-project
yarn smoke:official-shell
yarn smoke:official-account-sharing
yarn smoke:official-updates
```

Windows 的环境变量用 `$env:DSH_PROJECT_DESKTOP_USER_DATA = ...` 设置。自定义 userData 用于开发隔离；不要改运行中的 Profile。临时测试数据放系统 TEMP，不进入任务 artifacts。`smoke:official-close` 需要操作真实运行任务的关闭确认弹窗，不能放进无人值守流水线冒充自动验证。

源码改动执行 `yarn check`（构建、单测、项目文件检查）。UI/原生交互另行在真实窗口验证，不能用一个平台结果代替另一个。插件源码改动在插件仓库执行 `yarn check`。

## CI 与发行

统一构建 workflow 为 `.github/workflows/package.yml`，名称 **Official Desktop CI and Release**。PR 和主分支构建三个原生目标；标签或显式 dispatch 才发布。Windows 使用 pwsh。Node 24、官方 pnpm frozen 和 Shell/插件 Yarn immutable 安装，目标必须通过官方运行时、Shell/插件检查、真实 Electron 与搬移安装验收。

```sh
yarn package:mac # native arm64 or x64 Mac
yarn package:win # native Windows x64
```

打包必须使用干净工作树和固定插件来源。产物与校验记录位于 `release/<version>-<target>`。流程与安装限制见 [packaging.md](packaging.md)、[0.2.0 release notes](releases/0.2.0.md)。

旧社区 Stable Home 会保留并拒绝接管。迁移与回退仍需后续实现；当前发行不声明旧数据兼容。

也可在已有三个平台均通过的构建上运行 **Publish Verified Desktop**，输入其 run ID；工作流核对成功状态、工作流路径、仓库和精确提交后，直接发布同一批已验证字节，不重新构建。
