# DSH Project Desktop

English · [简体中文](README.md)

An independent AI desktop for multi-repository projects. The Shell owns welcome, project creation/opening/switching, windows and menus, and loads the official DeepSeek UI. The [Project plugin](https://github.com/admintertar/dsh-plugin-project) provides resources, tasks, memory, skills, MCP and project workspaces.

## Current version

Shell **0.2.0 Stable**, bundling official DeepSeek Harness/Desktop **0.2.0-rc.2**. [official-source.lock.json](official-source.lock.json) and [project-source.lock.json](project-source.lock.json) pin the sources. No Anywhere Labs community Desktop dependency or modified official sources.

- Projects have separate windows, Hosts, Profiles, model API keys and browser partitions.
- DeepSeek account sign-in and theme preference are shared across project windows.
- Updates reuse the official sidebar indicator and dialog with our own installers.
- File → Close Page preserves official contextual behavior; Project → Close Current Project closes that project's window and Host.

## Installation

Download from [GitHub Releases](https://github.com/admintertar/dsh-project-desktop/releases/latest): macOS arm64 (Apple Silicon) and x64 (Intel) DMGs, and Windows x64 installer/portable ZIP. macOS uses ad-hoc signing without notarization; Windows is unsigned.

**Install manually when upgrading from 0.1.x. Legacy community Stable data migration is not available; this release preserves and rejects legacy Homes.** Retain the old application and data backup if you need previous conversations, and wait for migration tooling. Application identity and the default data directory are retained. See [0.2.0 release notes](docs/releases/0.2.0.md).

## Development and CI

Use Node 24, official pnpm locks and this project's Yarn locks. See [development notes](docs/development.md).

```sh
yarn check
yarn smoke:official-shell
yarn package:mac # native macOS
yarn package:win # native Windows x64
```

[Official Desktop CI and Release](.github/workflows/package.yml) checks source identity, builds, window lifecycle and relocated packages on three native runners. A `v*` tag matching package.json publishes only after all targets pass. Manual runs may build selected platforms. See [packaging notes](docs/packaging.md).

## License

Independently maintained; not an official DeepSeek distribution. Our code is publicly readable with all other rights reserved; no open-source license is granted. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
