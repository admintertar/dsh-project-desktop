# Desktop 2.0.15 Upgrade Implementation Plan

**Goal:** Upgrade the supported stable combination to Desktop 2.0.15 and Harness 0.1.7-rc.2 without changing official source.

**Architecture:** Pin the official Desktop commit and its stable Harness commit, export their source from Git objects, and build the existing Shell and companion Project plugin against that combination. Keep application ownership and project data boundaries in the Shell. Update only compatibility adapters whose upstream contract changed.

**Tech stack:** Electron, Yarn 4, esbuild, TypeScript, Node.js tests.

---

### 1. Recompute and verify upstream sources

- Record the v2.0.15 commit, `dsh-plugin-desktop` tree, stable Harness commit, runtime inventory tree, and three guide source trees in `upstream.lock.json`.
- Export snapshots with `scripts/setup.mjs` into this isolated checkout and run `yarn verify:upstream`.
- Verify the installed dependency graph matches the new stable Harness version.

### 2. Upgrade the companion plugin

- In its own worktree, update `upstream.json`, Harness peer and development dependency versions, and its Yarn lockfile.
- Run `yarn check` and Desktop compatibility checks against the 2.0.15 source. Adapt only concrete API differences.
- Commit the plugin change locally so the Shell lock can name an exact source tree. The plugin commit must be pushed before any Shell CI job can check it out.

### 3. Upgrade the Shell

- Update the Shell's pinned Project commit/tree, integration adapters, version assertions, and current-version documentation. Keep historical release notes unchanged.
- Run `yarn check` and relevant native smoke checks from this worktree. Inspect source-level contracts for profile, update, window, and Host integrations changed upstream.
- Commit the Shell change locally after verification. Packaging and platform acceptance remain separate from source checks.
