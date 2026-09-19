# Development guidelines

- Maintain an independent shell; do not modify official Desktop/Harness snapshots or maintain a Desktop fork.
- Support only the stable combination in `upstream.lock.json`. Recompute source trees and installed versions before adopting an upgrade.
- Keep official internal APIs in `src/desktop-adapter/` and build scripts. Record additions in `docs/architecture.md`.
- One Electron main process owns isolated per-project Renderers, Hosts, DSH homes, Profiles and Chromium partitions. Recovery and closure must not affect other projects.
- Use the shell's own project-creation guide. Do not falsify official onboarding completion or merely hide disabled capabilities with CSS.
- The companion plugin owns Resources, Tasks, Memory, skills and MCP. Build its pinned commit; do not copy plugin source into this repository or change running Profiles during setup.
- Project entry files live at the root. Memory lives under root `memory/`; share `.agent-project/` metadata while precisely excluding machine-local and temporary records. Never silently choose among multiple project definitions or overwrite an existing project.
- Reuse official UI components, locale and theme. Preserve fixed modal actions, one body scroll region, stable scrollbar gutters and narrow-window behavior.
- Run `npm run check` for source changes. Report native graphical checks separately; do not claim Windows/macOS arm64 acceptance from macOS x64 results.
- Preserve existing work. Repository publication, remote deletion, pushes, releases and upstream PRs require an explicit request.
- Original code has no open-source license grant. Keep `LICENSE` and all third-party notices in generated packages.
