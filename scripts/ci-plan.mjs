import {appendFileSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function packagingPlan(lock, version, selection = 'all', ref = '') {
  if (lock.channel !== 'stable') throw new Error('Only stable packaging is supported');
  if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${version}`) throw new Error('The version tag must match package.json');
  if (!['all', 'mac', 'win'].includes(selection)) throw new Error('Unknown packaging platform');
  const outputs = {};
  for (const name of ['desktop', 'harness', 'project']) {
    const pin = lock[name];
    if (!/^[a-f0-9]{40}$/.test(pin.commit)) throw new Error(`${name} must pin a full commit`);
    const match = /^https:\/\/github\.com\/([\w-]+\/[^/\s]+)\.git$/.exec(pin.repository);
    if (!match) throw new Error(`${name} must use a public GitHub repository URL`);
    outputs[`${name}_repository`] = match[1];
    outputs[`${name}_commit`] = pin.commit;
  }
  const include = [
    {target: 'mac-x64', family: 'mac', runner: 'macos-15-intel', arch: 'x64', script: 'scripts/package-macos.mjs'},
    {target: 'mac-arm64', family: 'mac', runner: 'macos-15', arch: 'arm64', script: 'scripts/package-macos.mjs'},
    {target: 'win-x64', family: 'win', runner: 'windows-2022', arch: 'x64', script: 'scripts/package-windows.mjs'},
  ].filter(item => selection === 'all' || item.family === selection);
  return {...outputs, matrix: JSON.stringify({include})};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lock = JSON.parse(readFileSync(new URL('../upstream.lock.json', import.meta.url), 'utf8'));
  const {version} = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const outputs = packagingPlan(lock, version, process.env.PACKAGE_PLATFORM || 'all', process.env.GITHUB_REF || '');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join(''));
  console.log(JSON.stringify(outputs, null, 2));
}
