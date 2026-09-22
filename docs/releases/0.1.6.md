# DSH Project Desktop 0.1.6 — MCP 声明拆分与迁移版 / Per-server MCP declarations

本次发布把 MCP 声明从单一文件改为每个 server 一个文件，并在打开项目时自动迁移；同时让「项目资产」的逐条目提交真正做到只提交勾选的内容。

This release moves MCP declarations to one file per server with automatic migration on open, and makes committing a project-asset selection stage exactly what was selected.

## 中文

### MCP 声明改为每个 server 一个文件

- **一个 server 一个文件**：声明保存在 `mcp/servers/<id>.yaml`。因此「项目资产」里每个 server 都是独立的一条，勾选其中一个只会提交它自己，不会连带同一文件里的其他服务。
- **打开项目时自动迁移**：旧的 `mcp/servers.yaml` 在项目打开时被拆分——先逐个写入新文件（同名文件不覆盖），全部成功后才删除旧文件；旧文件无法解析时原样保留、不阻断项目打开；空旧文件也会被清理。迁移是幂等的，重复打开不会再产生变更。
- **不再兼容旧格式**。**这是破坏性变更：迁移后的项目，旧版本的 DSH 将读不到这些声明。**

### 逐条目提交真正做到「勾什么就提交什么」

- **技能索引**：`skills/index.yaml` 是一个文件承载全部技能，此前勾选一个技能会连带提交整个文件。现在提交时用 `git hash-object` + `git update-index` 把「只含选中技能状态」的内容写入暂存区，**不改写工作区**，其余待审阅项原样保留。
- **MCP**：靠每-server 文件的路径隔离，不再需要特殊暂存逻辑。
- **无法识别的文件**仍然归入「其他文件」，且默认不勾选——既不静默丢弃，也不会在你不注意时被提交。

### 验证

- 插件 `yarn check` EXIT=0（275 条测试，含迁移、幂等、空文件清理、失败保护、变更映射路径隔离与技能索引精确提交）；壳 `yarn check` EXIT=0。
- macOS 原生冒烟 EXIT=0：中英文案、明暗主题、1180/420 两种宽度，并断言三个独立声明各成一张卡片。

### 已知限制

- 迁移是**静默的**：界面不会提示，只会看到旧文件被删除、新文件新增。
- 「其他文件」默认不勾选；项目记忆仍没有新增入口。
- MCP 面板暂未把手工放入 `mcp/servers/` 的文件与面板列表做差异提示。
- 安装包未签名（macOS 为 ad-hoc，Windows 未签名）。

## English

### One file per MCP server

- **One declaration per server**: declarations live in `mcp/servers/<id>.yaml`, so each server is its own asset in the project review. Selecting one commits only that server, never its siblings from a shared file.
- **Migrated automatically on open**: the retired `mcp/servers.yaml` is split when the project opens — every new file is written first (an existing file with the same id is never overwritten), and the old file is removed only after all writes succeeded. An unreadable old file is left untouched and does not block the project; an empty one is cleaned up. Migration is idempotent, so reopening changes nothing.
- **The old format is no longer read.** This is a **breaking change**: after migration, earlier DSH versions cannot see these declarations.

### Committing exactly what you selected

- **Skill index**: `skills/index.yaml` carries every Skill, so committing one used to stage the whole file. It is now staged by content (`git hash-object` + `git update-index`), writing only the selected Skill's state into the index **without touching the worktree**, leaving the rest of the review intact.
- **MCP** relies on per-server file paths, so no special staging is needed.
- **Unrecognized files** still land in "Other files" and stay unselected by default — never dropped silently, never committed unnoticed.

### Verification

- Plugin `yarn check` EXIT=0 (275 tests, covering migration, idempotence, empty-file cleanup, failure protection, per-asset path isolation and precise Skill-index staging); Shell `yarn check` EXIT=0.
- Native smoke on macOS EXIT=0: both languages, light and dark themes, 1180/420 widths, asserting that three separate declarations each become their own card.

### Known limitations

- Migration is silent: the UI does not announce it; you only see the old file removed and the new ones added.
- "Other files" are not selected by default, and project memory still has no creation path.
- The MCP panel does not yet reconcile declarations added to `mcp/servers/` by hand.
- Installers are unsigned (ad-hoc on macOS, unsigned on Windows).
