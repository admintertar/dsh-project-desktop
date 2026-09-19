import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

/** Paths belong to this app, never the original Desktop's data directories. */
export function projectStatePath(appData, manifestPath, {allowMissing = false} = {}) {
  let canonical;
  try {canonical = realpathSync(manifestPath)} catch (error) {
    if (!allowMissing || error.code !== 'ENOENT') throw error;
    canonical = resolve(manifestPath);
  }
  const id = createHash('sha256').update(canonical).digest('hex');
  return {manifestPath: canonical, stateDirectory: join(resolve(appData), 'projects', id)};
}

export function claimProjectState(stateDirectory, manifestPath) {
  const canonical = realpathSync(manifestPath);
  if (lstatSync(stateDirectory, {throwIfNoEntry: false})?.isSymbolicLink()) throw new Error('Project state cannot be a symlink');
  const marker = join(stateDirectory, 'project-desktop.json');
  if (existsSync(marker)) {
    const current = JSON.parse(readFileSync(marker, 'utf8'));
    if (current.schemaVersion !== 1 || current.manifestPath !== canonical) throw new Error('Project state belongs to another project');
    return;
  }
  if (existsSync(join(stateDirectory, 'dsh'))) throw new Error('Refusing to adopt an unowned DSH Home');
  mkdirSync(stateDirectory, {recursive: true, mode: 0o700});
  writeFileSync(marker, JSON.stringify({schemaVersion: 1, manifestPath: canonical}) + '\n', {flag: 'wx', mode: 0o600});
}
