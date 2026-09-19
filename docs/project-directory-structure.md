# 项目目录与文件说明

本文说明通过 DSH Project Desktop 创建的项目在磁盘上的组织方式，以 Web 应用项目 `test01` 为例。适用于当前 stable 版本组合及 2026-09-19 的 Memory 目录调整。

项目根目录负责管理整个项目；资源目录承载具体代码或资料；`.agent-project/` 保存程序维护的项目内部数据。项目内容和共享配置随项目 Git 管理，本机配置与临时运行记录按文件单独忽略。

## 1. 目录总览

下面展示一个已经添加记忆、任务和技能的项目。标为“按需”的内容不会在创建空项目时全部生成。

```text
test01/
├── test01.agent-project          # 项目入口与定义，YAML 格式
├── AGENT.md                      # 项目级 Agent 工作约定
├── .git/                         # 项目本身的 Git 仓库数据
├── .gitignore                    # 项目根仓库的忽略规则
│
├── resources/                    # 默认的资源存放位置
│   ├── test01-backend/           # 后端资源，独立 Git 仓库
│   │   ├── .git/
│   │   ├── AGENT.md              # 该资源的 Agent 工作约定
│   │   └── ...                   # 后端源码、构建配置等
│   └── test01-web/               # 前端资源，独立 Git 仓库
│       ├── .git/
│       ├── AGENT.md
│       └── ...
│
├── memory/                       # 项目长期记忆，按需创建
│   ├── architecture.md           # 架构和技术决策示例
│   └── conventions.md            # 业务约定和经验示例
│
├── tasks/                        # 项目任务
│   ├── 实现登录功能/              # 创建任务时生成；目录名由任务标题确定
│   │   ├── task.md               # 结构化任务记录
│   │   └── artifacts/            # 该任务的报告、SQL、图片等交付文件
│   ├── .write-lock               # 写入期间的临时锁，按需出现
│   └── .write-lock.recovery      # 锁恢复时的临时文件，按需出现
│
├── skills/                       # 项目级技能
│   ├── index.yaml                # 技能启用状态
│   └── api-review/               # 示例技能，导入或创建后出现
│       ├── SKILL.md              # 技能定义与使用说明
│       ├── scripts/              # 技能附带脚本，可选
│       └── references/           # 技能参考资料，可选
│
├── mcp/                          # 项目 MCP 服务配置
│   ├── servers.yaml              # 可共享的服务声明
│   └── local.yaml                # 本机环境变量、请求头、工作目录，按需创建
│
└── .agent-project/               # 程序内部的项目数据
    ├── .gitignore                # 内部目录的精确忽略规则，随 Git 提交
    ├── local.yaml                # 本机资源路径绑定，按需创建
    ├── task-sources.yaml         # 任务与来源会话的追溯记录，按需创建
    └── resource-transaction.json # 资源配置写入的临时恢复记录
```

资源可以使用自定义的项目内路径，也可以关联项目外的现有目录。`resources/` 是新建资源的默认位置，项目定义记录实际位置；空项目没有预置资源，因此不需要生成这个目录。

## 2. 文件夹和文件各自负责什么

“项目 Git”指根目录 `test01/` 的仓库；资源自身的 Git 仓库独立管理。

| 路径 | 作用 | 维护方式 | Git 归属 |
| --- | --- | --- | --- |
| `test01.agent-project` | 记录项目身份、名称、资源清单和记忆清单，是打开项目的入口 | 程序写入；需要时可按格式编辑 | 项目 Git |
| `AGENT.md` | 告诉 Agent 项目的工作规则，例如修改接口时需要同步检查前后端 | 用户与 Agent 维护 | 项目 Git |
| `.git/` | 保存项目仓库的历史、分支、索引和远端配置 | Git 自己维护 | 不作为普通文件执行 `git add` |
| `.gitignore` | 声明项目根仓库应忽略的资源目录、本机配置和临时文件 | 程序补充规则，保留已有内容 | 项目 Git |
| `resources/资源名称/` | 保存该资源的代码、文档和构建配置 | 在对应资源中开发 | Git 资源由各自仓库提交，默认不重复纳入项目 Git |
| `resources/资源名称/AGENT.md` | 该资源的专用约定，例如后端构建方式、前端组件规则 | 用户与 Agent 维护 | 对应资源的 Git |
| `memory/` | 保存跨任务使用的项目知识、技术决策、业务背景和踩坑记录 | 用户与 Agent 维护；已登记的文档可在记忆页编辑 | 项目 Git |
| `tasks/任务名称/task.md` | 保存任务目标、状态、验收条件、过程记录、引用和产物索引 | 主要通过任务界面与任务工具维护 | 项目 Git |
| `tasks/任务名称/artifacts/` | 保存该任务交付的报告、SQL、图片、设计稿等文件 | 用户与 Agent 产出，按任务归档 | 项目 Git |
| `tasks/.write-lock*` | 协调任务写入和异常恢复 | 程序维护 | 忽略 |
| `skills/index.yaml` | 记录项目技能的启用与停用状态 | 技能页面或配置文件维护 | 项目 Git |
| `skills/技能名称/` | 保存可复用的技能定义及其脚本、参考资料 | 导入技能或直接维护技能文件 | 项目 Git |
| `mcp/servers.yaml` | 记录 MCP 服务名、传输方式、命令或 URL、启用状态等共享声明 | MCP 设置页面维护 | 项目 Git |
| `mcp/local.yaml` | 为本机补充 MCP 环境变量、请求头和工作目录，可能包含凭据 | MCP 设置页面维护 | 忽略 |
| `.agent-project/` | 保存程序维护的项目内部数据；共享文件可以随项目迁移 | 程序维护 | 目录内的共享文件提交，具体本机与临时文件忽略 |

普通 `local` 类型资源也可以没有 Git 仓库。关联已有目录时沿用原位置及原有仓库，不移动文件、不自动补写 `AGENT.md`。远程克隆同样保留仓库原内容。

## 3. 项目入口文件：`名称.agent-project`

新项目的文件名默认与项目文件夹同名，例如 `test01/test01.agent-project`。文件内容是 YAML，扩展名用于让应用识别项目入口。

以下是未配置远端和记忆的 Web 应用示例：

```yaml
schemaVersion: 1
id: test01-demo
name: test01
resources:
  - id: root
    name: test01
    type: local
    path: .
  - id: backend
    name: test01-backend
    type: git
    path: resources/test01-backend
  - id: web
    name: test01-web
    type: git
    path: resources/test01-web
memory: []
```

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 项目定义格式版本，目前为 `1` |
| `id` | 项目身份标识，程序生成；日常使用保持稳定 |
| `name` | 项目显示名称 |
| `description` | 可选的项目说明，会进入项目上下文 |
| `resources` | 资源声明；包含资源 id、名称、类型、路径，以及可选的远端 `url`、克隆分支 `branch` |
| `memory` | 登记需要加载的记忆文件，包含 id、名称和路径；空列表表示没有项目记忆 |

资源的相对路径以项目根目录为基准。外部目录可以省略共享声明中的 `path`，由 `.agent-project/local.yaml` 保存本机绑定；本机绑定优先于共享路径。资源 id 用于任务引用等关联，显示名称与实际目录可以不同。

`root` 是当前内部保留的根目录绑定：`path: .` 指向 `test01/` 本身。它用于任务引用与项目上下文，不在资源页面和资源数量中作为普通资源展示。这里的 `type: local` 不表示根目录没有 Git；根 Git 由 Shell 单独初始化。

当前项目定义没有独立的“项目仓库远端”字段。项目本身的远端由根 Git 仓库管理，资源远端由资源配置和对应资源 Git 管理，两者互不替代。项目概览目前不提供根仓库操作。

打开项目目录时，若其中只有一个项目文件便直接打开；有多个时必须明确选择。仅保留根目录项目文件这一种入口，不使用 `.agent-project/project.yaml`。

## 4. `AGENT.md`、Memory 与技能的区别

| 内容 | 适合存放什么 | AI 如何使用 |
| --- | --- | --- |
| 项目与资源的 `AGENT.md` | 工作规则、编码约定、构建与验证要求 | Shell 自动读取项目根及已声明资源根的文件，加入上下文 |
| `memory/` | 已确认的项目事实、架构决策、业务背景与长期经验 | 插件读取项目定义里登记的文件，将正文加入上下文 |
| `skills/` | 可复用的操作方法、检查步骤、脚本与资料 | 通过官方技能服务注册和使用，启用状态由 `index.yaml` 管理 |
| `tasks/` | 一项工作的目标、进度、验证和交付记录 | 通过项目任务工具读取与更新；任务不绑定某个会话 |

创建 `memory/architecture.md` 后，还需要在项目文件中登记，才会出现在记忆页和项目上下文中：

```yaml
memory:
  - id: architecture
    name: 架构约定
    path: memory/architecture.md
```

记忆路径统一以项目根目录为基准，实际文件必须位于真实的 `memory/` 内。程序不会扫描并注入整个文件夹。当前限制为单文件 64,000 字节、登记内容合计 128,000 字节；越界路径和越界符号链接会被拒绝。

任务使用 `tasks/任务名称/task.md` v3 格式，文件由 YAML 元数据和 Markdown 摘要组成。任务目录在创建时由标题确定，同名任务追加后缀，之后修改标题不会自动重命名目录。报告等交付文件放在该任务的 `artifacts/`；代码修改以仓库和 Git 提交记录，不在任务目录再复制一份源码。

文件路径的基准也有区别：记忆路径相对于项目根；任务产物路径如 `artifacts/report.md` 相对于该任务目录；任务参考文件指定 `resourceId` 时相对于对应资源，否则相对于项目根。

## 5. `.agent-project/` 的内部文件

`.agent-project/` 是可随 Git 提交的目录。当前新项目先创建其中的 `.gitignore`，其他内部文件按使用情况生成；未来增加的共享程序数据也放在该目录中。

| 文件 | 用途 | 是否提交 |
| --- | --- | --- |
| `.gitignore` | 精确排除本机与临时文件，保留目录及共享文件的提交能力 | 是 |
| `local.yaml` | 将资源 id 绑定到这台电脑上的实际目录，例如外部代码仓库 | 否 |
| `task-sources.yaml` | 记录任务条目来自哪个本机会话，用于可选追溯；缺失不影响任务本身的读写 | 否 |
| `resource-transaction.json` | 协调项目定义和本机资源绑定的写入；异常中断后用于恢复，正常完成后移除 | 否 |

默认的 `.agent-project/.gitignore` 内容：

```gitignore
/local.yaml
/task-sources.yaml
/resource-transaction.json
```

不要在根 `.gitignore` 中忽略整个 `.agent-project/`。本机数据按文件排除，不改变该目录用于保存共享程序数据的定位。内部文件优先交给程序维护，恢复记录出现时应通过应用处理相应操作。

## 6. 项目 Git 与资源 Git

项目根 Git 保存项目组织方式和协作内容：项目文件、项目级 `AGENT.md`、记忆、任务、技能、共享 MCP 声明和 `.agent-project/` 内可共享的文件。

资源 Git 保存各自的业务代码与资源级约定。新建 Web 应用时，根目录、后端资源和前端资源会分别初始化 Git 仓库；初始化不会自动创建首次提交、配置远端或推送。空资源只带基础约定文件，不会自动生成业务框架或安装依赖。

默认根 `.gitignore` 会包含相应资源目录，例如：

```gitignore
/resources/test01-backend/
/resources/test01-web/
mcp/local.yaml
/.agent-project/local.yaml
tasks/.write-lock
tasks/.write-lock.recovery
```

上面的精确规则与 `.agent-project/.gitignore` 配合使用；已有项目可能保留等效的其他精确规则。资源目录在项目根被忽略，不影响在资源自己的仓库中提交代码。根项目和每个资源可以分别关联不同的远端仓库。

Git 保存文件，不保存空目录。因此 `.agent-project/.gitignore` 可以让内部目录随克隆保留下来；空的 `tasks/` 等目录可能在克隆后由程序重新建立。示例中若有 `.gitkeep`，它只是保留空目录的占位文件。

## 7. 新建时有哪些，哪些按需生成

| 内容 | 当前创建规则 |
| --- | --- |
| `名称.agent-project`、项目级 `AGENT.md`、根 `.git/`、根 `.gitignore` | Shell 新建项目时生成 |
| `.agent-project/.gitignore` | 初始化项目布局时生成，不预置本机绑定 |
| `tasks/` | 初始化为空目录；创建任务后生成任务目录及 `artifacts/` |
| `skills/` 与 `skills/index.yaml` | 初始化；技能索引默认为空 |
| `mcp/` 与 `mcp/servers.yaml` | 初始化；服务列表默认为空 |
| `resources/` 及资源仓库 | 根据所选组合和资源来源创建；空项目没有预置资源 |
| `memory/` 与记忆文档 | 按需创建；新项目配置默认为 `memory: []` |
| 两种 `local.yaml`、`task-sources.yaml` | 保存对应本机配置或来源信息时生成 |
| 任务锁与资源恢复记录 | 对应写入或恢复期间出现 |

旧版创建的项目可能暂时没有新的内部目录。已有项目的空记忆列表无需迁移；旧 `.agent-project/memory/` 中的记忆应一次性迁到根 `memory/` 并同步文件引用。当前程序只读取新位置，不自动覆盖或搬动旧记忆文件。

## 8. 应用运行数据放在哪里

最近项目、窗口恢复、主题以及各项目独立的 DSH 运行数据保存在应用数据目录中。macOS 当前默认位置为：

```text
~/Library/Application Support/dsh-project-desktop/
├── recent-projects.json          # 最近项目列表
├── workspace-session.json        # 待恢复项目、活动窗口及窗口布局
├── theme.json                    # 所有项目窗口共享的明暗主题偏好
└── projects/
    └── <项目文件路径的哈希>/       # 该路径对应的独立运行环境
        ├── project-desktop.json  # 项目路径与运行目录的归属记录
        ├── profile-selection/
        │   └── state.json        # 官方格式的本机 Profile 选择，不写入项目定义
        ├── dsh/                  # 该项目的独立 DSH Home
        │   ├── settings.yaml     # 项目内普通共享设置
        │   └── profiles/         # 多个 Profile，同时只运行一个
        │       ├── desktop/      # 默认 Profile，保留原有环境
        │       └── <名称>/        # 官方模板创建的其他 Profile
        ├── health-snapshots/      # 按 Profile 区分的官方三槽配置检查点
        ├── project-recovery-pending*.json # 恢复未完成时出现，按 Profile 阻止启动
        └── logs/                 # Host 日志
```

这些数据不属于项目 Git。复制或克隆项目可以带走已提交的项目内容，不会自动带走模型配置、会话历史或本机绑定。外部资源在另一台电脑上可以重新绑定。

切换 Profile 不改变项目文件、Resources、Tasks 和 Memory。插件依赖和 Profile 补丁按环境分开；普通设置默认在同项目 Home 内共享。官方检查点也包含部分 Home 共享配置，回滚时会一并恢复，但不会回滚项目代码与资料。恢复助手只处理所属项目，欢迎页负责项目入口与丢失文件定位。

当前运行环境按项目文件的实际绝对路径区分。移动或重命名项目文件后，应用会使用新路径对应的环境并保留旧运行数据；目前不会自动迁移旧会话。

## 9. 维护依据

项目结构变更时，应同步更新本文与 README。当前实现主要对应：

- [项目创建与 Git 初始化](../src/app/project-bootstrap.mjs)
- [项目与资源 AGENT.md 加载](../src/app/project-agent.mjs)
- [项目运行数据归属](../src/app/project-state.mjs)
- [固定的 Project 插件版本](../upstream.lock.json)：插件负责目录初始化、Memory、Tasks、Skills、MCP 及内部配置的读写。

Shell 自身的开发源码与构建目录说明见[架构说明](architecture.md)。
