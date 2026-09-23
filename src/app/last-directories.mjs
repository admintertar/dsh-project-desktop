import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';

// `import`: the welcome window's repository import. `resource`: every local directory
// picked inside a running project (resources, resource relocation, skill import).
const keys = new Set(['import', 'resource']);
const validPath = value => typeof value === 'string' && value.length > 0 && value.length <= 8000;

/**
 * The last directory each guided flow used. Every entry is re-validated on read, so a
 * moved or deleted folder never reopens a chooser somewhere the user cannot use.
 */
export class LastDirectories {
  constructor(file) {this.file = file}
  read() {
    if (!existsSync(this.file)) return {version: 1, paths: {}};
    let value;
    try {
      value = JSON.parse(readFileSync(this.file, 'utf8'));
      if (value?.version !== 1 || !value.paths || typeof value.paths !== 'object' || Array.isArray(value.paths)
        || Object.entries(value.paths).some(([key, path]) => !keys.has(key) || !validPath(path))) throw new Error('Invalid last directories');
    } catch {
      // Preserve unreadable preferences for diagnosis; they must never block a window.
      renameSync(this.file, `${this.file}.unreadable-${Date.now()}`);
      return {version: 1, paths: {}};
    }
    return value;
  }
  /** Only a directory that still exists is worth reopening next time. */
  directory(key) {
    const path = this.read().paths[key];
    if (!path) return undefined;
    try {return statSync(path).isDirectory() ? path : undefined;} catch {return undefined;}
  }
  remember(key, path) {
    if (!keys.has(key) || !validPath(path)) return;
    try {if (!statSync(path).isDirectory()) return;} catch {return;}
    const value = this.read();
    if (value.paths[key] === path) return;
    value.paths[key] = path;
    mkdirSync(dirname(this.file), {recursive: true, mode: 0o700});
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value) + '\n', {mode: 0o600});
    renameSync(temporary, this.file);
  }
}

/**
 * Ask for one directory and remember the answer. The remembered choice is only the
 * chooser's starting point, and it is replaced only after the user really picks one.
 */
export async function pickRememberedDirectory(state, key, open) {
  const picked = await open(state.directory(key));
  if (typeof picked === 'string' && picked.length > 0) state.remember(key, picked);
  return picked;
}
