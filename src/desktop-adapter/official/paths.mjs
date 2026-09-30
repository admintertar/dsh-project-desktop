import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
import {existsSync, readFileSync} from 'node:fs';

export const repository = fileURLToPath(new URL('../../../', import.meta.url));
export const officialPin = JSON.parse(readFileSync(join(repository, 'official-source.lock.json'), 'utf8'));
const inputsFile = join(repository, '.cache/official-shell-inputs.json');
const inputs = existsSync(inputsFile) ? JSON.parse(readFileSync(inputsFile, 'utf8')) : {};
export const officialSource = resolve(process.env.DSH_OFFICIAL_SOURCE_DIR ?? inputs.officialSource ?? join(repository, '.upstream/official'));
const shippedProject = join(repository, '.cache/official-runtime', process.platform === 'darwin' ? `mac-${process.arch}` : `win-${process.arch}`, 'dsh/node_modules/dsh-plugin-project');
export const projectSource = resolve(process.env.DSH_PROJECT_PLUGIN_SOURCE ?? inputs.projectSource
  ?? (existsSync(join(shippedProject, 'package.json')) ? shippedProject : join(repository, '.upstream/project')));
export const runtimeDirectory = () => resolve(process.env.DSH_OFFICIAL_RUNTIME_DIR
  ?? join(repository, '.cache/official-runtime', process.platform === 'darwin' ? `mac-${process.arch}` : `win-${process.arch}`));
