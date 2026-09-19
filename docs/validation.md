# Validation

Local acceptance baseline: macOS x64, Node.js 22.23.1, Electron 43.3.0,
Desktop 2.0.11 and Harness 0.1.5-rc.2 (stable), 2026-09-19.
The exact companion plugin commit/tree is recorded in upstream.lock.json.

- Installed root dependencies independently with `npm ci`.
- Installed the unchanged official Desktop lockfile in a fresh directory with
  its pinned Yarn. Prepared Electron and its fs-ext native binding. Official
  workspace peer warnings remain upstream warnings; the install completed.
- Exported Desktop/Harness from pinned Git objects and the plugin from its new
  independent root commit. Imported only stable into the Shell runtime.
- `npm run check` passed: source integrity, build, 41 application tests, four
  recovery tests, one safe-mode test, project-file creation/history checks and
  the real dual-Host smoke.
- Dual-Host checks covered independent processes/homes/ports, project context,
  renderer authentication, market binding, disabled official updates, shared
  theme and close/reopen isolation.
- The generated plugin retains its LICENSE and third-party notices.

The check command builds before tests, so a fresh prepared checkout does not
depend on pre-existing dist files. Original Desktop and Harness source trees
remain unchanged before and after compilation.

These checks use synthetic temporary projects and make no model calls. Native
graphical smoke, network recovery under Electron, a new installer build,
Developer ID signing and non-macOS-x64 platforms were not rerun for this source
publication preparation. Their entry points and limitations are documented
separately; headless Host checks do not certify those results.

Source snapshots, dependency caches, logs and runtime data remain ignored.
No remote repository, release or package was created or published by these checks.
