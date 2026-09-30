import {existsSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {signMacApp} from './sign-macos.mjs';
import {verifyMacDmg} from './verify-mac-package.mjs';
import {checksum, preparePackage, product, recordPackage, officialRequire} from './package-common.mjs';
if (process.platform !== 'darwin') throw new Error('macOS packaging requires a Mac');
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
const prepared = await preparePackage();
const {appDirectory, output, manifest, config} = prepared;
const {build, Platform, Arch} = officialRequire('electron-builder');
const settings = {...config,
  mac: {identity: null, icon: join(appDirectory, 'assets/app-icon.icns'), category: 'public.app-category.developer-tools', notarize: false,
    extendInfo: {CFBundleLocalizations: ['en', 'zh_CN'], CFBundleDevelopmentRegion: 'en',
      NSMicrophoneUsageDescription: 'DSH Project Desktop uses your microphone to transcribe speech into message drafts.'}},
  dmg: {format: 'UDZO', writeUpdateInfo: false, artifactName: 'DSH-Project-Desktop-${version}-mac-${arch}.dmg'},
};
const arch = Arch[process.arch];
await build({projectDir: appDirectory, targets: Platform.MAC.createTarget(['dir'], arch), publish: 'never', config: structuredClone(settings)});
const app = join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', product + '.app');
if (!existsSync(app)) throw new Error('Expected app was not produced');
const signature = await signMacApp(app, '-');
await build({projectDir: appDirectory, prepackaged: app, targets: Platform.MAC.createTarget(['dmg'], arch), publish: 'never', config: structuredClone(settings)});
const dmg = join(output, `DSH-Project-Desktop-${manifest.version}-mac-${process.arch}.dmg`);
const validation = await verifyMacDmg(dmg);
recordPackage(prepared, {bytes: statSync(dmg).size, sha256: checksum(dmg), signature, validation, notarized: false});
