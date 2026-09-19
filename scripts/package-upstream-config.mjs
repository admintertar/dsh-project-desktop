import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {desktopSource} from '../src/desktop-adapter/paths.mjs';

export const officialPackageBuild = JSON.parse(readFileSync(join(desktopSource, 'package.json'), 'utf8')).build;
export const packagedMacRuntime = 'Contents/Resources/app/.cache/runtime/dsh-plugin-desktop';
// @electron/universal uses minimatch without dot:true. Name the Shell's hidden
// cache explicitly, then preserve the official native-module allowlist unchanged.
export const macUniversalArchFiles = packagedMacRuntime + '/' + officialPackageBuild.mac.x64ArchFiles;
