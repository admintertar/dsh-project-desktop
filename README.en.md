# dsh-project-desktop

English · [简体中文](README.md)

An independent AI development desktop for projects spanning multiple repositories. It retains DeepSeek Harness chat, agents and foundational UI while owning the application entry point, project windows and recovery experience.

**No DSH Desktop fork is maintained.** Official Desktop and Harness sources are pinned and unmodified; integration is confined to `src/desktop-adapter/`. The companion **dsh-plugin-project** owns resources, tasks, memory, skills and MCP features within each project.

## Features

- **Project startup:** restore the projects left open at exit; otherwise show a welcome screen with recent-project search, creation and opening.
- **Project creation:** choose a composition, initialize the project and independent resource Git repositories, link existing directories or clone asynchronously with authentication UI.
- **Window isolation:** one Electron main process with separate renderers, Hosts, Profiles, runtime data and browser partitions for each project.
- **Multiple Profiles per project:** each project owns a DSH Home. Use the official windows under **Project Tools → Profiles…** to create or switch environments. Selection stays local; switching restarts only that project.
- **Recovery and safe mode:** handle project failures, configuration checkpoints, dependency rebuilding and temporary safe mode without stopping other projects.
- **Desktop integration:** native file menus, window restoration, notifications, diagnostics, shared light/dark preference and Chinese/English UI.

## Compatibility and status

Early development; only the `stable` channel is supported: Desktop **2.0.11** and Harness **0.1.5-rc.2**. The plugin revision is pinned in [upstream.lock.json](upstream.lock.json). Stable is a release channel, not a long-term API guarantee.

The current local native acceptance baseline is **macOS x64**. GitHub Actions produces one macOS Universal DMG for Intel and Apple Silicon, plus Windows x64 installers. The same DMG is launched on both Mac architectures; acceptance depends on each job's result. Background checks use our own Releases; installer downloads require confirmation and checksum verification. Linux packages, formally signed releases and silent installation are not provided. This is independently maintained, not an official DeepSeek or Anywhere Labs distribution.

## Development setup

Requires Node.js `^22.19.0 || >=24.0.0`, npm, Git, tar and Corepack. Native dependencies may require platform build tools. Place the two repositories alongside the official source caches:

```text
workspace/
├── dsh-plugin-project/
├── dsh-project-desktop/
├── dsh-desktop-source/          # Official source cache
└── deepseek-harness-source/     # Official source cache
```

First complete `npm ci` and setup in the plugin repository as described in its README. Source caches must contain the pinned commits; no fork maintenance is needed. See [development instructions](docs/development.md) for official dependency installation and Electron preparation.

From this repository, install development tools and import pinned sources and matching dependencies:

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

Setup exports committed objects, checks tree hashes and versions, and copies independent dependencies. `.upstream/` stays unchanged; build products go to `.cache/` and `dist/`. The runtime does not link back to development repositories. Open an existing project with `npm start -- /path/to/example.agent-project`. Configure model providers in project settings; automated checks do not call models.

## Project data

The root Git repository stores the project definition, memory, tasks and shared configuration. Each resource Git repository owns its code. `memory/` lives at the project root; `.agent-project/` stores program data, sharing portable records while ignoring machine-local bindings and temporary journals precisely. Project-level Git remotes and resource remotes are separate.

See [project directories and files](docs/project-directory-structure.md). Application runtime data, sessions and model configuration live under application userData, outside project source.

## Checks and packaging

`npm run check` covers application logic, source integrity, building, recovery, safe mode, project creation and real dual-Host smoke tests. Separate `smoke:native`, `smoke:profiles`, `smoke:resources` and `smoke:lifecycle` checks require a graphical session and are not part of headless checks. `smoke:profiles` exercises the official Profile windows, Recovery Assistant and per-project recovery isolation.

```sh
npm run package:mac
# On Windows x64:
npm run package:win
```

Download installers from [GitHub Releases](https://github.com/admintertar/dsh-project-desktop/releases/latest). Local packages are written to `release/`. In Actions → **Package Desktop** → **Run workflow**, select `all`, `mac` or `win`; select `all` with `publish` enabled to publish after verification. Pushing a `v*` tag matching `package.json` automatically builds and publishes. Replacing a release requires the explicit `replace_existing` input. macOS uses ad-hoc signing without notarization; Windows builds are unsigned. Welcome, the macOS application-name menu and the tray menu share application-level update checks using the Shell version. Settings has no added version label or update popover. See [packaging notes](docs/packaging.md) for verification and limitations.

## Architecture and rights

See [architecture](docs/architecture.md) for integration boundaries and the inventory of pinned private upstream interfaces. Upgrades must validate Desktop, Harness and plugin revisions together; the application does not follow latest automatically.

UI work must follow the [Shell frontend guidelines](docs/frontend-guidelines.md) (detailed requirements in Chinese) and the linked shared rules, including complete official UI and workflow reuse.

Original code is currently **publicly readable with all other rights reserved; no open-source license is granted**. See [LICENSE](LICENSE). Third-party material retains its original terms in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). `private: true` only prevents accidental npm publication.
