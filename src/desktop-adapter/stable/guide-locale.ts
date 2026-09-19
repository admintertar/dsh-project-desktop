import {Context} from '@deepseek-ai/cordis';
import {LocaleRuntime} from '../../../.upstream/harness-guide/packages/client/locale/src/client/index.ts';
/** Pre-Host native guide uses the actual pinned locale registry without a Profile. */
export function createGuideLocale(dictionaries: Record<string, Record<string, string>>) {
  const locale = new LocaleRuntime(new Context());
  locale.register('project-desktop-guide', dictionaries);
  return locale;
}
