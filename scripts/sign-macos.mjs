import {openSync, closeSync, readSync, readdirSync, lstatSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {repository} from '../src/desktop-adapter/paths.mjs';

export async function signMacApp(app, identity) {
  if (!app.endsWith('.app') || !identity) throw new Error('Provide a concrete .app and a signing identity (or - for local ad-hoc signing)');
  const info = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')], {encoding: 'utf8'}));
  if (info.CFBundleIdentifier !== 'local.dsh.project.desktop') throw new Error('Refusing to sign a different application');
  const files = [], bundles = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {visit(path); if (/\.(app|framework)$/.test(path)) bundles.push(path)}
      else if (entry.isFile() && lstatSync(path).size >= 4) {
        const descriptor = openSync(path, 'r'), header = Buffer.alloc(4);
        try {readSync(descriptor, header, 0, 4, 0)} finally {closeSync(descriptor)}
        const magic = header.toString('hex');
        if (['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic)) files.push(path);
      }
    }
  }
  visit(join(app, 'Contents'));
  const argumentsFor = ['--force', '--sign', identity, ...(identity === '-' ? ['--timestamp=none'] : ['--timestamp', '--options', 'runtime'])];
  const entitlements = join(repository, 'build/entitlements.mac.plist');
  const nested = [...files, ...bundles].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const path of [...nested, app]) {
    execFileSync('codesign', [...argumentsFor, '--entitlements', entitlements, path], {stdio: ['ignore', 'pipe', 'pipe']});
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {stdio: 'inherit'});
  return {kind: identity === '-' ? 'ad-hoc' : 'Developer ID', identity, machOBinaries: files.length, nestedBundles: bundles.length};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [app, identity, notaryProfile] = process.argv.slice(2);
  console.log(await signMacApp(resolve(app), identity));
  if (notaryProfile) {
    if (identity === '-') throw new Error('Notarization requires a Developer ID identity');
    const zip = resolve(app) + '.notarization.zip';
    execFileSync('ditto', ['-c', '-k', '--keepParent', app, zip]);
    execFileSync('xcrun', ['notarytool', 'submit', zip, '--keychain-profile', notaryProfile, '--wait'], {stdio: 'inherit'});
    execFileSync('xcrun', ['stapler', 'staple', app], {stdio: 'inherit'});
    execFileSync('xcrun', ['stapler', 'validate', app], {stdio: 'inherit'});
  }
}
