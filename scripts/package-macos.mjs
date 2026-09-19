import {cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {desktopSource} from '../src/desktop-adapter/paths.mjs';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {signMacApp} from './sign-macos.mjs';
import {verifyMacDmg} from './verify-mac-package.mjs';
import {checksum, preparePackage, product, recordPackage} from './package-common.mjs';

if (process.platform !== 'darwin' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Build macOS packages on a native x64 or arm64 Mac');
const {withoutMacReleaseSecrets} = await import(pathToFileURL(join(desktopSource, 'scripts/release-preflight.ts')).href);
const {electronBuilderEnvironment} = await import(pathToFileURL(join(desktopSource, 'scripts/electron-builder-environment.ts')).href);
const unsigned = electronBuilderEnvironment({...withoutMacReleaseSecrets(process.env), CSC_IDENTITY_AUTO_DISCOVERY: 'false'});
for (const name of Object.keys(process.env)) if (!(name in unsigned)) delete process.env[name];
Object.assign(process.env, unsigned);
const prepared = await preparePackage(process.platform, 'universal');
const {appDirectory, output, staging, manifest, config} = prepared;
const stagedDesktop = join(staging, 'payload/runtime/dsh-plugin-desktop');
const {prepareFsExtForElectron} = await import(pathToFileURL(join(desktopSource, 'scripts/prepare-fs-ext.ts')).href);
const {prepareInstalledMacUniversalRuntime, MACOS_UNIVERSAL_NATIVE_ENTRIES, FORBIDDEN_MACOS_UNIVERSAL_ENTRIES} =
  await import(pathToFileURL(join(desktopSource, 'scripts/mac-universal.ts')).href);
// Rebuild from a private source copy: production filtering removes C++/gyp
// inputs, and running development Profiles must retain their existing bindings.
const nativeSource = join(staging, 'native-source/fs-ext');
cpSync(dirname(desktopRequire.resolve('fs-ext/package.json')), nativeSource, {recursive: true});
for (const arch of ['arm64', 'x64']) {
  const binding = prepareFsExtForElectron({platform: 'darwin', arch, fsExtRoot: nativeSource,
    nanRoot: dirname(desktopRequire.resolve('nan/package.json')),
    nodeGypCli: desktopRequire.resolve('node-gyp/bin/node-gyp.js'), electronVersion: prepared.electronVersion});
  const target = join(stagedDesktop, 'node_modules/fs-ext/prebuilds', 'darwin-' + arch, 'electron.abi' + binding.abi + '.node');
  mkdirSync(dirname(target), {recursive: true}); cpSync(binding.path, target);
}
prepareInstalledMacUniversalRuntime(stagedDesktop);
const officialMac = JSON.parse(readFileSync(join(desktopSource, 'package.json'), 'utf8')).build.mac;
const {build, Platform, Arch} = desktopRequire('electron-builder');
// A host electronDist contains only one CPU. Let the official builder obtain
// both pinned Electron archives and merge them with its universal target.
delete config.electronDist;
const settings = {
  ...config,
  electronFuses: {onlyLoadAppFromAsar: false, resetAdHocDarwinSignature: true, runAsNode: true},
  mac: {identity: null, icon: join(appDirectory, 'assets/app-icon.icns'), category: 'public.app-category.developer-tools',
    asar: false, mergeASARs: officialMac.mergeASARs, x64ArchFiles: officialMac.x64ArchFiles, notarize: false,
    extendInfo: {CFBundleLocalizations: ['en', 'zh_CN'], CFBundleDevelopmentRegion: 'en'},
    fileAssociations: [{ext: 'agent-project', name: 'Agent Project', role: 'Editor', rank: 'Alternate'}]},
  dmg: {format: 'UDZO', filesystem: 'HFS+', writeUpdateInfo: false,
    artifactName: 'DSH-Project-Desktop-${version}-mac-universal.dmg'},
};
await build({projectDir: appDirectory, targets: Platform.MAC.createTarget(['dir'], Arch.universal), publish: 'never', config: settings});
const app = join(output, 'mac-universal', product + '.app');
if (!existsSync(app)) throw new Error('Packager did not produce the expected app');
const packagedDesktop = join(app, 'Contents/Resources/app/.cache/runtime/dsh-plugin-desktop');
for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES) execFileSync('lipo',
  [join(packagedDesktop, entry.path), '-verify_arch', entry.arch], {stdio: 'inherit'});
for (const entry of FORBIDDEN_MACOS_UNIVERSAL_ENTRIES) {
  if (existsSync(join(packagedDesktop, entry))) throw new Error('Host-only binding packaged: ' + entry);
}
const signed = await signMacApp(app, '-');
// Reuse the official DMG target (HFS+, compressed conversion and Applications
// entry), packaging the signed app without rebuilding or changing its contents.
await build({projectDir: appDirectory, prepackaged: app, targets: Platform.MAC.createTarget(['dmg'], Arch.universal),
  publish: 'never', config: settings});
const dmg = join(output, `DSH-Project-Desktop-${manifest.version}-mac-universal.dmg`);
const validation = await verifyMacDmg(dmg);
recordPackage(prepared, {app: realpathSync(app), dmg, bytes: statSync(dmg).size, sha256: checksum(dmg),
  signature: signed, validation: {...validation, universalNativeFiles: MACOS_UNIVERSAL_NATIVE_ENTRIES.length}, notarized: false});
