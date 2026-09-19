// Manifest parsing stays compiled from the pinned Project plugin; creation orchestration is Shell-owned.
import {existsSync, mkdirSync, renameSync, writeFileSync} from 'node:fs';
import {basename, dirname} from 'node:path';
import {RecentProjects as PluginRecentProjects} from '../../dist/project-files.mjs';
import {createProjectFromPlan} from './project-bootstrap.mjs';
export {createProjectFromPlan};
export {findProjectFile, resolveProjectFile} from '../../dist/project-files.mjs';
import {findProjectFile} from '../../dist/project-files.mjs';

/** New projects use the same repository bootstrap as the composition wizard. */
export async function createProjectInDirectory(directory) {
  const existing = findProjectFile(directory);
  return existing ?? createProjectFromPlan({rootDirectory: directory, name: basename(directory), templateId: 'empty', allowExistingRoot: true});
}

/** Preserve corrupt history for diagnosis; it must not prevent opening the application. */
export class RecentProjects {
  constructor(file) {this.file = file; this.history = new PluginRecentProjects(file); this.list()}
  list() {
    try {return this.history.list()}
    catch (error) {
      if (!existsSync(this.file)) throw error;
      renameSync(this.file, `${this.file}.unreadable-${Date.now()}`);
      this.warning = 'history-unreadable';
      return [];
    }
  }
  remember(project) {this.list(); this.history.remember(project)}
  /** Remove only the launcher history entry; project files and running windows are untouched. */
  remove(path) {
    const current = this.list();
    const next = current.filter(project => project.path !== path);
    if (next.length === current.length) return false;
    mkdirSync(dirname(this.file), {recursive: true, mode: 0o700});
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', {mode: 0o600});
    renameSync(temporary, this.file);
    return true;
  }
}
