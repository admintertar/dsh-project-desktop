import {cpSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmdirSync} from 'node:fs';
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
  const universalExecutables = [executable,
    join(relocated, 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework')];
  for (const name of readdirSync(join(relocated, 'Contents/Frameworks')).filter(name => name.endsWith('.app'))) {
    universalExecutables.push(join(relocated, 'Contents/Frameworks', name, 'Contents/MacOS', name.slice(0, -4)));
  }
  for (const file of universalExecutables) execFileSync('lipo', [file, '-verify_arch', 'x86_64', 'arm64']);
  const result = await verifyPackagedLaunch(executable, root);
  execFileSync('codesign', ['--verify', '--deep', '--strict', relocated], {stdio: 'inherit'});
  const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(relocated, 'Contents/Info.plist')], {encoding: 'utf8'}));
  if (info.CFBundleName !== 'DSH Project Desktop') throw new Error('App bundle still has the development runner identity');
  assert.deepEqual(readFileSync(join(relocated, 'Contents/Resources', info.CFBundleIconFile)),
    readFileSync(join(repository, 'assets/app-icon.icns')), 'Bundle icon must use the product artwork');
  return {...result, bundleIdentifier: info.CFBundleIdentifier, universalExecutables: universalExecutables.length,
    signatureIntactAfterLaunch: true, artworkVerified: true, relocated};
}

export async function verifyMacDmg(dmg) {
  execFileSync('hdiutil', ['verify', dmg], {stdio: 'inherit'});
  const mount = mkdtempSync(join(tmpdir(), 'dsh-project-dmg-check-'));
  let mounted = false;
  try {
    execFileSync('hdiutil', ['attach', dmg, '-mountpoint', mount, '-nobrowse', '-readonly'], {stdio: 'inherit'});
    mounted = true;
    return {...await verifyMacPackage(join(mount, 'DSH Project Desktop.app')), sourceDmg: dmg, mountedDmgVerified: true};
  } finally {
    if (mounted) execFileSync('hdiutil', ['detach', mount], {stdio: 'inherit'});
    rmdirSync(mount);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = resolve(process.argv[2]);
  const result = await (path.endsWith('.dmg') ? verifyMacDmg(path) : verifyMacPackage(path));
  console.log(JSON.stringify(result, null, 2));
}
