import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Resolve the same official package instances used by the running Host. */
export async function officialCredentials(runtimeDir) {
  const load = name => import(pathToFileURL(join(runtimeDir, 'dsh/node_modules/@deepseek-ai', name, 'lib/index.js')).href);
  const [cordis, local, atomic] = await Promise.all([load('cordis'), load('dsh-credentials-local'), load('dsh-atomic-write')]);
  return {...cordis, ...local, ...atomic};
}
