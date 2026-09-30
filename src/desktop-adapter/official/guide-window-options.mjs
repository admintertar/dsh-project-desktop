import {officialWindowOptions} from './project-window.mjs';

/** 欢迎/创建由 Shell 管理，原生外观沿用固定官方窗口参数。 */
export async function guideWindowOptions(electron, {mode, title, iconPath, preload}) {
  const size = mode === 'create' ? {width: 980, height: 720} : {width: 900, height: 640};
  return {options: {...officialWindowOptions(electron, {preload, title, primary: false}), ...size,
    minWidth: 420, minHeight: 460, ...(iconPath ? {icon: electron.nativeImage.createFromPath(iconPath)} : {})},
  chrome: {platform: process.platform, material: process.platform === 'darwin' ? 'vibrancy' : 'off'}};
}
