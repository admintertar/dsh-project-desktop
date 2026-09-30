import {build} from 'esbuild';
import {cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {verifyOfficialSource} from './verify-official-source.mjs';
import {repository, projectSource, officialPin, officialSource} from '../src/desktop-adapter/official/paths.mjs';
import {verifyProjectPlugin} from '../src/desktop-adapter/official/profile.mjs';

const source = resolve(process.argv.slice(2).find(arg => arg !== '--') ?? officialSource);
verifyOfficialSource(source);
const pluginPin = JSON.parse(readFileSync(join(repository, 'project-source.lock.json'), 'utf8'));
if (!process.env.DSH_PROJECT_PLUGIN_SOURCE) {
  const git = (...args) => execFileSync('git', ['-C', projectSource, ...args], {encoding: 'utf8'}).trim();
  if (git('rev-parse', 'HEAD') !== pluginPin.commit || git('status', '--porcelain')) {
    throw new Error('Project source must match project-source.lock.json, or use DSH_PROJECT_PLUGIN_SOURCE for local development');
  }
}
verifyProjectPlugin(projectSource);
const nodePaths = [join(projectSource, 'node_modules'), join(source, 'node_modules')];
const alias = {'@project-source': join(projectSource, 'src'), '@official-source': source,
  react: join(projectSource, 'node_modules/react'), 'react-dom': join(projectSource, 'node_modules/react-dom')};
const output = join(repository, 'dist');
mkdirSync(output, {recursive: true});
const options = {bundle: true, nodePaths, alias, metafile: true, logLevel: 'warning'};
const builds = [];
builds.push(await build({...options, entryPoints: [join(projectSource, 'src/project-files.ts')],
  outfile: join(output, 'project-files.mjs'), format: 'esm', platform: 'node', packages: 'external'}));
builds.push(await build({...options, entryPoints: [join(repository, 'src/desktop-adapter/official/guide-resources-entry.ts')],
  outfile: join(output, 'guide-resources.mjs'), format: 'esm', platform: 'node', external: ['yaml']}));
builds.push(await build({...options, entryPoints: [join(repository, 'src/guide/preload.cjs')],
  outfile: join(output, 'guide/preload.cjs'), format: 'cjs', platform: 'node', external: ['electron']}));
builds.push(await build({...options, entryPoints: [join(repository, 'src/guide/index.tsx')],
  outfile: join(output, 'guide/index.js'), format: 'iife', platform: 'browser', jsx: 'automatic', minify: true,
  define: {'process.env.NODE_ENV': '"production"'}, loader: {'.module.css': 'local-css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file'}}));
const theme = join(source, 'packages/client/ui-theme/src/styles');
writeFileSync(join(output, 'guide/official.css'), ['base', 'corner-shape', 'design-platform', 'scrollbar', 'gradient-shadow-text', 'shiki']
  .map(name => readFileSync(join(theme, name + '.css'), 'utf8')).join('\n'));
cpSync(join(repository, 'src/guide/index.html'), join(output, 'guide/index.html'));
const inputs = [...new Set(builds.flatMap(value => Object.keys(value.metafile.inputs)))];
if (inputs.some(path => /(?:\.upstream\/(?:desktop|harness-guide)|dsh-plugin-desktop|\.cache\/runtime)/u.test(path))) {
  throw new Error('Community input in the official Shell build');
}
writeFileSync(join(output, 'build.json'), JSON.stringify({schemaVersion: 1, sourceCommit: officialPin.commit,
  projectCommit: pluginPin.commit, ...(process.env.DSH_PROJECT_PLUGIN_SOURCE ? {projectLocalSource: projectSource} : {}), inputs}, null, 2) + '\n');
console.log('Built Shell guide and Project helpers using only the pinned official Harness and Project plugin.');
