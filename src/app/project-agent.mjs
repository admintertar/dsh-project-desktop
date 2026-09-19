import {existsSync, lstatSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {parse} from 'yaml';

const FILE_LIMIT = 64 * 1024;
const TOTAL_LIMIT = 128 * 1024;

function readBounded(path) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > FILE_LIMIT) return undefined;
    const content = readFileSync(path, 'utf8');
    return Buffer.byteLength(content) <= FILE_LIMIT ? content : undefined;
  } catch { return undefined; }
}

function resourcePaths(manifestPath) {
  const manifest = realpathSync(manifestPath);
  const root = dirname(manifest);
  const definition = parse(readFileSync(manifest, 'utf8')) ?? {};
  const bindingsPath = join(root, '.agent-project', 'local.yaml');
  let bindings = {};
  if (existsSync(bindingsPath)) bindings = parse(readFileSync(bindingsPath, 'utf8'))?.resources ?? {};
  const resources = Array.isArray(definition.resources) ? definition.resources : [];
  return [{id: 'root', name: definition.name ?? 'Project', path: root}, ...resources
    .filter(item => item && item.id !== 'root')
    .map(item => {
      const configured = bindings[item.id] ?? item.path;
      if (typeof configured !== 'string' || !configured) return {id: item.id, name: item.name ?? item.id};
      return {id: item.id, name: item.name ?? item.id, path: resolve(root, configured)};
    })];
}

/** Read project and resource AGENT.md files as bounded, project-scoped prompt context. */
export function readProjectAgentInstructions(manifestPath) {
  const sections = [];
  let bytes = 0;
  for (const resource of resourcePaths(manifestPath)) {
    if (!resource.path) continue;
    let directory;
    try {directory = realpathSync(resource.path); if (!statSync(directory).isDirectory()) continue;} catch {continue;}
    const path = join(directory, 'AGENT.md');
    const content = readBounded(path);
    if (content === undefined) continue;
    const nextBytes = bytes + Buffer.byteLength(content);
    if (nextBytes > TOTAL_LIMIT) break;
    bytes = nextBytes;
    sections.push(`--- ${resource.id} (${resource.name}) · ${path} ---\n${content.trimEnd()}`);
  }
  return sections.length ? `Project and resource instructions:\n\n${sections.join('\n\n')}` : '';
}
