import {rm} from 'node:fs/promises';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse, stringify} from 'yaml';
import {createProjectFile, findProjectFile} from '../../dist/project-files.mjs';
import {runProjectGit} from './project-git.mjs';
import {validResourceUrl, validResourceBranch} from '../shared/remote-resource.mjs';
import {defaultResourceTarget, resourceTargetsOverlap, validResourceTarget} from '../shared/resource-draft.mjs';
import {PROJECT_TEMPLATES} from '../shared/project-templates.mjs';
export {PROJECT_TEMPLATES} from '../shared/project-templates.mjs';

const creatingRoots = new Set();
export function assertProjectCreationReady(manifestPath) {
  if (creatingRoots.has(realpathSync(dirname(manifestPath)))) throw new Error('Project creation is still in progress');
}

const DEFAULT_AGENT = `# Project instructions\n\nThis file contains project-level instructions for the Agent.\n`;
const RESOURCE_AGENT = role => `# Resource instructions\n\nThis resource is managed as an independent Git repository.\nResource role: ${role}.\n`;

function text(value, label, max = 160) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const result = value.trim();
  if (!result || result.length > max || /[\u0000-\u001f\u007f]/u.test(result)) throw new Error(`${label} is invalid`);
  return result;
}

function segment(value, label) {
  const result = text(value, label);
  if (result === '.' || result === '..' || result.endsWith('.agent-project') || result.includes('/') || result.includes('\\')) {
    throw new Error(`${label} must be a single directory name`);
  }
  return result;
}

/** Resolve existing ancestors without creating directories before the plan is validated. */
function projectLocation(path) {
  let ancestor = resolve(path);
  const missing = [];
  while (true) {
    try {
      const canonical = realpathSync(ancestor);
      if (!statSync(canonical).isDirectory()) throw new Error('Project location must be a directory');
      return join(canonical, ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw error;
      missing.push(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
}

function relativePath(value, label) {
  const result = text(value, label, 8000).replaceAll('\\', '/');
  if (!validResourceTarget(result)) throw new Error(`${label} is outside the project`);
  if (isAbsolute(result)) throw new Error(`${label} must be relative`);
  const parts = result.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw new Error(`${label} is outside the project`);
  }
  if (['.agent-project', 'memory', 'tasks', 'skills', 'mcp'].includes(parts[0].toLowerCase())) {
    throw new Error(`${label} uses a reserved project path`);
  }
  return parts.join('/');
}

function idFor(projectName, id, index) {
  const source = id ?? `resource-${index + 1}`;
  const prefix = source.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || `resource-${index + 1}`;
  return prefix.slice(0, 63);
}

function templateResources(templateId, projectName) {
  const template = PROJECT_TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown project template: ${templateId}`);
  return template.map(item => ({
    id: idFor(projectName, item.id, 0),
    name: `${projectName}-${item.role}`,
    path: defaultResourceTarget(`${projectName}-${item.role}`),
    mode: 'empty',
    role: item.role,
  }));
}

function normalizeResources(plan, projectName) {
  const source = Array.isArray(plan.resources) ? plan.resources : templateResources(plan.templateId ?? 'empty', projectName);
  const ids = new Set(['root']);
  const resources = source.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Resource ${index + 1} is invalid`);
    const role = segment(item.role ?? item.id ?? `resource-${index + 1}`, `Resource ${index + 1} role`);
    const id = idFor(projectName, item.id ?? role, index);
    if (ids.has(id)) throw new Error(`Duplicate resource: ${id}`);
    ids.add(id);
    const name = text(item.name ?? `${projectName}-${role}`, `Resource ${index + 1} name`);
    const mode = item.mode ?? 'empty';
    if (mode !== 'empty' && mode !== 'link' && mode !== 'remote') throw new Error(`Resource ${name} has an unsupported source`);
    if (mode === 'empty') return {id, name, role, mode, path: relativePath(item.path ?? defaultResourceTarget(name), `Resource ${name} path`)};
    if (mode === 'remote') {
      const url = text(item.url, `Resource ${name} URL`, 4096);
      if (!validResourceUrl(url)) throw new Error(`Resource ${name} URL is invalid`);
      const branch = typeof item.branch === 'string' ? item.branch.trim() : item.branch ?? '';
      if (!validResourceBranch(branch)) throw new Error(`Resource ${name} branch is invalid`);
      return {id, name, role, mode, url, branch, path: relativePath(item.path ?? defaultResourceTarget(name), `Resource ${name} path`)};
    }
    if (typeof item.path !== 'string' || !item.path.trim()) throw new Error(`Resource ${name} needs a directory`);
    if (item.type !== undefined && !['local', 'git'].includes(item.type)) throw new Error('resource-config-invalid');
    // A Git working tree without an origin remote is a valid link; a claimed URL still has to be safe.
    if (item.type === 'git' && item.url && !validResourceUrl(item.url)) throw new Error('resource-url-invalid');
    return {id, name, role, mode, path: item.path, type: item.type, url: item.type === 'git' && item.url ? item.url : undefined};
  });
  const targets = resources.filter(item => item.mode !== 'link');
  if (targets.some((item, index) => targets.slice(0, index).some(previous => resourceTargetsOverlap(previous.path, item.path)))) {
    throw new Error('target-exists');
  }
  return resources;
}

function appendIgnore(root, entries) {
  const file = join(root, '.gitignore');
  let current = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const additions = entries.filter(entry => !current.split(/\r?\n/u).includes(entry));
  if (!additions.length) return;
  if (current && !current.endsWith('\n')) current += '\n';
  writeFileSync(file, current + additions.join('\n') + '\n', {mode: 0o644});
}

function writeExclusive(path, content, mode = 0o644) {
  writeFileSync(path, content, {flag: 'wx', mode});
}

function writeAtomic(path, content, mode = 0o600) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, {mode});
    renameSync(temporary, path);
  } finally {
    try {rmSync(temporary, {force: true});} catch { /* Preserve the original error. */ }
  }
}

async function inspectGitRoot(path, runGit, signal) {
  try {
    // Windows Git prints long paths while TEMP may use an 8.3 alias. Native
    // realpath resolves both to the same filesystem identity.
    const root = realpathSync.native(await runGit(['rev-parse', '--show-toplevel'], path));
    return root === realpathSync.native(path);
  } catch {
    signal?.throwIfAborted();
    return false;
  }
}

function externalBinding(root, path) {
  const canonical = realpathSync(path);
  const child = relative(root, canonical);
  if (child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)) {
    return {path: child.split(sep).join('/')};
  }
  return {binding: canonical};
}

function localBindingsFile(root, bindings) {
  if (!Object.keys(bindings).length) return;
  const metadata = join(root, '.agent-project');
  mkdirSync(metadata, {recursive: true, mode: 0o700});
  writeExclusive(join(metadata, 'local.yaml'), stringify({resources: bindings}), 0o600);
  appendIgnore(metadata, ['/local.yaml', '/task-sources.yaml', '/resource-transaction.json']);
}

/**
 * Create a project workspace and its independent resource repositories.
 * Existing projects are returned unchanged so a failed Host startup can retry safely.
 */
export async function createProjectFromPlan(plan, options = {}) {
  const {signal} = options;
  signal?.throwIfAborted();
  if (!plan || typeof plan !== 'object') throw new Error('Project creation plan is invalid');
  const name = segment(plan.name, 'Project name');
  const directRoot = plan.rootDirectory !== undefined;
  const requestedLocation = text(plan.location ?? plan.rootDirectory, 'Project location', 8000);
  const location = directRoot ? realpathSync(requestedLocation) : projectLocation(requestedLocation);
  if (directRoot && !statSync(location).isDirectory()) throw new Error('Project location must be a directory');
  const root = directRoot ? location : join(location, name);
  if (creatingRoots.has(root)) throw new Error('Project creation is still in progress');
  const existing = existsSync(root) && statSync(root).isDirectory() ? findProjectFile(root) : undefined;
  if (existing) return existing;
  if (existsSync(root)) {
    // The guide localizes this stable code; never surface a raw absolute path as the prompt.
    if (!directRoot || (!plan.allowExistingRoot && readdirSync(root).length)) throw new Error('project-target-exists');
  }

  const git = options.runGit ?? plan.runGit ?? runProjectGit;
  const runGit = async (args, cwd) => {
    signal?.throwIfAborted();
    const result = await git(args, cwd, {signal});
    signal?.throwIfAborted();
    return result;
  };
  const resources = normalizeResources(plan, name);
  const created = [];
  let ownsRoot = false;
  const bindings = {};
  let manifest;
  creatingRoots.add(root);
  try {
    // Parent directories may be shared by concurrent projects. Rollback owns only the project root.
    if (!directRoot) mkdirSync(location, {recursive: true, mode: 0o755});
    if (!existsSync(root)) {mkdirSync(root, {mode: 0o755}); ownsRoot = true; created.push(root);}
    manifest = createProjectFile(join(root, `${name}.agent-project`));
    if (!existsSync(join(root, 'AGENT.md'))) writeExclusive(join(root, 'AGENT.md'), DEFAULT_AGENT);
    if (!existsSync(join(root, '.git'))) await runGit(['init', '--quiet'], root);
    const definition = parse(readFileSync(manifest, 'utf8'));
    definition.name = name;
    definition.resources = [{id: 'root', name, type: 'local', path: '.'}];

    for (const item of resources) {
      if (item.mode === 'empty' || item.mode === 'remote') {
        const target = resolve(root, item.path);
        const targetRelative = relative(root, target);
        if (!targetRelative || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) throw new Error(`Resource ${item.name} is outside the project`);
        if (existsSync(target)) throw new Error(`Resource target already exists: ${target}`);
        created.push(target);
        if (item.mode === 'remote') {
          if (options.installRemote) await options.installRemote(item, target, signal);
          else await runGit(['-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', 'clone', '--quiet',
              ...(item.branch ? ['--branch', item.branch] : []), '--', item.url, target], root);
          if (!await inspectGitRoot(target, runGit, signal) || await runGit(['remote', 'get-url', 'origin'], target) !== item.url) {
            throw new Error(`Resource ${item.name} clone is invalid`);
          }
          if (item.branch && await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], target) !== item.branch) {
            throw new Error(`Resource ${item.name} branch does not match`);
          }
        } else {
          mkdirSync(target, {recursive: true, mode: 0o755});
          writeExclusive(join(target, 'AGENT.md'), RESOURCE_AGENT(item.role));
          await runGit(['init', '--quiet'], target);
        }
        const relativeTarget = targetRelative.split(sep).join('/');
        appendIgnore(root, [`/${relativeTarget}/`]);
        definition.resources.push({id: item.id, name: item.name, type: 'git', path: relativeTarget,
          ...(item.mode === 'remote' ? {url: item.url, ...(item.branch ? {branch: item.branch} : {})} : {})});
      } else {
        const linked = realpathSync(text(item.path, `Resource ${item.name} directory`, 8000));
        if (!statSync(linked).isDirectory()) throw new Error(`Resource ${item.name} must be a directory`);
        const locationInfo = externalBinding(root, linked);
        const gitRoot = await inspectGitRoot(linked, runGit, signal);
        const type = item.type ?? (gitRoot ? 'git' : 'local');
        // An explicit Git link must be a working-tree root, and a claimed URL must still match its origin.
        if (type === 'git' && item.type !== undefined
          && (!gitRoot || (item.url && await runGit(['remote', 'get-url', 'origin'], linked) !== item.url))) {
          throw new Error('resource-git-invalid');
        }
        const resource = {id: item.id, name: item.name, type};
        if (type === 'git' && item.url) resource.url = item.url;
        if (locationInfo.path) resource.path = locationInfo.path;
        else bindings[item.id] = locationInfo.binding;
        definition.resources.push(resource);
      }
    }

    signal?.throwIfAborted();
    appendIgnore(root, ['/.agent-project/local.yaml']);
    localBindingsFile(root, bindings);
    writeAtomic(manifest, stringify(definition), 0o600);
    return manifest;
  } catch (error) {
    if (ownsRoot) await rm(root, {recursive: true, force: true});
    else for (const path of created.slice().reverse()) {if (path !== root) await rm(path, {recursive: true, force: true});}
    throw error;
  } finally {creatingRoots.delete(root)}
}
