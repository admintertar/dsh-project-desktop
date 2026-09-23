import electron from 'electron';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {checkGuideFrame} from './native-guide-frame-checks.mjs';
import {checkGuide, checkRepositoryImport} from './native-guide-checks.mjs';
import {checkGuideRemote} from './native-guide-remote-checks.mjs';
import {checkGuideAdd} from './native-guide-add-checks.mjs';
import {checkGuideLoading} from './native-guide-loading-checks.mjs';
import {cancelGuideCreations} from '../src/windows/guide-window.mjs';

if (electron.app.isPackaged || !process.env.DSH_PROJECT_DESKTOP_SMOKE_DATA) throw new Error('A dedicated guide test directory is required');
// The focused case runs the flows a Windows CI runner can verify: the create guide
// with its exact project path preview assertion, plus the repository import case,
// which drives no frame or divider surface and never waits for window focus. The
// frame checks stay out because they need real OS window focus, which a Windows CI
// runner does not reliably grant.
const focused = process.argv.includes('--focused');
const userData = process.env.DSH_PROJECT_DESKTOP_SMOKE_DATA;
electron.app.setPath('userData', userData);
electron.app.on('window-all-closed', () => {});
void electron.app.whenReady().then(async () => {
try {
  electron.app.focus({steal: true});
  const context = {electron, repository, userData};
  if (focused) {
    await checkRepositoryImport(context);
    await checkGuide(context);
  } else {
    await checkGuideLoading(context);
    await checkRepositoryImport(context);
    await checkGuideFrame(context);
    await checkGuide(context);
    await checkGuideRemote(context);
    await checkGuideAdd(context);
  }
  const result = {ok: true, platform: process.platform, arch: process.arch, evidence: userData,
    checks: focused ? ['open-folder-and-repository-import', 'create-guide-project-path-preview-separator']
      : ['compact-default-windows', 'official-native-chrome-and-glass', 'sidebar-pointer-and-keyboard-resize',
        'separate-persisted-widths-and-migration', 'transparent-divider-hover-and-drag', 'compact-navigation-and-form-scroll',
        'equal-content-insets-and-spaced-scrollbar-gutter', 'compact-footers-and-zero-bottom-padding', 'compact-create-title-hidden',
        'consistent-resource-and-browse-buttons', 'stable-scrollbar-layout', 'scrollbar-show-on-scroll-and-idle-fade',
        'loading-at-action-location-and-real-creation-phases', 'loading-stable-layout-picker-cancellation-and-failure-recovery',
        'guide-creation-and-retry', 'resource-menus-modals-and-authentication', 'english-chinese-light-dark', 'open-folder-and-repository-import']};
  writeFileSync(join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {console.error(error); process.exitCode = 1}
finally {
  try {await cancelGuideCreations()} catch (error) {console.error(error); process.exitCode = 1}
  electron.app.exit(process.exitCode ?? 0);
}
});
