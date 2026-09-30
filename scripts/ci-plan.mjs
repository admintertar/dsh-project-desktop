import {appendFileSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Official Desktop's three native targets; no community checkout or cross-compiled runtime. */
export function packagingPlan(official, project, version, selection = 'all', ref = '') {
  if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)) throw new Error('Invalid release version');
  if (ref.startsWith('refs/tags/') && ref !== `refs/tags/v${version}`) throw new Error('The version tag must match package.json');
  if (!['all', 'mac', 'win'].includes(selection)) throw new Error('Unknown packaging platform');
  if (official.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git') throw new Error('Only DeepSeek official Desktop is supported');
  const outputs = {};
  for (const [name, pin] of Object.entries({official, project})) {
    if (!/^[a-f0-9]{40}$/.test(pin.commit)) throw new Error(`${name} must pin a full commit`);
    const match = /^https:\/\/github\.com\/([\w-]+\/[^/\s]+)\.git$/.exec(pin.repository);
    if (!match) throw new Error(`${name} must use a public GitHub repository URL`);
    outputs[`${name}_repository`] = match[1]; outputs[`${name}_commit`] = pin.commit;
  }
  outputs.official_tag = official.tag;
  const include = [
    {target: 'mac-arm64', family: 'mac', runner: 'macos-15', arch: 'arm64', shell: 'bash'},
    {target: 'mac-x64', family: 'mac', runner: 'macos-15-intel', arch: 'x64', shell: 'bash'},
    {target: 'win-x64', family: 'win', runner: 'windows-2022', arch: 'x64', shell: 'pwsh'},
  ].filter(item => selection === 'all' || item.family === selection);
  return {...outputs, matrix: JSON.stringify({include})};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'));
  const {version} = read('package.json');
  if (process.env.PACKAGE_PUBLISH === 'true' && !['', 'all'].includes(process.env.PACKAGE_PLATFORM ?? '')) throw new Error('Publishing requires every native target');
  const outputs = packagingPlan(read('official-source.lock.json'), read('project-source.lock.json'), version,
    process.env.PACKAGE_PLATFORM || 'all', process.env.GITHUB_REF || '');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([name, value]) => `${name}=${value}\n`).join(''));
  console.log(JSON.stringify(outputs, null, 2));
}
