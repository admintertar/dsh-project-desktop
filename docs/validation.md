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
- Initial publication `npm run check` passed: source integrity, build, 41 application tests, four
  recovery tests, one safe-mode test, project-file creation/history checks and
  the real dual-Host smoke.
- Dual-Host checks covered independent processes/homes/ports, project context,
  renderer authentication, market binding, disabled official updates, shared
  theme and close/reopen isolation.
- The generated plugin retains its LICENSE and third-party notices.

The check command builds before tests, so a fresh prepared checkout does not
depend on pre-existing dist files. Original Desktop and Harness source trees
remain unchanged before and after compilation.

## Project Profiles and official Recovery Assistant

Accepted on the same macOS x64 baseline, 2026-09-19:

- `npm run check` passed: source integrity, build, 47 application tests, seven
  recovery tests, one safe-mode test, project-file creation/history and real
  dual-Host smoke. The latter also starts a second Profile in one project and
  verifies the project, Memory and market binding while the other Host stays
  alive. Local evidence: `.runtime/smoke-xrZelR`.
- `npm run smoke:native` passed its full graphical suite: project creation and
  resource authentication, settings and official restart confirmations, dual
  windows, locale/theme, crash isolation, recovery and safe mode. Local
  evidence: `.runtime/native-DplPIl/result.json`.
- `npm run smoke:profiles` passed with real Electron windows and Hosts. It
  covers official Profile creation/selection, creator cancellation and Return
  submission, persistent selection, unchanged project manifest and actual
  Project plugin/market binding. Local evidence:
  `.runtime/profile-recovery-xKLNaj/result.json`.
- The Profile suite also covers manual recovery, automatic recovery from
  damaged settings, Host and Renderer crashes, official rollback and plugin
  uninstall with both cancellation and confirmation, Profile switching from
  recovery, safe-mode entry and exit back to recovery, and closing only the
  affected project. A disposable local plugin exercises the real official
  uninstall CLI; the bundled Project plugin has no uninstall action.
- Actual screenshots of the unchanged official creator, selector and Recovery
  Assistant were inspected in English/light and Chinese/dark. At 680 × 560,
  the recovery footer remains visible and the document does not overflow
  horizontally; the official tab strip scrolls horizontally and the content
  scrolls vertically. Screenshots accompany the Profile suite result.
- `npm run smoke:lifecycle` passed all nine phases: initial open, restoring two
  and one projects, empty history, missing project relocation, safe-mode quit,
  relaunch, abandonment and cleanup. Closing a recovery window before its
  document finishes loading is treated as normal cancellation. Local evidence:
  `.runtime/lifecycle-i3pJfL`.

These checks use isolated application data and synthetic temporary projects;
they make no model calls and do not restart the user's normal application.
Official Desktop and Harness source trees remain unchanged. Logs, screenshots,
test dependencies and runtime evidence are ignored and are not publication
artifacts.

The final focused Profile and lifecycle suites include the latest shutdown
handling. The full native suite preceded that small correction; its affected
shutdown path was covered by the final lifecycle run.

Application-global DSH Home relocation and factory reset are not exposed by the
project-scoped assistant; the unchanged official data-management page reports
those capabilities as unavailable. Profiles share their project's Home-level
settings, and official configuration rollback can restore those shared files.

Network dependency-rebuild acceptance under Electron, a new installer build,
Developer ID signing and platforms other than macOS x64 were not rerun for
this change. A successful local plugin uninstall does not certify registry or
network recovery. Their entry points and limitations are documented separately.

Source snapshots, dependency caches, logs and runtime data remain ignored.
No remote repository, release or package was created or published by these checks.
