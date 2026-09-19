import {constants, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repository, runtimePackage, desktopSource} from '../src/desktop-adapter/paths.mjs';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {verifyRuntimeDependencies} from '../src/desktop-adapter/stable/verify.mjs';
import {verifyUpstream} from './verify-upstream.mjs';
import {signMacApp} from './sign-macos.mjs';
import {verifyMacPackage} from './verify-mac-package.mjs';

if (process.platform !== 'darwin' || process.arch !== 'x64') throw new Error('This packaging baseline is validated on macOS x64 only');
verifyUpstream(); verifyRuntimeDependencies();
const manifest = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(desktopRequire.resolve('electron/package.json'), 'utf8')).version;
const product = 'DSH Project Desktop';
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repository, encoding: 'utf8'}).trim();
const sourceHasLocalChanges = Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: repository, encoding: 'utf8'}).trim());
mkdirSync(join(repository, '.cache'), {recursive: true});
const staging = mkdtempSync(join(repository, '.cache/package-'));
const appDirectory = join(staging, 'app'); mkdirSync(appDirectory);
const payload = join(staging, 'payload'); mkdirSync(payload);
const copy = {recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE};
for (const name of ['src', 'dist', 'assets', 'upstream.lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(join(repository, name), join(appDirectory, name), copy);
mkdirSync(join(appDirectory, 'scripts')); cpSync(join(repository, 'scripts/install-check.mjs'), join(appDirectory, 'scripts/install-check.mjs'));
mkdirSync(join(appDirectory, 'THIRD_PARTY_LICENSES'));
cpSync(join(repository, '.upstream/harness-guide/LICENSE'), join(appDirectory, 'THIRD_PARTY_LICENSES/Harness.txt'));
// Runtime verification needs the original dependency declaration, not the source checkout.
mkdirSync(join(appDirectory, '.upstream/desktop/dsh-plugin-desktop'), {recursive: true});
cpSync(join(desktopSource, 'package.json'), join(appDirectory, '.upstream/desktop/dsh-plugin-desktop/package.json'));
writeFileSync(join(appDirectory, 'package.json'), JSON.stringify({name: manifest.name, version: manifest.version,
  description: manifest.description, author: 'DSH Project Desktop contributors', type: 'module', main: manifest.main,
  private: true, license: manifest.license, dependencies: manifest.dependencies}, null, 2));
mkdirSync(join(appDirectory, 'node_modules')); cpSync(join(repository, 'node_modules/yaml'), join(appDirectory, 'node_modules/yaml'), copy);
for (const name of ['runtime', 'project-dependencies']) cpSync(join(repository, '.cache', name), join(payload, name), {...copy,
  filter: path => path !== join(runtimePackage, 'node_modules/electron/dist') && path !== join(runtimePackage, 'node_modules/.cache')});
function auditLinks(directory, root = directory) {
  let links = 0;
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) links += auditLinks(path, root);
    else if (entry.isSymbolicLink()) {
      const target = readlinkSync(path);
      if (target.startsWith('/') || !resolve(dirname(path), target).startsWith(root + sep) || !existsSync(path)) {
        throw new Error('Non-relocatable packaged link: ' + relative(root, path));
      }
      links++;
    }
  }
  return links;
}
const links = auditLinks(payload);
// Finder, Dock, windows and tray all use the same checked-in product artwork.
const icns = join(appDirectory, 'assets/app-icon.icns');
const output = join(repository, 'release', `${manifest.version}-mac-x64-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
mkdirSync(output, {recursive: true});
const {build, Platform, Arch} = desktopRequire('electron-builder');
await build({projectDir: appDirectory, targets: Platform.MAC.createTarget(['dir'], Arch.x64), publish: 'never', config: {
  appId: 'local.dsh.project.desktop', productName: product, electronVersion,
  electronDist: join(dirname(desktopRequire.resolve('electron/package.json')), 'dist'),
  directories: {app: appDirectory, output}, asar: false, npmRebuild: false, nodeGypRebuild: false,
  files: ['src/**/*.mjs', 'scripts/install-check.mjs', 'dist/**/*', 'assets/**/*', 'upstream.lock.json', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES/*', '.upstream/desktop/dsh-plugin-desktop/package.json'],
  extraResources: [{from: payload, to: 'app/.cache', filter: ['**/*', '**/.*']}],
  mac: {identity: null, icon: icns, category: 'public.app-category.developer-tools',
    extendInfo: {CFBundleLocalizations: ['en', 'zh_CN'], CFBundleDevelopmentRegion: 'en'},
    fileAssociations: [{ext: 'agent-project', name: 'Agent Project', role: 'Editor', rank: 'Alternate'}]},
}});
const app = join(output, 'mac', product + '.app');
if (!existsSync(app)) throw new Error('Packager did not produce the expected app');
const signed = await signMacApp(app, '-');
const validation = await verifyMacPackage(app);
const diskRoot = join(staging, 'disk'); mkdirSync(diskRoot);
cpSync(app, join(diskRoot, product + '.app'), copy);
execFileSync('ln', ['-s', '/Applications', join(diskRoot, 'Applications')]);
const dmg = join(output, `${product}-${manifest.version}-mac-x64-local.dmg`);
execFileSync('hdiutil', ['create', '-volname', product, '-srcfolder', diskRoot, '-ov', '-format', 'UDZO', dmg], {stdio: 'inherit'});
execFileSync('hdiutil', ['verify', dmg], {stdio: 'inherit'});
const sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex');
writeFileSync(dmg + '.sha256', `${sha256}  ${dmg.split('/').at(-1)}\n`);
const result = {app: realpathSync(app), dmg, sha256, electronVersion, links, signature: signed, validation, notarized: false,
  sourceCommit, sourceHasLocalChanges};
writeFileSync(join(output, 'package-result.json'), JSON.stringify(result, null, 2));
mkdirSync(join(repository, '.local'), {recursive: true}); writeFileSync(join(repository, '.local/last-package.json'), JSON.stringify(result, null, 2));
verifyUpstream(); console.log(JSON.stringify(result, null, 2));
