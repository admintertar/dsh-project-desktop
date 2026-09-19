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

## Compact welcome and project-creation windows

Native guide acceptance on macOS x64, 2026-09-19:

- Final `npm run check` passed: 47 application tests, seven recovery tests, one
  safe-mode test, build/source integrity, project creation/history and dual-Host
  checks. Local Host evidence: `.runtime/smoke-WEGT3L`.
- `npm run smoke:guide` passed using isolated application data. Local evidence:
  `.runtime/guide-frame-JJBPz2/result.json` and `guide-frame-layout.json`.
- Verified default sizes of 900 × 640 and 980 × 720, official advanced chrome,
  macOS native traffic-light position, transparent sidebar and opaque content.
- Exercised actual Electron mouse events with pointer capture, minimum/maximum
  widths, keyboard arrows/Home/End, double-click reset, independent saved widths
  and reopening. Defaults are 187px for welcome and 190px for creation, with
  bounds of 176–280px adapted from the main frame's geometry. Double-click reset
  restores each window's own default. Saved v1 preferences shrink proportionally
  once on migration to v2; reopening does not shrink them again. The divider
  stays transparent on mouse hover, pointer down, drag and pointer up in both
  themes, including focus transferred from an input. Keyboard resizing retains
  its visible focus cue.
  Both windows retain two columns below the main frame's 1024px breakpoint;
  they preserve at least 400px for content and use compact navigation below
  576px, restoring the preferred width when enlarged. Native frame tests ignore
  physical mouse movement while injecting Electron pointer events to prevent
  the user's cursor from interrupting automated pointer capture.
- English/Chinese and light/dark checks cover default size, 700 × 560,
  600 × 560, the 576px two-column boundary and
  420 × 460, fixed footer visibility, vertical scrolling and no horizontal
  overflow, including sidebar labels at their minimum width. Filtering from
  overflowing to short content preserves positions and widths. Switching between
  empty and full-stack compositions also preserves form geometry when overflow
  disappears and returns. Content uses equal 24px left/right insets and zero
  bottom padding. The right inset contains an 8px content gap, the official
  8px scrollbar and an 8px outside gap. Header, body and footer content share
  the same horizontal bounds. Both footers have zero padding and a 65px minimum
  height. Compact creation windows hide the repeated content header; widening
  restores it. Add resource and Browse use matching official button height,
  font size, line height, radius and padding.
  Real Electron wheel events verify that idle scrollbar thumbs are transparent,
  become visible while scrolling and fade out after inactivity, with identical
  content positions, widths and gutter sizes across those states. The official
  scrollbar colors and dimensions are retained.
  The existing guide creation, resource dialogs, authentication,
  keyboard navigation, narrow menus and retry suites also passed.
- Renderer captures were inspected for layout. They contain transparent pixels
  in the glass region and omit native traffic lights; they do not by themselves
  show the macOS-composited material. Native controls are additionally checked
  through the actual BrowserWindow API.
- Full native window captures were separately inspected, including macOS glass,
  embedded traffic lights, compact footers, spaced scrollbars and the hidden
  creation header in narrow windows. Chinese light/dark captures at default and
  compact sizes, including visible and idle scrollbar pairs, are in
  `.runtime/guide-native-preview-QgHZ2W`; English layouts
  are also covered by the renderer captures and native interaction suite above.
- Welcome branding places a 42 × 42px icon on the left and stacks the title above
  the version on the right, with equal icon/text-block height and a 4px gap.
  The bottom navigation caption has zero bottom margin. Focused native checks at
  187px and 176px sidebar widths and 420 × 460 compact size confirm both text
  lines remain fully visible without horizontal overflow. Final geometry and
  captures: `.runtime/guide-brand-preview-b6CR5R/result.json`; the light/minimum
  native capture was visually inspected. Earlier English/Chinese and light/dark
  brand captures are in `.runtime/guide-brand-preview-gMzDwW`.

Windows Mica follows the unchanged official capability gate; Windows graphical
acceptance and a new installer were not run for this change.

## Loading feedback in project guides

`npm run check` passed for the loading update: 47 application tests, seven
recovery tests, one safe-mode test, project-file checks and dual-Host smoke.
Host evidence: `.runtime/smoke-ueQzNy`.
`npm run smoke:guide` also passed, including frame, creation, resource-menu and
authentication regressions. Result: `.runtime/guide-frame-P3ag4Q/result.json`.

The native loading checks exercise real welcome/create windows, their preload
and main-process progress events, and real project-file creation. Held picker
and startup callbacks make cancellation, slow opening and failure deterministic;
these callbacks do not constitute new native file-picker or Host-boot acceptance.
English/Chinese and light/dark checks cover:

- Loading only on the selected recent card or triggering button; no extra
  loading paragraph in the scroll body. Cards, button widths, form positions
  and footer geometry remain identical while waiting, including 420px windows.
- File-picker cancellation and directory browsing without false opening state;
  duplicate clicks/native commands are ignored during an operation.
- Main-process `creating` then `opening` events with the same operation id,
  actual created files, form locking, and the delayed fixed-footer explanation.
- Startup failure restores controls and preserves the form; stale progress
  events cannot reactivate loading after completion.

Screenshots: `.runtime/guide-frame-P3ag4Q/*-loading-*.png`. English welcome and
Chinese narrow welcome/create plus English dark creation captures were visually
inspected on the same application build in `.runtime/guide-frame-WxLTKh`.
The frame test now rechecks its condition after settling: a queued programmatic
scroll event can invalidate the first idle sample before the old fixed delay
ends. The actual scrollbar visibility and geometry assertions remain intact.

Source snapshots, dependency caches, logs and runtime data remain ignored.
No remote repository, release or package was created or published by these checks.
## Packaging workflow validation

The packaging workflow targets native macOS x64 / arm64 and Windows x64. Local
validation on macOS x64 passed `npm run check`: 50 application tests, 7 recovery
tests, 1 safe-mode test, source integrity, project-file checks and dual-Host smoke.
Actionlint 1.7.12 accepted `.github/workflows/package.yml`.

The shared staging and macOS packager produced an ad-hoc signed DMG, passed strict
signature and disk-image verification, and launched the copied app outside the
development checkout. The installed app passed welcome, two-project Host/Renderer,
Chinese menu, safe-mode cleanup and close/reopen checks; its signature remained
intact after launch. Tests used an isolated checkout and synthetic project data.

Windows and macOS arm64 require their own successful Actions jobs; the local x64
result does not certify them. Windows NSIS interactive installation, upgrades,
uninstallation and Authenticode, plus macOS Developer ID/notarization and download
quarantine behavior, remain separate acceptance work. See [packaging](packaging.md).
