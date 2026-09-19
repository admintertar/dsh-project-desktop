import {constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repository, runtimePackage, desktopSource} from '../src/desktop-adapter/paths.mjs';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {verifyRuntimeDependencies} from '../src/desktop-adapter/stable/verify.mjs';
import {verifyUpstream} from './verify-upstream.mjs';

export const product = 'DSH Project Desktop';
export const appId = 'local.dsh.project.desktop';
export const copyOptions = {recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE};
export function isWithin(root, target) {
  const child = relative(resolve(root), resolve(target));
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith('..' + sep));
}

/** Check actual link destinations as well as link text, including chained links. */
export function auditLinks(directory, {allowAbsolute = false} = {}) {
  const root = realpathSync(directory);
  let links = 0;
  function visit(folder) {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isSymbolicLink()) {
        const target = readlinkSync(path);
        if ((!allowAbsolute && isAbsolute(target)) || !existsSync(path)
          || !isWithin(directory, resolve(dirname(path), target)) || !isWithin(root, realpathSync(path))) {
          throw new Error('Non-relocatable packaged link: ' + relative(directory, path));
        }
        links++;
      }
    }
  }
  visit(directory);
  return links;
}

export function preparePackage(platform, arch) {
  if (platform !== process.platform || arch !== process.arch) throw new Error('Packages must be built on the target platform and architecture');
  verifyUpstream(); verifyRuntimeDependencies();
  const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
  const electronRoot = dirname(desktopRequire.resolve('electron/package.json'));
  const electronVersion = JSON.parse(readFileSync(join(electronRoot, 'package.json'), 'utf8')).version;
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repository, encoding: 'utf8'}).trim();
  const sourceHasLocalChanges = Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: repository, encoding: 'utf8'}).trim());
  mkdirSync(join(repository, '.cache'), {recursive: true});
  const staging = mkdtempSync(join(repository, '.cache/package-'));
  const appDirectory = join(staging, 'app'); mkdirSync(appDirectory);
  const payload = join(staging, 'payload'); mkdirSync(payload);
  for (const name of ['src', 'dist', 'assets', 'upstream.lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
    cpSync(join(repository, name), join(appDirectory, name), copyOptions);
  }
  mkdirSync(join(appDirectory, 'scripts'));
  cpSync(join(repository, 'scripts/install-check.mjs'), join(appDirectory, 'scripts/install-check.mjs'));
  mkdirSync(join(appDirectory, 'THIRD_PARTY_LICENSES'));
  cpSync(join(repository, '.upstream/harness-guide/LICENSE'), join(appDirectory, 'THIRD_PARTY_LICENSES/Harness.txt'));
  mkdirSync(join(appDirectory, '.upstream/desktop/dsh-plugin-desktop'), {recursive: true});
  cpSync(join(desktopSource, 'package.json'), join(appDirectory, '.upstream/desktop/dsh-plugin-desktop/package.json'));
  writeFileSync(join(appDirectory, 'package.json'), JSON.stringify({name: manifest.name, version: manifest.version,
    description: manifest.description, author: 'DSH Project Desktop contributors', type: 'module', main: manifest.main,
    private: true, license: manifest.license, dependencies: manifest.dependencies}, null, 2));
  mkdirSync(join(appDirectory, 'node_modules'));
  cpSync(join(repository, 'node_modules/yaml'), join(appDirectory, 'node_modules/yaml'), copyOptions);
  for (const name of ['runtime', 'project-dependencies']) {
    const source = join(repository, '.cache', name);
    // Windows junctions contain absolute paths. Validate them, then materialize
    // their contents so installed packages never link back to a CI checkout.
    auditLinks(source, {allowAbsolute: platform === 'win32'});
    cpSync(source, join(payload, name), {...copyOptions,
      ...(platform === 'win32' ? {verbatimSymlinks: false, dereference: true} : {}),
      filter: path => path !== join(runtimePackage, 'node_modules/electron/dist') && path !== join(runtimePackage, 'node_modules/.cache')});
  }
  const links = auditLinks(payload);
  const target = `${platform === 'darwin' ? 'mac' : 'win'}-${arch}`;
  const output = join(repository, 'release', `${manifest.version}-${target}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
  mkdirSync(output, {recursive: true});
  const config = {
    appId, productName: product, electronVersion, electronDist: join(electronRoot, 'dist'),
    directories: {app: appDirectory, output}, asar: false, npmRebuild: false, nodeGypRebuild: false,
    files: ['src/**/*.mjs', 'scripts/install-check.mjs', 'dist/**/*', 'assets/**/*', 'upstream.lock.json',
      'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES/*', '.upstream/desktop/dsh-plugin-desktop/package.json'],
    extraResources: [{from: payload, to: 'app/.cache', filter: ['**/*', '**/.*']}],
  };
  return {manifest, electronVersion, sourceCommit, sourceHasLocalChanges, staging, appDirectory, output, links, config, platform, arch};
}

export function checksum(file) {
  const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
  writeFileSync(file + '.sha256', `${sha256}  ${basename(file)}\n`);
  return sha256;
}

export function recordPackage(prepared, details) {
  const {output, electronVersion, sourceCommit, sourceHasLocalChanges, links, platform, arch} = prepared;
  const result = {platform, arch, electronVersion, sourceCommit, sourceHasLocalChanges, links, ...details};
  writeFileSync(join(output, 'package-result.json'), JSON.stringify(result, null, 2) + '\n');
  mkdirSync(join(repository, '.local'), {recursive: true});
  writeFileSync(join(repository, '.local/last-package.json'), JSON.stringify(result, null, 2) + '\n');
  verifyUpstream(); console.log(JSON.stringify(result, null, 2));
  return result;
}
