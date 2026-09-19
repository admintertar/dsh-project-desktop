import {cpSync, mkdtempSync, readFileSync, realpathSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {verifyPackagedLaunch} from './verify-packaged-launch.mjs';

export async function verifyMacPackage(app) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-project-package-check-')));
  const relocated = join(root, basename(app));
  cpSync(app, relocated, {recursive: true, verbatimSymlinks: true});
  const assets = ['app-icon-mac.png', 'app-icon.png', 'app-icon.icns', 'tray/tray-iconTemplate.png',
    'tray/tray-iconTemplate@2x.png', 'tray/tray-icon-blue.png', 'tray/tray-icon-blue@2x.png'];
  for (const asset of assets) assert.deepEqual(readFileSync(join(relocated, 'Contents/Resources/app/assets', asset)),
    readFileSync(join(repository, 'assets', asset)), `Packaged artwork differs: ${asset}`);
  const executable = join(relocated, 'Contents/MacOS/DSH Project Desktop');
  const result = await verifyPackagedLaunch(executable, root);
  execFileSync('codesign', ['--verify', '--deep', '--strict', relocated], {stdio: 'inherit'});
  const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(relocated, 'Contents/Info.plist')], {encoding: 'utf8'}));
  if (info.CFBundleName !== 'DSH Project Desktop') throw new Error('App bundle still has the development runner identity');
  assert.deepEqual(readFileSync(join(relocated, 'Contents/Resources', info.CFBundleIconFile)),
    readFileSync(join(repository, 'assets/app-icon.icns')), 'Bundle icon must use the product artwork');
  return {...result, bundleIdentifier: info.CFBundleIdentifier, signatureIntactAfterLaunch: true, artworkVerified: true, relocated};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await verifyMacPackage(resolve(process.argv[2])); console.log(JSON.stringify(result, null, 2));
}
