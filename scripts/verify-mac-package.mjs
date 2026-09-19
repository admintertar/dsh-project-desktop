import {cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn, execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {repository} from '../src/desktop-adapter/paths.mjs';

export async function verifyMacPackage(app) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-project-package-check-')));
  const relocated = join(root, basename(app));
  cpSync(app, relocated, {recursive: true, verbatimSymlinks: true});
  const assets = ['app-icon-mac.png', 'app-icon.png', 'app-icon.icns', 'tray/tray-iconTemplate.png',
    'tray/tray-iconTemplate@2x.png', 'tray/tray-icon-blue.png', 'tray/tray-icon-blue@2x.png'];
  for (const asset of assets) assert.deepEqual(readFileSync(join(relocated, 'Contents/Resources/app/assets', asset)),
    readFileSync(join(repository, 'assets', asset)), `Packaged artwork differs: ${asset}`);
  const executable = join(relocated, 'Contents/MacOS/DSH Project Desktop');
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  const log = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--verify-installation'], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    const record = data => {output += data.toString(); process.stdout.write(data)};
    child.stdout.on('data', record); child.stderr.on('data', record);
    const deadline = setTimeout(() => {child.kill('SIGTERM')}, 180000);
    child.on('error', reject);
    child.on('close', code => {clearTimeout(deadline); writeFileSync(join(root, 'launch.log'), output);
      code === 0 ? resolve(output) : reject(new Error(`Relocated packaged launch failed (${code}); ${root}/launch.log`));
    });
  });
  const line = log.split('\n').find(line => line.startsWith('INSTALLATION_CHECK='));
  if (!line) throw new Error('Packaged application did not finish its installation check');
  const result = JSON.parse(line.slice('INSTALLATION_CHECK='.length));
  if (!result.ok || !result.appPath.startsWith(root + '/')) throw new Error('Installation check did not use the relocated bundle');
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
