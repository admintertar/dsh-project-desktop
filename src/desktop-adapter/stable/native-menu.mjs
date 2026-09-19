import {loadDesktop} from './modules.mjs';

const {macApplicationMenuTemplate} = await loadDesktop('native-menu');

/** Reuse the pinned native-menu.ts application group, including its additions
 * before Services. The Shell owns File/project commands and the active locale.
 */
export function macApplicationMenu(locale, product, additions = []) {
  return macApplicationMenuTemplate(product, locale === 'zh' ? 'zh-CN' : 'en', additions)[0];
}
