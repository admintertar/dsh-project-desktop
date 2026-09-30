import {constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {repository, runtimeDirectory, officialSource, officialPin, projectSource} from '../src/desktop-adapter/official/paths.mjs';
import {verifyOfficialSource} from './verify-official-source.mjs';
import {verifyOfficialRuntimePayload} from '../src/desktop-adapter/official/runtime-payload.mjs';
import {verifyProjectPlugin} from '../src/desktop-adapter/official/profile.mjs';
import {officialRuntimeTarget} from '../src/desktop-adapter/official/runtime-inputs.mjs';
import {copyProductionDependencies} from './package-dependencies.mjs';

export const product = 'DSH Project Desktop';
export const appId = 'local.dsh.project.desktop';
export const officialRequire = createRequire(join(officialSource, 'apps/desktop/package.json'));
export const copyOptions = {recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE};
export function isWithin(root, target) {
  const child = relative(resolve(root), resolve(target));
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep));
}
export function auditLinks(directory) {
  const root = realpathSync(directory); let links = 0;
  function visit(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (isAbsolute(target) || !existsSync(path) || !isWithin(root, realpathSync(path))) throw new Error('Non-relocatable packaged link: ' + relative(directory, path));
        links++;
      }
    }
  }
  visit(directory); return links;
}

/** Assemble only the self-contained official runtime and pinned Project production graph. */
export async function preparePackage(platform = process.platform, arch = process.arch) {
  if (platform !== process.platform || arch !== process.arch) throw new Error('Packages require the native target runner');
  if (process.env.DSH_PROJECT_PLUGIN_SOURCE) throw new Error('Unset DSH_PROJECT_PLUGIN_SOURCE before packaging');
  verifyOfficialSource(officialSource); verifyProjectPlugin(projectSource);
  const target = officialRuntimeTarget(platform, arch), runtime = runtimeDirectory();
  const inventory = verifyOfficialRuntimePayload(runtime, officialPin, target);
  const pin = JSON.parse(readFileSync(join(repository, 'project-source.lock.json'), 'utf8'));
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8'}).trim();
  if (git(projectSource, 'rev-parse', 'HEAD') !== pin.commit || git(projectSource, 'status', '--porcelain')) throw new Error('Project source differs from its release pin');
  const built = JSON.parse(readFileSync(join(repository, 'dist/build.json'), 'utf8'));
  if (built.projectLocalSource || built.sourceCommit !== officialPin.commit || built.projectCommit !== pin.commit) throw new Error('Rebuild release assets from fixed sources');
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  const electronVersion = JSON.parse(readFileSync(join(officialSource, 'apps/desktop/node_modules/electron/package.json'), 'utf8')).version;
  const sourceCommit = git(repository, 'rev-parse', 'HEAD');
  const sourceHasLocalChanges = Boolean(git(repository, 'status', '--porcelain', '--untracked-files=normal'));
  if (sourceHasLocalChanges) throw new Error('Release packaging requires a clean source checkout');
  const staging = mkdtempSync(join(repository, '.cache/package-'));
  const appDirectory = join(staging, 'app'); mkdirSync(appDirectory);
  for (const name of ['dist', 'assets', 'official-source.lock.json', 'project-source.lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(join(repository, name), join(appDirectory, name), copyOptions);
  // Keep only the active main-process import closure; historical adapters never ship.
  const graph = await build({entryPoints: [join(repository, 'src/app/main.mjs')], bundle: true, platform: 'node',
    format: 'esm', packages: 'external', write: false, metafile: true});
  for (const input of Object.keys(graph.metafile.inputs)) {
    const source = resolve(input), name = relative(repository, source);
    if (!name.startsWith('src' + sep) || !name.endsWith('.mjs')) continue;
    if (name.includes('desktop-adapter' + sep) && !name.includes('desktop-adapter' + sep + 'official' + sep)) throw new Error('Community module in release graph');
    mkdirSync(dirname(join(appDirectory, name)), {recursive: true}); cpSync(source, join(appDirectory, name));
  }
  // Host provider modules use URL-based imports and must preserve their relative locations.
  cpSync(join(repository, 'src/desktop-adapter/official'), join(appDirectory, 'src/desktop-adapter/official'), copyOptions);
  mkdirSync(join(appDirectory, 'scripts'));
  cpSync(join(repository, 'scripts/install-check.mjs'), join(appDirectory, 'scripts/install-check.mjs'));
  mkdirSync(join(appDirectory, 'THIRD_PARTY_LICENSES'));
  cpSync(join(officialSource, 'LICENSE'), join(appDirectory, 'THIRD_PARTY_LICENSES/Harness.txt'));
  writeFileSync(join(appDirectory, 'package.json'), JSON.stringify({name: manifest.name, version: manifest.version,
    description: manifest.description, author: 'DSH Project Desktop contributors', type: 'module', main: manifest.main,
    private: true, license: manifest.license, dependencies: manifest.dependencies}, null, 2));
  mkdirSync(join(appDirectory, 'node_modules'));
  cpSync(join(repository, 'node_modules/yaml'), join(appDirectory, 'node_modules/yaml'), {...copyOptions, dereference: true, verbatimSymlinks: false});
  const payload = join(staging, 'payload'); mkdirSync(payload);
  const packagedRuntime = join(payload, '.cache/official-runtime', target);
  cpSync(runtime, packagedRuntime, {...copyOptions, filter: path => path !== join(runtime, 'electron')});
  // The outer Electron app supplies the executable; all runtime resources stay intact.
  writeFileSync(join(packagedRuntime, 'source.json'), JSON.stringify({...inventory, kind: 'official-packaged-runtime',
    inventory: inventory.inventory.filter(file => !file.path.startsWith('electron/'))}, null, 2) + '\n');
  const plugin = join(packagedRuntime, 'dsh/node_modules/dsh-plugin-project'); mkdirSync(plugin);
  for (const name of ['package.json', 'lib', 'cordis.patch.yml', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(join(projectSource, name), join(plugin, name), copyOptions);
  const pluginManifest = JSON.parse(readFileSync(join(projectSource, 'package.json'), 'utf8'));
  // Peers resolve to the same official runtime, rather than another copied build workspace.
  const dependencies = await copyProductionDependencies({manifest: {name: pluginManifest.name, dependencies: pluginManifest.dependencies},
    modules: join(projectSource, 'node_modules'), scratch: join(staging, 'collect-project'), destination: join(plugin, 'node_modules'), platform});
  for (const name of Object.keys(pluginManifest.peerDependencies ?? {})) {
    if (!existsSync(join(packagedRuntime, 'dsh/node_modules', name))) throw new Error('Missing official Project peer: ' + name);
  }
  const links = auditLinks(payload);
  const output = join(repository, 'release', `${manifest.version}-${target}`); mkdirSync(output, {recursive: true});
  const config = {
    appId, productName: product, electronVersion, electronDist: join(runtime, 'electron'),
    directories: {app: appDirectory, output}, asar: false, npmRebuild: false, nodeGypRebuild: false,
    electronFuses: {runAsNode: true, onlyLoadAppFromAsar: false},
    files: ['src/**/*.mjs', 'scripts/install-check.mjs', 'dist/**/*', 'assets/**/*', '*-source.lock.json',
      'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES/*'],
    extraResources: [{from: payload, to: 'app', filter: ['**/*', '**/.*']}],
    fileAssociations: [{ext: 'agent-project', name: 'Agent Project', role: 'Editor'}],
  };
  return {manifest, electronVersion, sourceCommit, sourceHasLocalChanges, staging, appDirectory, output, links, config,
    platform, arch, target, dependencies, officialCommit: officialPin.commit, projectCommit: pin.commit};
}
export function checksum(file) {
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(file + '.sha256', `${sha256}  ${basename(file)}\n`); return sha256;
}
export function recordPackage(prepared, details) {
  const {output, electronVersion, sourceCommit, sourceHasLocalChanges, platform, arch, target, officialCommit, projectCommit, dependencies} = prepared;
  const result = {platform, arch, target, electronVersion, sourceCommit, sourceHasLocalChanges, officialCommit, projectCommit, dependencies, ...details};
  writeFileSync(join(output, 'package-result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2)); return result;
}
