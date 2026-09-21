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

## Production dependencies and Universal packaging

The packaging workflow now builds one Universal DMG on Apple Silicon and launches
that same artifact on Intel, alongside the Windows x64 package job. It reuses the
pinned official dependency collector, package file filters, paired native-module
preparation and Universal merge rules. DMGs use the builder's HFS+ compressed target.

Local source checks passed with 53 application tests, 7 recovery tests, 1 safe-mode
test, source integrity and dual-Host smoke. The dependency fixture covers nested
versions, installed/missing optional dependencies, required-dependency failure,
licenses, development-tool exclusion and both native prebuilds without host build
outputs. Universal merge matching is checked against the official paired-native
inventory inside the Shell's hidden runtime directory; unlisted binaries and
host-only build outputs remain excluded from that exception. Actionlint accepted
the updated workflow. A clean checkout imported the standalone DMG verifier without
installing development dependencies, matching the Intel verification job.

Native Windows checks exposed Git's long-path versus runner short-path aliases and
the local HTTPS fixture's certificate backend. Git-root comparison now canonicalizes
native paths. Only the Windows fixture selects Git's OpenSSL backend and its explicit
test CA; certificate verification remains enabled. All Windows source, recovery,
safe-mode and dual-Host checks passed after these changes. The Windows packager also
uses the official pinned NSIS toolset required by its long-path-aware template.

Installed Windows startup then exposed Node/Chromium's different encodings for
`~` in local file URLs. A real Electron probe reproduced the difference on macOS
as well. Local guide IPC now compares decoded file paths while retaining the
owning main-frame, protocol, host, query and fragment checks; regression coverage
rejects other files, frames, query modes and encoded separators. The Windows
relocation check also uses the native canonical temporary-directory path.

An isolated macOS x64 app with the production dependency payload passed the real
installation diagnostic: welcome, two independent project Hosts, official Renderer,
Chinese menu, safe mode, cleanup and reopening. The diagnostic also caught the
Shell's explicit Electron package-version lookup; staging retains that metadata
without shipping the development Electron binary. The official compressed DMG
target also produced and verified a 196,105,930-byte local thin-x64 probe; this is
separate from the final Universal artifact.

Cloud acceptance for commit `6dca083982a28cb41eb5e47826e95a1bd37f458a` is tracked in
[Actions run 35447527224](https://github.com/admintertar/dsh-project-desktop/actions/runs/35447527224).
Windows x64 passed source/recovery/safe-mode checks, NSIS PE validation, and actual
launch of the extracted portable application outside the checkout. Its installed
welcome, two independent Hosts, official Renderer, Chinese menu, safe mode,
temporary cleanup and normal reopening checks all passed. The unsigned installer
is 138,276,611 bytes and the portable ZIP is 222,431,040 bytes.

The Universal DMG is 290,642,294 bytes (about 291 MB), with SHA-256
`ba3da1fe413ac59aa74e31e94470cde411da3df69d57f1d3bcc911df77990529`.
It passed all 18 official native-file architecture checks, universal executable
checks, strict ad-hoc signature verification, disk-image verification and the
same real installation checks on Apple Silicon. The previous ARM-only Actions
download was 732,414,332 bytes; the new Universal download is 290,645,346 bytes,
about 60% smaller. For comparison, the pinned official Desktop 2.0.11 Universal
DMG is 282,912,868 bytes; the Shell adds about 7.7 MB in the compressed image.

The Intel job downloaded that exact Universal artifact, verified its SHA-256,
mounted the DMG and repeated the real installation checks with native x64 Electron.
All jobs in the run succeeded. The macOS signature remained intact after launch
on both architectures. Windows installer UI/upgrade/uninstall acceptance and
Developer ID/notarization or Authenticode remain separate from these local unsigned
distribution checks.

## Application updates and automatic releases (0.1.0 republish)

Local macOS x64 source acceptance passed: 63 application tests, 7 recovery tests,
1 safe-mode test, immutable upstream verification, production builds and real
dual-Host smoke. Update coverage exercises the official SemVer/lifecycle/downloader
with the Shell release adapter: stable-only metadata and exact asset identities,
ETag reuse, coalesced checks, persistent notification deduplication, both DMG/PE
formats, and corrupt downloads preserving the existing destination. Publication
tests cover candidate promotion, recoverable old releases, rollback, lost successful
responses and annotated tags. Actionlint accepts the release workflow.

The real Electron update smoke passed with ten official dialogs: welcome before
any Host, offline failure, the official settings version popover, renderer IPC,
English/Chinese and light/dark, Escape cancellation, Later, verified download and
two unaffected project Hosts. The narrow 420px welcome retains its update action
without horizontal overflow. Test release responses, save destination and OS
installer handoff are substituted; the official rendered dialogs and their buttons
are exercised. Synthetic future versions do not change the product's 0.1.0 version.
The nine-phase native lifecycle smoke also passed: persisted project restoration,
explicit closure, partial failure, safe-mode quit/relaunch and abandoned-state cleanup.

CI repeats source and native update checks on Windows x64 and macOS arm64, then
validates both packaged applications and the same Universal DMG on Intel. Release
publication requires all jobs to pass and both clean build records to match the
workflow commit, file sizes and SHA-256 values. CI and downloaded-package results
are recorded separately below from local source tests.
Windows interactive installation/upgrade/uninstallation and trusted code signing
remain outside this acceptance.

The first update build caught an installed-startup failure on both platforms:
the raw `system` locale reached the official tray labels. This was reproduced
locally in an isolated packaged copy. The Host bridge now applies the same locale
narrowing as the private official helper, and native startup uses the existing
locale setter. The update smoke explicitly restarts with persisted `system` and
no focused welcome window; installed diagnostics require a resolved `zh/en` locale.
After the fix, that same isolated macOS x64 installed probe passed welcome,
two Hosts, Renderer, Chinese menus, safe mode, cleanup and reopening. This local
probe updates an isolated existing bundle and is not the final rebuilt CI DMG.

Final acceptance for commit `d7ebfc4af801f21c4be9622963c8a9c793ef79fa` passed in
[Actions run 35455370899](https://github.com/admintertar/dsh-project-desktop/actions/runs/35455370899):
Windows x64 and macOS arm64 source/update UI checks, both relocated packaged
applications, and the same Universal DMG launched on Intel. The workflow itself
published the rebuilt [0.1.0 release](https://github.com/admintertar/dsh-project-desktop/releases/tag/v0.1.0).
The version tag resolves to that exact build commit. Both build records report a
clean source checkout; the previous release is retained as a private backup draft.

| Download | Bytes | SHA-256 |
| --- | ---: | --- |
| Universal DMG | 290,927,411 | `c2910b430edb23ca13922f3d8eefb8f6990a0b5c2662bf61709542bc151c3db9` |
| Windows x64 Setup | 138,449,789 | `e90418393a08032adb4d17e440ead20ed764bbd2427f6c4d0bc1d7306b0aa268` |
| Windows x64 Portable ZIP | 222,667,700 | `72bb28744873a01f25017f040b1c51b6ea20864188792ce14021db2885fc3781` |

All three packages were downloaded locally. All six release assets, including
checksum files, match local hashes and GitHub asset digests. Public unauthenticated
downloads, latest-release metadata and the real Shell feed were verified for both
platforms: 0.1.0 reports up-to-date and an older synthetic current version reports
the available 0.1.0 without initiating installation.

On macOS 15.7.7 x64, the downloaded DMG passed disk-image verification, all 18
official native-file architecture checks, six Universal executable checks, internal
link/license checks and strict ad-hoc signature verification. It replaced the
Applications installation after preserving the previous app. With the source DMG
detached, Launch Services started the installed app and its isolated diagnostic
passed welcome/update entrance, two Hosts, official Renderer, Chinese menu, safe
mode, cleanup and reopening. Signatures remained intact and daily project records
were unchanged. The host already had Gatekeeper disabled and the command-line
download had no quarantine attribute; security settings were not changed, and this
is not notarization or browser-quarantine acceptance. Windows interactive installer,
upgrade/uninstall and trusted signing still require their separate acceptance.

## Update entry points (0.1.1)

Local macOS 15.7.7 x64 acceptance passed `npm run check`: immutable upstream
verification, production builds, 63 application tests, 7 recovery tests, the
safe-mode test, project-file checks and real dual-Host smoke. Shell package metadata
now takes its version from the application's package.json, which is 0.1.1.

`npm run smoke:updates` passed with ten real official dialogs. The actual Electron
application menu places Check for Updates in the macOS application-name group,
between About and Services, using the pinned official template. The test invokes
the installed menu command, checks its busy/ready states and verifies that the
extra Help menu is absent. Settings retains the official native actions and no
longer renders the added version control or update popover. English/Chinese and
light/dark settings screenshots and native menu trees were captured; the settings
and official dialog appearance were visually inspected.

The same run retained renderer IPC, Escape/Later, verified download, welcome before
any Host and after all projects close, 420px welcome layout and unaffected project
Hosts. Release responses, save destination and installer handoff remain isolated
test substitutes. This is local source/UI acceptance; Windows and macOS arm64,
packaging and Intel DMG launch checks must pass in the tag-triggered release workflow
before publication. The v0.1.1 packaging plan resolves both platform jobs and the
unchanged stable source pins.

## Static update manifest (0.1.1 republish)

The installed 0.1.1 update failure was reproduced using Electron's real network
stack and the system proxy: the anonymous GitHub REST endpoint returned HTTP 403,
`x-ratelimit-remaining: 0`, and an API rate-limit error. The published installers
and metadata were valid; a direct public checksum download returned HTTP 200.

The replacement feed reads only public static release files. Local macOS x64
`npm run check` passed (67 application tests, 7 recovery tests, 1 safe-mode test,
production builds, immutable source checks, project files and dual Hosts).
Targeted checks cover manifest generation/validation, fixed repository/version
binding, malformed and oversized responses, safe failure details, ETag/empty 304,
verified DMG/EXE downloads, corruption preserving existing destinations and stale
same-version manifests during public verification.

`npm run smoke:updates` passed with twelve real official dialogs, including
connection/HTTP 403/HTTP 429 explanations, menu actions, language/theme, keyboard
cancellation, download confirmation and isolated project Hosts. Captured connection
and rate-limit dialogs were visually inspected. Request assertions prohibit the
GitHub REST API for both version discovery and download verification. Responses,
save destination and installer handoff are synthetic in this regression test.

Publication now generates a seventh asset, `update.json`, from the verified
packages, and validates anonymous latest/tag downloads plus public checksum files
after promotion. `npm run smoke:updates:live` separately exercises the real published
files and the official latest-version dialog through isolated Electron, without
credentials, installer downloads or daily project state. Final CI and live public
results follow below.

Final acceptance passed in [Actions run 35479406633](https://github.com/admintertar/dsh-project-desktop/actions/runs/35479406633)
for commit `99e581cb5654f66d49070cb7bce1419b6b8477a1`: Windows x64 and macOS arm64
source/native checks, both packaged applications, the same Universal DMG on Intel,
publication and real anonymous public manifest/checksum verification. The public
`v0.1.1` tag resolves to that build. Release `392269437` contains all seven assets;
the previous release `392162808` is retained as the private backup draft
`archived-v0.1.1-392162808`.

| Package | Bytes | SHA-256 |
| --- | ---: | --- |
| Universal DMG | 290,648,887 | `8e66ff886aade376872778181e3bd58f8b76655b61162b5378033f83e434db89` |
| Windows x64 Setup | 138,275,308 | `69c3216ede4ac67d648ec224739561f834204587be8e9821f2e168cdaa181448` |
| Windows x64 Portable ZIP | 222,439,889 | `5d49ad605d6c2ee3c4ea117b9776470f9d9f25cb3b610ba0130be37dffe6e020` |

The 1,200-byte `update.json` has GitHub digest
`sha256:5bd72d5cc75290c45971689dd1292384853f383178b3d09d31bc9779d2173cac`.
Local macOS x64 `smoke:updates:live`, pinned to the published commit, fetched latest,
the exact-version manifest and all three checksum files through Electron/system
proxy with HTTP 200. The real official dialog displayed that 0.1.1 is up to date.
No REST API, token, substituted response, installer download or daily project state
was used. A separate native probe checked ten English/Chinese network, timeout,
invalid-manifest, HTTP 403 and HTTP 429 dialogs, including wrapping and footer bounds.

The live probe uses an app-ready callback and keeps Electron alive until its
evidence is written after dialog closure. This diagnostic-script lifecycle fix is
recorded separately from the published application; it does not change its updater
or require another installation build. Same-version users must manually replace
their previous 0.1.1 once. Windows installer wizard/upgrade/uninstall and trusted
signing remain outside these automatic checks.

## Renderer clipboard permission fix (0.1.2)

Accepted on the macOS x64 baseline, 2026-09-20:

- Root cause: `src/desktop-adapter/native.mjs` and
  `src/windows/guide-window.mjs` installed
  `setPermissionRequestHandler(() => false)` together with
  `setPermissionCheckHandler(() => false)` on their windows' Sessions. Electron 43
  routes `navigator.clipboard.writeText` through that handler as `clipboard-read`,
  so every copy affordance of the official DSH client UI was rejected with
  `NotAllowedError: Write permission denied.`; `writeClipboard` returns `false`
  without any feedback, so the buttons silently did nothing. The official Desktop
  runtime installs no permission handler at all, which is why copy works there.
- Isolated Electron 43.3.0 probe, using the same `sandbox`/`contextIsolation`
  window options as the Shell against a real loopback page with a focused
  document: no handler → `ok`; allow `clipboard-read` → `ok`; allow only
  `clipboard-sanitized-write` → denied; deny everything → denied.
- Native acceptance with the fixed build: a real project window opened a real
  session and a real `Input.dispatchMouseEvent` click on the message copy button
  switched it to the copied state (`aria-label="复制成功"`) and left the exact
  message text on the system clipboard, read back through
  `navigator.clipboard.readText()` and `pbpaste`. Hover (`复制`) and copied
  (`复制成功`) screenshots were inspected in the Chinese dark theme.
- `npm run check` passed every stage except `tests/project-bootstrap-network.test.mjs`,
  which hangs in this local environment inside its loopback Git fixture. The same
  file hangs and times out identically on a pristine `HEAD` worktree with
  `node_modules` and `dist` linked, and no changed file is in its import graph.
- `npm run build`, 68 application tests, 7 recovery tests, 1 safe-mode test,
  project-file creation/history checks, immutable source verification and the real
  dual-Host smoke all passed. Local evidence: `.runtime/smoke-ycL4GO`.

## Renderer permission alignment with official Desktop

Accepted on the macOS x64 baseline, 2026-09-20:

- The official `dsh-plugin-desktop` installs no renderer permission handler at
  all: no `setPermissionRequestHandler`/`setPermissionCheckHandler` in its `src/`,
  in the built `lib/`, or in the installed `/Applications/DSH Desktop.app`. Its
  renderer boundary is `webPreferences` (`contextIsolation`, `nodeIntegration:
  false`, `sandbox`, `webSecurity`), navigation/popup/webview blocking, the
  dedicated partitions and the capability header — never a permission policy.
- The Shell's deny-all handler and its `will-download` block were therefore
  deviations, not shared policy. Both are removed from the window modules; the
  clipboard allow-list helper and its unit test are gone with it, replaced by an
  assertion that neither window module installs a permission handler or a
  `will-download` listener. The client exposes no browser-download affordance, so
  the download block had no observed effect; it is dropped for parity only.
- Native re-acceptance with the aligned build: `geolocation`, `notifications`,
  `camera` and `microphone` report `granted` (Electron defaults, matching
  official) instead of `denied`, and a real click on the message copy button still
  switched it to `复制成功` with the exact message text on the clipboard.
- `npm run build`, 70 application tests (none skipped), 7 recovery tests, 1
  safe-mode test, immutable source verification, project-file checks and the real
  dual-Host smoke all passed. Local evidence: `.runtime/smoke-O05BdS`.

## Windows Mica material on project windows

Accepted on Windows 11 Pro 25H2, build 26200.9457, 2026-09-21. This is the first
acceptance in this document that is native Windows for the material path; the
macOS x64 baseline above does not certify it and the reverse is now also true.

Two defects were found and fixed in `src/desktop-adapter/native.mjs`; both sit on
the shell's own replacement of an official object, and both failed silently.

- `windowsBuild` was missing from the shell's native runtime object. The official
  `ElectronDesktopRuntime` resolves it in its constructor, and `runtimeSnapshot`
  passes it to the Host, where `desktopRendererUrl` turns it into the
  `dsh-desktop-mica` renderer marker. Without the field the marker was `0`, so
  `micaSupported` was false: the 桌面设置 material row offered only 纯色背景, and
  `effectiveDesktopWindowMaterial` additionally read a persisted `windowsMaterial:
  mica` as unsupported and fell back to `off`. The value now comes from the
  official `window-material` probe instead of being reconstructed.
- `setThemeSource` was a no-op, so a live theme change never re-applied the window
  material. The official method does both: it sets `nativeTheme.themeSource` and
  calls `generation.refreshThemeMaterial()`; its comment records that Windows keeps
  the preceding DWM Mica palette until the window recomposes. The advanced sidebar
  is transparent whenever a material is active, so after switching dark → light the
  content region followed the theme while the sidebar kept the stale palette and
  looked black under a light theme. `SharedTheme` still owns `nativeTheme` for the
  whole application; the shell only restores the official re-apply step, through
  `electronPlatformStrategy().refreshThemeMaterial`, and additionally on the first
  on-screen composition (`window.once('show')`), because that first composition is
  what Windows caches.

Native acceptance on the above build: the material row lists Mica and the choice is
persisted to the project Home (`windowsMaterial: mica`); the window composited Mica
with a light sidebar; and switching dark → light → dark left the sidebar following
the theme with no stale dark palette. `yarn check` passed on Windows: upstream
integrity, build, 86 application tests, 7 recovery tests, 1 safe-mode test,
project-file checks and the real dual-Host smoke. Regression coverage is
`tests/windows-build-capability.test.mjs` and
`tests/window-material-refresh.test.mjs`; the latter pins the silent-missing cases
and guards the hook so it cannot be reduced to a no-op again.

The advanced sidebar is transparent by design while a material is active
(`--dsw-specific-sidebar-fill: transparent`), so its colour is always the composited
window backdrop rather than a CSS value. Any future "the sidebar has the wrong
colour" report should be read as a material/composition question first, not a CSS
one.

### Failed approaches in this investigation

Recorded because the detours cost more time than the fix, and because the same
traps apply to any native-surface check done beside a running application.

- Two windows were stacked on screen (the user's installed app, an installed
  project window, and the development shell's own windows). Every screen-coordinate
  sample silently measured whichever window happened to be on top, which produced
  contradictory results — "the sidebar is white" and "the sidebar is black" from the
  same coordinates minutes apart. Activating a window by PID before sampling, and
  reading the DOM over CDP instead of inferring from pixels, is what settled it.
  Screen sampling without a proven foreground window is not evidence.
- Reading the user's downscaled screenshots as if they were pixels was misleading:
  a JPEG preview of an app window is downscaled and its text antialiasing bleeds, so
  dense chrome (the session list) can average to colours that look like a background.
  Sample the real screen or the live DOM, never a communication preview.
- `git worktree` copies cannot run the check on Windows as-is: the check asserts
  paths inside the worktree, so junctions for `node_modules`/`.upstream`/`.yarn` are
  fine but `.runtime` must be a real directory — a junction there makes the
  temporary-path assertions compare against the main checkout and fail.
- The same worktree run needs `git` and `openssl` on `PATH`; `tests/fixtures/private-git.mjs`
  generates its own CA, so without `openssl` three guide-clone tests fail for
  environmental reasons that look like code failures.
- Electron does not implement `Browser.getWindowForTarget`/`Browser.setWindowBounds`,
  so a window cannot be resized over CDP to test composition; resize the window from
  application code instead.
- Do not write source files with shell redirection on this platform: a PowerShell
  round-trip added a BOM and mangled the Chinese diagnostics copy in
  `native.mjs`. Use the file tools, and verify with `git diff` afterwards.

