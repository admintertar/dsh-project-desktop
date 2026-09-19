import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';

export const repository = fileURLToPath(new URL('../../', import.meta.url));
export const lock = JSON.parse(readFileSync(join(repository, 'upstream.lock.json'), 'utf8'));
export const desktopSource = join(repository, '.upstream/desktop/dsh-plugin-desktop');
export const projectSource = join(repository, '.upstream/project');
export const runtimePackage = join(repository, '.cache/runtime/dsh-plugin-desktop');
export const projectPackage = join(repository, '.cache/runtime/dsh-plugin-project');
