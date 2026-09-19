# macOS 本地打包与签名

目前目标为 macOS x64、Electron 43.3.0、Desktop stable 2.0.11 / Harness 0.1.5-rc.2。Apple Silicon 原生包、Windows 和 Linux 不在本次验收范围。

## 本地安装包

完成 README 的缓存准备后运行 `npm run package:mac`。输出在 `release/<版本与时间>/`，最近成功结果记录在 `.local/last-package.json`。

流程包括固定源码/运行依赖验证、独立 staging、相对链接审计、electron-builder 生成自有应用、由内到外签名 Mach-O 和嵌套 bundle、严格签名验证、复制到开发目录外进行真实安装自检，最后生成 DMG、磁盘镜像校验和 SHA-256。应用标识为 `local.dsh.project.desktop`，名称为 `DSH Project Desktop`，直接使用仓库 `assets/app-icon.icns` 作为安装图标，并携带完整 `assets/` 供 Dock、窗口和托盘使用。安装自检逐字节核对图标资源与 bundle 图标，避免开发环境存在而安装包遗漏。DMG 包含应用及 Applications 拖放入口。

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
