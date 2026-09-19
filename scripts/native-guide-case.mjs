import electron from 'electron';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {checkGuideFrame} from './native-guide-frame-checks.mjs';
import {checkGuide} from './native-guide-checks.mjs';
import {checkGuideRemote} from './native-guide-remote-checks.mjs';
import {checkGuideAdd} from './native-guide-add-checks.mjs';
import {cancelGuideCreations} from '../src/windows/guide-window.mjs';

if (electron.app.isPackaged || !process.env.DSH_PROJECT_DESKTOP_SMOKE_DATA) throw new Error('A dedicated guide test directory is required');
const userData = process.env.DSH_PROJECT_DESKTOP_SMOKE_DATA;
electron.app.setPath('userData', userData);
electron.app.on('window-all-closed', () => {});
void electron.app.whenReady().then(async () => {
try {
  electron.app.focus({steal: true});
  const context = {electron, repository, userData};
  await checkGuideFrame(context);
  await checkGuide(context);
  await checkGuideRemote(context);
  await checkGuideAdd(context);
  const result = {ok: true, platform: process.platform, arch: process.arch, evidence: userData,
    checks: ['compact-default-windows', 'official-native-chrome-and-glass', 'sidebar-pointer-and-keyboard-resize',
      'separate-persisted-widths-and-migration', 'transparent-divider-hover-and-drag', 'compact-navigation-and-form-scroll',
      'equal-content-insets-and-spaced-scrollbar-gutter', 'compact-footers-and-zero-bottom-padding', 'compact-create-title-hidden',
      'consistent-resource-and-browse-buttons', 'stable-scrollbar-layout', 'scrollbar-show-on-scroll-and-idle-fade',
      'guide-creation-and-retry', 'resource-menus-modals-and-authentication', 'english-chinese-light-dark']};
  writeFileSync(join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {console.error(error); process.exitCode = 1}
finally {
  try {await cancelGuideCreations()} catch (error) {console.error(error); process.exitCode = 1}
  electron.app.exit(process.exitCode ?? 0);
}
});
