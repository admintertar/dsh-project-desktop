# dsh-project-desktop

[English](README.en.md) · 简体中文

面向多仓库项目的独立 AI 开发桌面。保留 DeepSeek Harness 的聊天、Agent 和基础界面，以自己的应用入口组织项目、窗口和恢复流程。

**不维护 DSH Desktop fork。** 官方 Desktop 与 Harness 使用固定提交的原始源码；适配集中在 `src/desktop-adapter/`。项目内的资源、任务、记忆、技能和 MCP 由配套仓库 **dsh-plugin-project** 提供。

## 产品能力

- **项目启动体验**：恢复上次仍打开的多个项目；没有待恢复项目时显示欢迎页，支持搜索最近项目、新建和打开。
- **独立创建引导**：选择项目组合，创建项目根 Git 与独立资源 Git，关联已有目录或异步克隆远端；需要认证时提供认证界面。
- **多窗口隔离**：一个 Electron 主进程，各项目独立 Renderer、Host、Profile、运行数据和浏览器分区。
- **项目内多 Profile**：每个项目拥有独立 DSH Home，可通过“项目工具 → Profile…”使用官方窗口创建和切换环境；当前选择只保存在本机，切换时仅重启当前项目。
- **恢复与安全模式**：单项目崩溃处理、配置检查点、依赖重建和临时安全模式，其他项目继续运行。
- **一致的桌面体验**：原生文件菜单、窗口恢复、通知、诊断、共享明暗主题和中英文界面。

## 兼容性与状态

当前是早期开发版本，只支持 `stable` 通道：Desktop **2.0.11**、Harness **0.1.5-rc.2**，插件提交由 [upstream.lock.json](upstream.lock.json) 固定。stable 表示发行通道，不是长期 API 稳定承诺。

当前本地原生验收基线为 **macOS x64**。GitHub Actions 生成同时支持 Intel / Apple Silicon 的 macOS Universal DMG，以及 Windows x64 安装包；同一 DMG 分别在两种 Mac 架构启动自检，各平台状态以对应任务结果为准。应用支持后台检查自有 Release、确认后下载并校验安装包。Linux、正式签名发行与静默安装尚未提供。项目独立维护，不是 DeepSeek 或 Anywhere Labs 的官方发行版。

## 开发准备

需要 Node.js `^22.19.0 || >=24.0.0`、npm、Git、tar、Corepack；原生依赖可能需要系统编译工具。两个项目仓库建议同级放置：

```text
workspace/
├── dsh-plugin-project/
├── dsh-project-desktop/
├── dsh-desktop-source/          # 官方源码缓存
└── deepseek-harness-source/     # 官方源码缓存
```

先按插件 README 完成其 `npm ci` 和 `setup`。官方源码缓存只需包含锁定提交，不需要维护 fork。完整步骤见 [开发说明](docs/development.md)，包括官方依赖安装与 Electron 准备。

在本仓库安装开发工具，并导入配套的固定源码与依赖：

```sh
npm ci
npm run setup -- \
  --desktop-source ../dsh-desktop-source \
  --harness-source ../deepseek-harness-source \
  --project-source ../dsh-plugin-project \
  --desktop-dependencies ../dsh-desktop-source/dsh-plugin-desktop/node_modules \
  --project-dependencies ../dsh-plugin-project/node_modules
npm run check
npm start
```

`setup` 从提交对象导出源码，核对 tree hash 与版本，并复制独立依赖。`.upstream/` 保持原样，构建输出写入 `.cache/` 和 `dist/`；运行时不链接回开发仓库。启动已有项目可运行 `npm start -- /path/to/example.agent-project`。模型服务在项目设置中配置；自动检查不调用模型。

## 项目数据

项目根 Git 保存项目定义、记忆、任务和共享配置，各资源 Git 保存自己的代码。`memory/` 位于项目根；`.agent-project/` 保留为程序数据目录，共享数据提交，本机路径与临时恢复记录精确忽略。项目配置和资源远端是不同层次的概念。

详见 [项目目录与文件说明](docs/project-directory-structure.md)。应用运行数据、会话和模型配置保存在应用 userData，不混入项目源码。

## 验证与打包

`npm run check` 覆盖独立逻辑、固定源码完整性、构建、恢复、安全模式、项目创建及真实双 Host 冒烟。原生 UI 检查使用单独的 `smoke:native`、`smoke:profiles`、`smoke:resources` 与 `smoke:lifecycle`，需要可用的图形会话；它们不是无界面检查的一部分。`smoke:profiles` 验证官方 Profile 窗口、恢复助手与单项目恢复隔离。

```sh
npm run package:mac
# Windows x64 上运行：
npm run package:win
```

安装包可从 [GitHub Releases](https://github.com/admintertar/dsh-project-desktop/releases/latest) 下载。本地包输出到 `release/`。GitHub → Actions → **Package Desktop** → **Run workflow** 可选择 `all`、`mac` 或 `win`；选择 `all` 并启用 `publish` 可在验收后发布。推送与 `package.json` 版本一致的 `v*` 标签会自动打包并发布；覆盖已有版本必须显式启用 `replace_existing`。macOS 使用 ad-hoc 签名、未公证，Windows 未签名。应用更新以 Shell 版本为准，欢迎页、帮助/托盘菜单和官方版本浮层共用检查入口。详细入口、安装验证及限制见 [打包说明](docs/packaging.md)。

## 架构与权利

实现边界和固定官方内部接口清单见 [架构说明](docs/architecture.md)。升级需一起核对 Desktop、Harness 与插件提交，不自动跟随 latest。

界面开发须遵循 [桌面壳前端规范](docs/frontend-guidelines.md) 及其引用的通用组件规则，优先复用官方完整界面与交互流程。

自有代码目前**公开可读、保留其他权利，暂不授予开源许可**。详见 [LICENSE](LICENSE)。上游材料保留各自原有许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。`private: true` 只用于防止误发布到 npm。
