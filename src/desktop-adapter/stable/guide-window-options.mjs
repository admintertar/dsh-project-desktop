import {loadDesktop} from './modules.mjs';

/** The same native chrome/material as project windows, without requiring a project Host. */
export async function guideWindowOptions(electron, {mode, title, iconPath, preload}) {
  const {advancedWindowOptions} = await loadDesktop('window-options');
  const {effectiveDesktopWindowMaterial} = await loadDesktop('window-material');
  const platform = process.platform;
  const material = effectiveDesktopWindowMaterial('advanced', platform, 'transparent');
  const size = mode === 'create' ? {width: 980, height: 720} : {width: 900, height: 640};
  const spec = {...size, minWidth: 420, minHeight: 460, mode: 'advanced', windowTitle: title, material};
  const icon = iconPath ? electron.nativeImage.createFromPath(iconPath) : electron.nativeImage.createEmpty();
  const options = platform === 'linux'
    ? {...size, minWidth: 420, minHeight: 460, show: false, icon,
      webPreferences: {preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true}}
    : advancedWindowOptions(spec, icon, platform, preload);
  return {options: {...options, title}, chrome: {platform, material}};
}
