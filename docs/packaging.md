# 官方来源打包与发布 / Official-source packaging

## 固定来源

- DeepSeek 官方 Harness/Desktop：`official-source.lock.json`。
- 自有 Project 插件：`project-source.lock.json`，必须先推送插件提交，才可发布引用它的壳。
- 外部运行时依赖：`official-runtime-locks/<target>/`，以官方源码、包配置、Node/pnpm 版本和 SHA-256 绑定。官方 pnpm 打包时 JSON 字段顺序不固定，因此先核对每个包的完整 manifest，再只替换本次官方 tarball 的 integrity；第三方版本、哈希和依赖图保持固定。三个目标使用包含各平台 optional 包的同一依赖图，必须分别通过 frozen 安装及官方 native/Office smoke。
- 旧 `upstream.lock.json` 与 `src/desktop-adapter/stable` 不进入构建、打包或 CI。

## 原生构建

参考官方 `apps/desktop/scripts/package-target.ts` 的三个目标：mac-arm64、mac-x64、win-x64。构建步骤为官方 `build:official`、core tarball 集、`prepare:runtime`、本项目固定 production lock 安装、官方过滤/描述文件/Host/Office smoke，然后加入独立 Shell 与插件。

插件在已打包官方 `dsh/node_modules/dsh-plugin-project` 中，与官方 peers 共享同一 runtime。只收集其生产依赖；不携带工作区源码链接、开发环境配置或社区模块。外部 Electron 来自同一官方 runtime，保留 `runAsNode`。

macOS 使用同一固定官方 electron-builder 构建原生 DMG，并使用本项目 ad-hoc 签名。没有 Developer ID / Apple 公证。Windows 使用 NSIS 和 portable ZIP，未签名。品牌、应用身份、文件关联和自有更新源保留，未接入官方签名账户或 COS 上传。

## 安装包验收

`--verify-installation` 只使用系统临时 userData，验证已打包状态、欢迎窗口、两个官方项目、真实 Host、关闭隔离和重开。macOS 从最终 DMG 挂载复制到仓库外运行，并校验签名；Windows 解开最终 portable ZIP 后运行。CI 每个目标必须完成源码检查、原生窗口检查与安装验证。

## 发布

更新 package.json 版本、已推送的插件 pin、双语 `docs/releases/<version>.md`。在三个原生目标均通过之后，推送同版本 `v*` 标签或在 **Official Desktop CI and Release** 使用 all + publish。

发布 job 单独拥有 contents:write。先核对三个构建记录的提交、版本、已打包状态及所有文件的大小/SHA-256，再上传私有 draft，复核 GitHub digest 后发布。当前不提供覆盖重发入口；同一版本拒绝覆盖。

更新清单 v2 包含 mac-arm64、mac-x64、Windows 安装器和便携包。0.2.0 能继续读取 v1；0.1.x 只支持 universal 清单，因此需手动安装本版。用户已决定将 0.2.0 发布为 Stable；旧 Home 迁移仍未实现，旧数据不会被隐式转换或删除。

也可在已有三个平台均通过的构建上运行 **Publish Verified Desktop**，输入其 run ID；工作流核对成功状态、工作流路径、仓库和精确提交后，直接发布同一批已验证字节，不重新构建。
