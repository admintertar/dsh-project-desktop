import {randomUUID} from 'node:crypto';
import {basename, join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadDesktop, desktopRequire} from './modules.mjs';
import {lock, runtimePackage} from '../paths.mjs';
import {createDesktopTerminalOpener, desktopTerminalPaths} from '../terminal-launch.mjs';
import {projectProfiles} from './project-profiles.mjs';

/** Embed the unchanged stable native windows, with capabilities confined to one project. */
export async function createProjectNativeWindow({stateDirectory, manifestPath, locale, recovery, requested = false,
  failureDetail = '', failureStage = 'host-boot', enterSafeMode, readOnly = false, isClosing = () => false}) {
  const profiles = await projectProfiles({stateDirectory, manifestPath});
  const {ProfileCreateWindow} = await loadDesktop('profile-create-window');
  const token = randomUUID();
  let expectedSelection = profiles.current(), closed = false, creator, creatorTask;
  const assertActive = () => {
    if (closed || isClosing()) throw new Error('Project window is closing');
    if (profiles.current() !== expectedSelection) throw new Error('Profile selection changed outside this window');
  };
  const actions = {
    token,
    list: () => profiles.list().map(profile => ({name: profile.name, current: profile.name === profiles.current(),
      selectable: profile.webCapable && !profile.problem})),
    switchProfile(name, suppliedToken) {
      assertActive();
      if (suppliedToken !== token) throw new Error('Profile selection expired');
      profiles.select(name); expectedSelection = name;
    },
    openCreator() {
      assertActive();
      if (creatorTask) {creator.open(); return creatorTask}
      const completion = Promise.withResolvers();
      creator = new ProfileCreateWindow({locale,
        onSubmit(name) {
          assertActive(); profiles.create(name); profiles.select(name); expectedSelection = name;
          completion.resolve();
        },
        onCancel: () => completion.resolve(),
      });
      creatorTask = completion.promise.finally(() => {creator = undefined; creatorTask = undefined});
      creator.open();
      return creatorTask;
    },
  };
  let ui;
  if (recovery) {
    const {DesktopStartupRecoveryWindow} = await loadDesktop('startup-recovery-window');
    const {exportDiagnosticsZip} = await loadDesktop('diagnostic-export');
    const {openDesktopTerminal} = await loadDesktop('desktop-terminal');
    const {desktopNativeCopy} = await loadDesktop('native-dialog-copy');
    const {showDesktopMessageBox} = await loadDesktop('desktop-dialog-window');
    const profileName = recovery.profileName;
    const profileDir = join(profiles.homeDir, 'profiles', profileName);
    // Same contract and same visible-failure path as the project runtime: this window offers its
    // own "open terminal" entry, and a launch failure must never look like a dead button.
    const launchTerminal = createDesktopTerminalOpener({openDesktopTerminal,
      paths: desktopTerminalPaths({runtimePackage, desktopRequire}),
      reportFailure: cause => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        console.error(`Project terminal: ${error.message}`);
        const copy = desktopNativeCopy(locale === 'zh' ? 'zh' : 'en');
        const owner = ui?.window && !ui.window.isDestroyed() ? ui.window : undefined;
        void showDesktopMessageBox({type: 'error', title: copy.terminalErrorTitle, message: copy.terminalErrorMessage,
          detail: error.message, buttons: [copy.ok], defaultId: 0, cancelId: 0}, owner).catch(dialogCause => {
          console.error(`Project terminal: failed to show the error dialog: ${dialogCause?.message ?? dialogCause}`);
        });
      }});
    ui = new DesktopStartupRecoveryWindow({controller: recovery.controller, locale, requested, failureStage,
      failureDetail: failureDetail || recovery.error || '',
      ...(!readOnly ? {profileActions: actions, configurationPaths: {settingsDocument: join(profiles.homeDir, 'settings.yaml'),
        profilePatch: join(profileDir, 'cordis.patch.yml'), profileManifest: join(profileDir, 'package.json'), profileDirectory: profileDir}} : {}),
      exportDiagnostics: signal => exportDiagnosticsZip(join(stateDirectory, 'logs'), stateDirectory,
        {appVersion: `DSH Project Desktop / Desktop ${lock.desktop.version}`, signal}),
      ...(!readOnly ? {openTerminal: () => launchTerminal({platform: process.platform, appExecutable: process.execPath,
        electronVersion: process.versions.electron, profileName, productVersion: lock.desktop.version,
        profileDir, homeDir: profiles.homeDir, stateDir: join(stateDirectory, 'terminal')}), enterSafeMode} : {}),
      // The shell owns project Homes. Global Home relocation/reset is deliberately not delegated.
    });
  } else {
    const {DesktopProfileSelectionWindow} = await loadDesktop('profile-selection-window');
    ui = new DesktopProfileSelectionWindow({locale, profileActions: actions});
  }
  let settled = false;
  const result = ui.run().catch(error => {
    // Closing while the first local document is loading aborts loadFile; that is a normal cancellation.
    if (closed) return recovery ? 'quit' : 'cancel';
    throw error;
  }).finally(() => {settled = true; creator?.close()});
  // Stable 2.0.11 has no public close/dispose or ready hook. This narrow adapter uses its
  // existing window reference for project-owned shutdown; all rendering/actions stay official.
  const ready = (async () => {
    while (!ui.window && !settled) await delay(10);
    if (ui.window) {
      const window = ui.window;
      const title = `${window.getTitle()} — ${basename(manifestPath, '.agent-project')}`;
      window.setTitle(title);
      window.on('page-title-updated', event => {event.preventDefault(); window.setTitle(title)});
    }
  })();
  void result.catch(() => {});
  return {result, ready, show: () => ui.show(), get window() {return ui.window},
    async close() {
      closed = true; creator?.close();
      await ready;
      await recovery?.waitIdle();
      if (ui.window && !ui.window.isDestroyed()) ui.window.destroy();
      await result.catch(() => {});
    }};
}
