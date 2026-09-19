import {constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {repository, lock, desktopSource, projectSource, runtimePackage} from '../src/desktop-adapter/paths.mjs';
import {verifyUpstream} from './verify-upstream.mjs';
import {setupGuideSources} from './setup-guide-sources.mjs';

const {values} = parseArgs({options: {'desktop-source': {type: 'string'}, 'project-source': {type: 'string'},
  'desktop-dependencies': {type: 'string'}, 'project-dependencies': {type: 'string'}, 'harness-source': {type: 'string'}}});
for (const key of ['desktop-source', 'project-source', 'desktop-dependencies', 'project-dependencies']) {
  if (!values[key]) throw new Error(`Provide --${key}; this initial offline bootstrap imports existing stable dependency caches`);
}

function snapshot(source, commit, destination, paths = []) {
  if (existsSync(destination)) return;
  const repo = resolve(source);
  const resolved = execFileSync('git', ['-C', repo, 'rev-parse', `${commit}^{commit}`], {encoding: 'utf8'}).trim();
  if (resolved !== commit) throw new Error('Commit pin did not resolve exactly');
  mkdirSync(destination, {recursive: true});
  // Read committed objects only: working-tree changes and fork commits never enter the snapshot.
  const archive = execFileSync('git', ['-C', repo, 'archive', '--format=tar', commit, ...paths], {maxBuffer: 256 * 1024 * 1024});
  execFileSync('tar', ['-xf', '-', '-C', destination], {input: archive});
}
snapshot(values['desktop-source'], lock.desktop.commit, dirname(desktopSource), [
  'dsh-plugin-desktop', `vendor/dsh-runtime/${lock.harness.version}`, 'upstream.json', 'LICENSE',
]);
snapshot(values['project-source'], lock.project.commit, projectSource);
setupGuideSources(values['harness-source']);
verifyUpstream();

const modules = resolve(values['desktop-dependencies']);
const installed = JSON.parse(readFileSync(join(modules, '@deepseek-ai/dsh/package.json'), 'utf8'));
if (installed.version !== lock.harness.version) throw new Error('The supplied dependency cache is not the pinned stable Harness');
mkdirSync(runtimePackage, {recursive: true});
const copyOptions = {recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE};
if (!existsSync(join(runtimePackage, 'node_modules'))) {
  cpSync(modules, join(runtimePackage, 'node_modules'), {...copyOptions,
    // This is a workspace link, not an npm dependency. The prototype disables the market.
    filter: path => path !== join(modules, 'dsh-community-market')});
}
const projectModules = join(repository, '.cache/project-dependencies');
const pluginCache = resolve(values['project-dependencies']);
if (!existsSync(projectModules)) cpSync(pluginCache, projectModules, {...copyOptions, filter: path => {
  const first = relative(pluginCache, path).split(sep)[0];
  return first !== '@deepseek-ai' && first !== '.bin' && !first.startsWith('.@');
}});
// Cached npm bin links must remain inside the copied cache, even on an older bootstrap.
function rehomeLinks(directory, from, to) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) rehomeLinks(path, from, to);
    else if (entry.isSymbolicLink()) {
      const ownedRelative = relative(to, path);
      if (to === projectModules && (ownedRelative === '@deepseek-ai' || ownedRelative.startsWith('.@') || ownedRelative === join('.bin', 'cordis'))) {
        // Discard copied npm aliases only; the originals and their targets remain untouched.
        unlinkSync(path); continue;
      }
      const target = resolve(dirname(path), readlinkSync(path));
      if (target.startsWith(from + sep)) {
        const type = statSync(path).isDirectory() ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file';
        const destination = join(to, relative(from, target));
        unlinkSync(path);
        symlinkSync(type === 'junction' ? destination : relative(dirname(path), destination), path, type);
      } else if (!target.startsWith(to + sep)) throw new Error(`Dependency cache has an external link: ${path}`);
    }
  }
}
rehomeLinks(join(runtimePackage, 'node_modules'), modules, join(runtimePackage, 'node_modules'));
rehomeLinks(projectModules, resolve(values['project-dependencies']), projectModules);
mkdirSync(join(repository, '.local'), {recursive: true});
writeFileSync(join(repository, '.local/bootstrap.json'), JSON.stringify({
  channel: 'stable', desktop: lock.desktop.commit, project: lock.project.commit,
  dependencies: installed.version, method: 'offline-cache-copy',
}, null, 2) + '\n');
console.log('Pinned sources verified; stable dependency caches copied locally. No upstream lib or fork source was imported.');
