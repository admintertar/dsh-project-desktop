# 已退休的社区运行时测试

`*.legacy.mjs` 原样保留旧 Stable 的测试记录。它们依赖 Anywhere Labs 的
`dsh-plugin-desktop`、HostRpc、私有窗口、更新器或旧打包布局，不能作为直接接入
DeepSeek 官方 Desktop 的验收条件，也不能为了通过它们重新加载社区源码。

默认 `yarn test` 验证现有 Shell 项目管理和官方适配器。`official-shell-imports`
检查真正主进程的模块图及欢迎页构建输入；`smoke:official-shell` 使用正式
`main.mjs`、官方 payload 和真实窗口验证两项目生命周期。安装包、更新、
跨平台与真实 Stable 数据迁移仍是独立的未完成关卡；本次测试切换不表示那些关卡通过。
