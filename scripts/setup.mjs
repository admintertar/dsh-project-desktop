import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {verifyOfficialSource} from './verify-official-source.mjs';
import {repository, officialPin} from '../src/desktop-adapter/official/paths.mjs';
import {verifyProjectPlugin} from '../src/desktop-adapter/official/profile.mjs';

const {values} = parseArgs({args: process.argv.slice(2).filter(arg => arg !== '--'), options: {
  'official-source': {type: 'string'}, 'project-source': {type: 'string'},
}});
if (!values['official-source'] || !values['project-source']) {
  throw new Error('Usage: yarn setup -- --official-source /path/to/built/deepseek-harness --project-source /path/to/dsh-plugin-project');
}
const {source} = verifyOfficialSource(values['official-source']);
const project = resolve(values['project-source']);
const pin = JSON.parse(readFileSync(join(repository, 'project-source.lock.json'), 'utf8'));
const git = (...args) => execFileSync('git', ['-C', project, ...args], {encoding: 'utf8'}).trim();
if (git('rev-parse', 'HEAD') !== pin.commit || git('status', '--porcelain')) {
  throw new Error('Project checkout must be clean and match project-source.lock.json');
}
// 插件自己的 setup/build 管理官方依赖与产物，Shell 不复制它的业务源码。
execFileSync(process.execPath, [join(project, 'scripts/setup.mjs'), '--desktop', source], {cwd: project, stdio: 'inherit'});
execFileSync(process.execPath, [join(project, 'scripts/build.mjs')], {cwd: project, stdio: 'inherit'});
verifyProjectPlugin(project);
mkdirSync(join(repository, '.cache'), {recursive: true});
writeFileSync(join(repository, '.cache/official-shell-inputs.json'), JSON.stringify({schemaVersion: 1,
  sourceCommit: officialPin.commit, projectCommit: pin.commit, officialSource: source, projectSource: project}, null, 2) + '\n');
console.log('Official development sources configured. Prepare the official runtime, then run yarn build and yarn start.');
