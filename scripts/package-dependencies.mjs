import {constants, cpSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';

/** Reuse the pinned official builder's production graph, hoisting and file filters.
 * The Shell keeps separate Desktop/Project roots because Profiles resolve them
 * independently; only collection inputs, never upstream manifests, are adapted.
 */
export async function copyProductionDependencies({manifest, modules, scratch, destination, platform = process.platform, flatCache = false}) {
  const {TraversalNodeModulesCollector} = desktopRequire('app-builder-lib/out/node-module-collector/traversalNodeModulesCollector.js');
  const {NodeModuleCopyHelper} = desktopRequire('app-builder-lib/out/util/NodeModuleCopyHelper.js');
  const {FileMatcher, excludedExts} = desktopRequire('app-builder-lib/out/fileMatcher.js');
  mkdirSync(scratch, {recursive: true});
  writeFileSync(join(scratch, 'package.json'), JSON.stringify(manifest));
  if (flatCache) {
    // Project's development cache has no node_modules parent. Materialize a
    // private collection input so transitive Node resolution remains standard.
    cpSync(modules, join(scratch, 'node_modules'), {recursive: true, dereference: true, mode: constants.COPYFILE_FICLONE});
  } else symlinkSync(realpathSync(modules), join(scratch, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const collector = new TraversalNodeModulesCollector(scratch);
  const {nodeModules} = await collector.getNodeModules({packageName: manifest.name});
  const packager = {appInfo: {type: 'module'}, config: {}, getWorkspaceRoot: async () => scratch};
  const excluded = ['.o', '.obj', '.pdb', ...excludedExts.split(',').map(ext => '.' + ext),
    ...(platform === 'win32' ? [] : ['.dll', '.exe'])];
  const summary = {packages: 0, files: 0, bytes: 0};
  async function copy(dependency, target) {
    const patterns = ['**/*'];
    // Same native build exclusions as official package.json. The generated
    // host binding must never shadow the paired Electron ABI prebuilds.
    if (['fs-ext', 'node-pty'].includes(dependency.name)) patterns.push(`!**/${dependency.name}/build/**`);
    const matcher = new FileMatcher(dependency.dir, target, value => value, patterns);
    const helper = new NodeModuleCopyHelper(matcher, packager);
    const files = await helper.collectNodeModules(dependency, excluded, relative(destination, target));
    for (const source of files) {
      const output = join(target, relative(dependency.dir, source));
      mkdirSync(dirname(output), {recursive: true});
      // Source link boundaries were audited by preparePackage. Materializing
      // selected files also removes absolute Windows junction references.
      cpSync(source, output, {dereference: true, mode: constants.COPYFILE_FICLONE});
      summary.files++; summary.bytes += statSync(output).size;
    }
    summary.packages++;
    for (const child of dependency.dependencies ?? []) await copy(child, join(target, 'node_modules', child.name));
  }
  for (const dependency of nodeModules) await copy(dependency, join(destination, dependency.name));
  // Preserve manifests and licenses through the official file filters.
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    JSON.parse(readFileSync(join(destination, name, 'package.json'), 'utf8'));
  }
  return summary;
}
