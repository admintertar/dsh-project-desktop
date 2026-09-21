import {delimiter} from 'node:path';

/**
 * Environment for the GUI Electron child of a smoke check.
 *
 * The smoke checks launch a real Electron application, and every launcher used
 * to forward its own environment wholesale. When the check itself is started by
 * a package manager that leaks its launcher into the environment, the GUI child
 * inherits it: Yarn prepends its temporary bin folder to PATH and points
 * npm_execpath/npm_node_execpath at wrapper scripts living there. On Windows
 * those wrappers are .cmd files, so any Node descendant that resolves "node"
 * through PATH gets a batch script instead of an executable.
 *
 * Only the package-manager launcher is removed. Ordinary npm_package_* and
 * npm_lifecycle_* values stay, because they describe the package rather than
 * the tool that started it.
 */
export function smokeEnvironment(extra = {}) {
  const env = {...process.env, ...extra};
  const berryBin = env.BERRY_BIN_FOLDER;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.BERRY_BIN_FOLDER;
  delete env.npm_execpath;
  delete env.npm_node_execpath;
  if (berryBin && env.PATH) {
    env.PATH = env.PATH.split(delimiter).filter(entry => entry && entry !== berryBin).join(delimiter);
  }
  return env;
}
