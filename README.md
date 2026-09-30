# DSH Project Desktop

[English](README.en.md) · 简体中文

面向多仓库项目的独立 AI 开发桌面。我们的壳负责欢迎、创建/打开/切换项目、多窗口与菜单，直接加载 DeepSeek 官方主界面；[Project 插件](https://github.com/admintertar/dsh-plugin-project)提供资源、任务、记忆、技能、MCP 及项目工作区。

## 当前版本

Shell **0.2.0 Stable**，内置官方 DeepSeek Harness/Desktop **0.2.0-rc.2**。来源由 [official-source.lock.json](official-source.lock.json) 和 [project-source.lock.json](project-source.lock.json) 固定；不依赖 Anywhere Labs 社区 dsh-desktop，不修改官方源码。

- 每个项目使用独立窗口、Host、Profile、模型 API Key 和浏览器分区。
- DeepSeek 登录账号及明暗主题在项目窗口间共享。
- 更新入口复用官方侧栏与弹窗，下载本项目自己的安装包。
- 文件菜单的「关闭页面」沿用官方上下文行为；项目菜单的「关闭当前项目」关闭所属窗口及 Host。

## 安装

从 [GitHub Releases](https://github.com/admintertar/dsh-project-desktop/releases/latest) 下载：macOS arm64（Apple Silicon）、macOS x64（Intel）DMG，以及 Windows x64 安装器和便携 ZIP。macOS 为 ad-hoc 签名且未公证；Windows 未签名。

**0.1.x 请手动安装本版。旧社区 Stable 数据迁移尚未提供，本版保留并拒绝接管旧 Home。** 如果需要旧会话，请保留旧版应用和数据备份，等待迁移工具；不要删除旧数据。应用身份和默认数据目录沿用原产品。详情见 [0.2.0 发布说明](docs/releases/0.2.0.md)。

## 开发与 CI

使用 Node 24、官方 pnpm 锁和本项目 Yarn 锁，步骤见 [开发说明](docs/development.md)。

```sh
yarn check
yarn smoke:official-shell
yarn package:mac # macOS 原生构建
yarn package:win # Windows x64 原生构建
```

[Official Desktop CI and Release](.github/workflows/package.yml) 在三个原生 runner 上校验来源、构建、窗口生命周期与搬移安装包。推送与 package.json 一致的 `v*` 标签会在全部验证通过后发布；手动 workflow 可只构建指定平台。参见 [打包说明](docs/packaging.md)。

## 许可

独立维护，非 DeepSeek 官方发行版。自有代码公开可读、保留其他权利，暂不授予开源许可，见 [LICENSE](LICENSE)。上游许可证与来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
