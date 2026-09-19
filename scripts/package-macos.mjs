import {cpSync, existsSync, mkdirSync, realpathSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {signMacApp} from './sign-macos.mjs';
import {verifyMacPackage} from './verify-mac-package.mjs';
import {checksum, copyOptions, preparePackage, product, recordPackage} from './package-common.mjs';

if (process.platform !== 'darwin' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Build macOS packages on a native x64 or arm64 Mac');
const prepared = preparePackage(process.platform, process.arch);
const {appDirectory, output, staging, manifest, config} = prepared;
const {build, Platform, Arch} = desktopRequire('electron-builder');
await build({projectDir: appDirectory, targets: Platform.MAC.createTarget(['dir'], Arch[process.arch]), publish: 'never', config: {
  ...config,
  mac: {identity: null, icon: join(appDirectory, 'assets/app-icon.icns'), category: 'public.app-category.developer-tools',
    extendInfo: {CFBundleLocalizations: ['en', 'zh_CN'], CFBundleDevelopmentRegion: 'en'},
    fileAssociations: [{ext: 'agent-project', name: 'Agent Project', role: 'Editor', rank: 'Alternate'}]},
}});
const app = join(output, process.arch === 'x64' ? 'mac' : 'mac-arm64', product + '.app');
if (!existsSync(app)) throw new Error('Packager did not produce the expected app');
const signed = await signMacApp(app, '-');
const validation = await verifyMacPackage(app);
const diskRoot = join(staging, 'disk'); mkdirSync(diskRoot);
cpSync(app, join(diskRoot, product + '.app'), copyOptions);
symlinkSync('/Applications', join(diskRoot, 'Applications'));
const dmg = join(output, `${product}-${manifest.version}-mac-${process.arch}-local.dmg`);
execFileSync('hdiutil', ['create', '-volname', product, '-srcfolder', diskRoot, '-ov', '-format', 'UDZO', dmg], {stdio: 'inherit'});
execFileSync('hdiutil', ['verify', dmg], {stdio: 'inherit'});
recordPackage(prepared, {app: realpathSync(app), dmg, sha256: checksum(dmg), signature: signed, validation, notarized: false});
