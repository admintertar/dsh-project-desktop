# macOS、Windows 打包与签名

打包目标为 macOS Universal（一个 DMG 原生支持 Intel / Apple Silicon）与 Windows x64，使用固定的 Electron 43.3.0、Desktop stable 2.0.11 / Harness 0.1.5-rc.2。Mac 融合包在 Apple Silicon 构建，再分别在 arm64 和 Intel 机器启动同一个 DMG；Windows 在原生 x64 runner 构建验证。配置了目标不等于该平台已验收，实际结果以对应 Actions job 和 `package-result.json` 为准。Linux 暂无打包任务。

## GitHub Actions

工作流为 [Package Desktop](../.github/workflows/package.yml)，入口在 **dsh-project-desktop** 仓库；插件按 `upstream.lock.json` 中的提交一起构建，不需要在插件仓库再生成安装包。

手动打包：进入 GitHub → Actions → Package Desktop → Run workflow，选择 `master` 和 `platform`：`all` 构建全部，`mac` 构建 Mac 融合包并验证两种架构，`win` 构建 Windows x64。命令行等价入口为：

```sh
gh workflow run package.yml --repo admintertar/dsh-project-desktop --ref master -f platform=all
```

推送 `v<package.json version>` 标签也会构建全部平台，例如版本为 `0.1.0` 时使用 `v0.1.0`。标签与版本不一致会直接拒绝；普通分支推送不自动打包。

| 任务 | 原生 runner | 可下载产物 |
| --- | --- | --- |
| mac-universal | `macos-15` | Universal DMG、SHA-256、arm64 验证结果 |
| Verify universal DMG on Intel | `macos-15-intel` | 校验并启动同一 DMG；结果见该任务日志 |
| win-x64 | `windows-2022` | NSIS Setup.exe、便携 ZIP、SHA-256、验证结果 |

运行成功后，在该次工作流页面底部 **Artifacts** 下载对应平台的压缩包，解压后取出安装文件。产物保留 14 天，内含构建提交、架构、签名类型与安装检查结果。不上传整个展开的运行时目录，也不自动创建 GitHub Release、npm 发布或应用更新。

流程参考固定官方 Desktop 的 [CI](https://github.com/anywhere-labs/dsh-desktop/blob/01fa59e6688d82fa34b59fc507e3a6f5d695fa17/.github/workflows/ci.yml)：原生 runner、固定 Node 22.23.2、官方 Yarn immutable 安装、官方 Electron 原生依赖准备和无证书构建。只导入 stable；官方根工作区安装会准备其锁文件包含的其他 workspace，但不构建或验收 beta 产品。

三个来源均按完整 commit 检出，不读取个人缓存、私有仓库或未提交文件。官方源码及锁文件不改写，完整性检查仍重算 source tree。随后执行 `npm run check`，覆盖构建、应用测试、恢复、安全模式和双 Host；最后打包并在开发目录外启动真实应用自检。安装检查失败时，该平台任务失败，不上传安装产物。工作流只有 `contents: read`，不要求签名或发布 secrets。

macOS 使用 ad-hoc 签名且未公证；Windows 不做 Authenticode 签名。这些是测试安装包，不能视为已通过 Gatekeeper/SmartScreen 的正式签名发行。

## 本地 macOS 安装包

完成 README 的缓存准备后运行 `npm run package:mac`。在 Intel 或 Apple Silicon Mac 上均生成 Universal DMG；官方 Yarn 配置必须安装两个 CPU 的可选原生模块。脚本在独立 staging 复用官方 `prepare-fs-ext.ts` 为两个 CPU 编译 Electron ABI 绑定，并由 `mac-universal.ts` 检查完整清单。Electron Builder 下载两个架构的同版 Electron，并按官方 `x64ArchFiles` 规则合并。输出在 `release/<版本与架构及时间>/`，最近成功结果记录在 `.local/last-package.json`。

流程包括固定源码/运行依赖验证、独立 staging、链接审计、electron-builder 生成融合应用、验证原生模块、由内到外签名 Mach-O 和嵌套 bundle、严格签名验证，再通过官方使用的 DMG target 生成 HFS+ 压缩镜像。挂载最终 DMG 后，将其中的应用复制到开发目录外进行真实安装自检，校验主程序、Electron Framework 和 Helper 均包含两种架构，最后记录 SHA-256。应用标识为 `local.dsh.project.desktop`，名称为 `DSH Project Desktop`，直接使用仓库 `assets/app-icon.icns` 作为安装图标，并携带完整 `assets/` 供 Dock、窗口和托盘使用。安装自检逐字节核对图标资源与 bundle 图标，避免开发环境存在而安装包遗漏。DMG 包含应用及 Applications 拖放入口。

两平台使用官方锁定 builder 的生产依赖遍历与文件过滤，不整份复制开发依赖缓存。Desktop 与 Project 分别收集，保持各自依赖版本；插件的 DSH peers 从固定 Desktop 提供。保留运行时动态加载模块、可选原生模块和许可证，排除开发工具、测试样例与官方禁止的宿主 native build 输出。`package-result.json` 记录两组依赖的包数、文件数和字节数，供后续检查体积变化。

应用携带固定运行时、Project 构建、自有 Shell、引导资源和第三方许可，不链接开发仓库。使用者不需要安装 Node/npm 或保留 Desktop fork。Profile 中的自有运行时链接在确认 Host 停止后的下次打开时重新定位；运行中的项目不被准备流程改写。

当前使用展开的 `Resources/app`，保留官方真实路径的 Profile fallback、原生依赖、worker 和资源读取方式。签名覆盖资源，安装自检结束后再次验证签名，确认启动未修改应用包。ASAR 布局可后续单独评估。首次打包需要按[开发说明](development.md)准备官方锁定依赖和 Electron 原生模块，再导入本仓库的独立缓存。

`--verify-installation` 是打包应用的本地诊断参数：启动器自行创建全新临时 userData，生成两个固定样例项目，检查官方 Renderer/Host、中文菜单、安全模式和关闭重开，输出证据后退出。它不接受外部脚本或测试目录，不打开日常项目，不调用模型。

```sh
"/path/to/DSH Project Desktop.app/Contents/MacOS/DSH Project Desktop" --verify-installation
node scripts/verify-mac-package.mjs "/path/to/DSH Project Desktop.app"
```

## 正式签名与公证

默认本地签名是 ad-hoc（`codesign -`），不是 Developer ID，也没有公证；带下载隔离属性分发到其他电脑时，不能视为已通过 Gatekeeper。

正式签名入口使用钥匙串中的 `Developer ID Application: …` 身份及可选的 notarytool 配置名称，不将私钥、密码或账户令牌写入仓库：

```sh
npm run sign:mac -- "/path/to/DSH Project Desktop.app" "Developer ID Application: Name (TEAMID)" "notary-profile"
```

正式模式启用 hardened runtime、JIT entitlement 和 Apple timestamp，按嵌套顺序签名；可选运行 notarytool 提交 ZIP、等待结果及 staple/validate。正式签名和公证尚未用真实证书验收。签名或 staple 后应重新生成分发 DMG 及校验和，不继续分发旧 ad-hoc 磁盘镜像。没有自动上传、发布或更新动作。

正式发行仍需 Developer ID 实机验收、Gatekeeper/隔离下载验证、自有更新源及回滚策略。

## 本地 Windows 安装包

在 Windows x64 上准备同一固定源码及 Windows 依赖缓存，运行 `npm run check` 和 `npm run package:win`。脚本复用官方 `package-win.ts` 的无签名环境策略、builder 依赖遍历策略及 `verify-win-installer.ts` 的 PE 校验，生成自有身份和图标的 NSIS 安装程序与便携 ZIP。

安装器允许选择安装目录，创建桌面与开始菜单入口，关联 `.agent-project`；卸载不删除项目或 userData。打包前验证依赖链接边界，将 Windows junction 的内容实体化，安装包不包含指向构建机器的链接。ZIP 检查应用入口、声明及许可文件，解压到独立临时目录后执行 `--verify-installation`，确认两个项目 Host、官方 Renderer、中文菜单、安全模式与关闭重开。

当前自动验证覆盖 NSIS 文件结构与便携包的真实启动，不等同于已完成安装器交互、升级覆盖、卸载和 SmartScreen 验收；这些仍需 Windows 实机发行验收。正式 Windows 签名另行配置，不在本工作流隐式发现证书。
