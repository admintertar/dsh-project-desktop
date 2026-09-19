import {existsSync, mkdtempSync, readFileSync, realpathSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {desktopSource, repository} from '../src/desktop-adapter/paths.mjs';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';
import {auditLinks, checksum, preparePackage, product, recordPackage} from './package-common.mjs';
import {verifyPackagedLaunch} from './verify-packaged-launch.mjs';
import {officialPackageBuild} from './package-upstream-config.mjs';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build Windows x64 packages on a native Windows x64 host');
// Reuse the pinned upstream unsigned-build policy and PE validators unchanged.
const {withoutWindowsSigningSecrets} = await import(pathToFileURL(join(desktopSource, 'scripts/package-win.ts')).href);
const {assertPortableExecutable, assertPortableExecutableBuffer} = await import(pathToFileURL(join(desktopSource, 'scripts/verify-win-installer.ts')).href);
const {electronBuilderEnvironment} = await import(pathToFileURL(join(desktopSource, 'scripts/electron-builder-environment.ts')).href);
const unsigned = electronBuilderEnvironment({...withoutWindowsSigningSecrets(process.env), CSC_IDENTITY_AUTO_DISCOVERY: 'false'});
for (const name of Object.keys(process.env)) if (!(name in unsigned)) delete process.env[name];
Object.assign(process.env, unsigned);
const prepared = await preparePackage(process.platform, process.arch);
const {appDirectory, output, manifest, config} = prepared;
const {build, Platform, Arch} = desktopRequire('electron-builder');
const settings = {...config,
  // The pinned builder's NSIS template needs the official newer NSIS toolset.
  toolsets: officialPackageBuild.toolsets,
  electronFuses: {onlyLoadAppFromAsar: false},
  fileAssociations: [{ext: 'agent-project', name: 'Agent Project', role: 'Editor'}],
  win: {icon: join(appDirectory, 'assets/app-icon.ico'), signExecutable: false,
    artifactName: 'DSH-Project-Desktop-${version}-win-${arch}-Portable.${ext}'},
  nsis: {oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: product,
    installerIcon: join(appDirectory, 'assets/app-icon.ico'), uninstallerIcon: join(appDirectory, 'assets/app-icon.ico'),
    license: join(appDirectory, 'LICENSE'), deleteAppDataOnUninstall: false, differentialPackage: false,
    artifactName: 'DSH-Project-Desktop-${version}-win-${arch}-Setup.${ext}'},
};
await build({projectDir: appDirectory, targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64), publish: 'never', config: settings});
const app = join(output, 'win-unpacked');
const installer = join(output, `DSH-Project-Desktop-${manifest.version}-win-x64-Setup.exe`);
const zip = join(output, `DSH-Project-Desktop-${manifest.version}-win-x64-Portable.zip`);
assertPortableExecutable(installer, 'Project Desktop installer');
assertPortableExecutable(join(app, product + '.exe'), 'Project Desktop application');
auditLinks(app);
const AdmZip = desktopRequire('adm-zip');
const archive = new AdmZip(zip);
const application = archive.getEntry(product + '.exe');
assert.ok(application, 'Portable ZIP must contain the application executable');
assertPortableExecutableBuffer(application.getData(), 'Project Desktop portable application', zip);
for (const name of ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES/Harness.txt', 'upstream.lock.json']) {
  assert.ok(archive.getEntry('resources/app/' + name), `Portable ZIP is missing ${name}`);
}
// Run the actual archive contents after extraction, outside the checkout.
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-project-win-check-')));
const relocated = join(root, product);
archive.extractAllTo(relocated, false);
assert.equal(existsSync(join(relocated, 'resources/app/.cache/runtime/dsh-plugin-desktop/lib/index.js')), true);
for (const asset of ['app-icon.ico', 'app-icon.png', 'tray/tray-icon-blue.png']) {
  assert.deepEqual(readFileSync(join(relocated, 'resources/app/assets', asset)), readFileSync(join(repository, 'assets', asset)));
}
const validation = await verifyPackagedLaunch(join(relocated, product + '.exe'), root);
recordPackage(prepared, {app, installer, zip, signature: {kind: 'unsigned'},
  bytes: {installer: statSync(installer).size, portable: statSync(zip).size},
  sha256: {installer: checksum(installer), portable: checksum(zip)},
  validation: {...validation, relocated, portableExtracted: true, artworkVerified: true, installerPEVerified: true}});
