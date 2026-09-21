# Development guidelines

- Repository migration is complete as of 2026-09-19. All further development, fixes, builds and verification must use the public `dsh-project-desktop` and companion `dsh-plugin-project` repositories in their shared public workspace.
- Previous private repositories and the old Desktop fork are archival references only. Earlier instructions to develop or push there are superseded; do not copy private history, local configuration or private examples into the public repositories.
- Maintain an independent shell; do not modify official Desktop/Harness snapshots or maintain a Desktop fork.
- Support only the stable combination in `upstream.lock.json`. Recompute source trees and installed versions before adopting an upgrade.
- Keep official internal APIs in `src/desktop-adapter/` and build scripts. Record additions in `docs/architecture.md`.
- One Electron main process owns isolated per-project Renderers, Hosts, DSH homes, Profiles and Chromium partitions. Recovery and closure must not affect other projects.
- A project owns one DSH Home containing multiple Profiles, with at most one running Profile. Persist selection in its local application state using the official Profile manager; do not add the current selection to the shared project manifest. Reuse official Profile creation/selection and Recovery Assistant windows. The welcome window only manages project opening/creation/history and missing project locations.
- Use the shell's own project-creation guide. Do not falsify official onboarding completion or merely hide disabled capabilities with CSS.
- The companion plugin owns Resources, Tasks, Memory, skills and MCP. Build its pinned commit; do not copy plugin source into this repository or change running Profiles during setup.
- Project entry files live at the root. Memory lives under root `memory/`; share `.agent-project/` metadata while precisely excluding machine-local and temporary records. Never silently choose among multiple project definitions or overwrite an existing project.
- Reuse official UI components, locale and theme. Preserve fixed modal actions, one body scroll region, stable scrollbar gutters and narrow-window behavior.
- Before any frontend change, read and follow [Shell frontend guidelines](docs/frontend-guidelines.md) and its linked companion-plugin shared guidelines. Both are required; the Shell document adds window and lifecycle rules to the shared component requirements.
- Run `yarn run check` for source changes. Report native graphical checks separately; do not claim Windows/macOS arm64 acceptance from macOS x64 results.
- Preserve existing work. Repository publication, remote deletion, pushes, releases and upstream PRs require an explicit request.
- Original code has no open-source license grant. Keep `LICENSE` and all third-party notices in generated packages.

## Official functionality reuse / 官方功能复用

我们的壳是在官方 DSH Desktop 上做增强、裁剪和项目化适配。恢复或接入官方已有功能时，优先复用官方现成的完整逻辑与界面。

- 先追踪固定 stable 版本的完整调用链，包含入口、配置保存、确认与取消、生命周期和实际显示的窗口。官方已有组件、窗口、服务或流程可以复用时，直接调用；需要构建资源时，从固定官方源码编译，保持上游源码不变。
- 复用必须覆盖实际行为和界面，不能只复制名称、文案或参数后另写一套实现；官方使用自己的弹窗时，不以系统对话框或自制弹窗替代。仅在无法直接复用的部分做最小适配，并在代码及架构文档中注明官方来源和适配原因。
- 自有逻辑集中在产品增强与裁剪、项目边界和多窗口隔离等差异上。涉及 UI 的验收必须打开并操作真实官方界面，核对外观、确认、取消和键盘行为；仅模拟接口返回值不能视为 UI 复用验收完成。
