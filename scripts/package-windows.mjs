import {mkdtempSync, realpathSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {checksum, preparePackage, product, recordPackage, officialRequire, auditLinks} from './package-common.mjs';
import {verifyPackagedLaunch} from './verify-packaged-launch.mjs';
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 packaging requires its native runner');
const prepared = await preparePackage();
const {appDirectory, output, manifest, config} = prepared;
const {build, Platform, Arch} = officialRequire('electron-builder');
const settings = {...config,
  win: {icon: join(appDirectory, 'assets/app-icon.ico'), signExecutable: false,
    artifactName: 'DSH-Project-Desktop-${version}-win-${arch}-Portable.${ext}'},
  nsis: {oneClick: false, perMachine: false, allowElevation: true, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: product,
    license: join(appDirectory, 'LICENSE'), deleteAppDataOnUninstall: false, differentialPackage: false,
    artifactName: 'DSH-Project-Desktop-${version}-win-${arch}-Setup.${ext}'},
};
await build({projectDir: appDirectory, targets: Platform.WINDOWS.createTarget(['nsis', 'zip'], Arch.x64), publish: 'never', config: settings});
const installer = join(output, `DSH-Project-Desktop-${manifest.version}-win-x64-Setup.exe`);
const zip = join(output, `DSH-Project-Desktop-${manifest.version}-win-x64-Portable.zip`);
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-project-win-check-')));
const {execFileSync} = await import('node:child_process');
execFileSync('tar.exe', ['-xf', zip, '-C', root]);
// electron-builder's ZIP has application files at its root.
auditLinks(root);
const validation = await verifyPackagedLaunch(join(root, product + '.exe'), root);
recordPackage(prepared, {signature: {kind: 'unsigned'}, bytes: {installer: statSync(installer).size, portable: statSync(zip).size},
  sha256: {installer: checksum(installer), portable: checksum(zip)}, validation: {...validation, portableExtracted: true}});
