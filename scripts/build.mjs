import {build} from 'esbuild';
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {repository, desktopSource, projectSource, localProjectSource, runtimePackage, projectPackage, lock} from '../src/desktop-adapter/paths.mjs';
import {verifyUpstream} from './verify-upstream.mjs';
import {verifyRuntimeDependencies} from '../src/desktop-adapter/stable/verify.mjs';
import {buildDesktopDialog} from './build-desktop-dialog.mjs';
import {buildProjectUpdateDownload} from './build-project-update-download.mjs';
import {productVersion} from '../src/app/product.mjs';

verifyUpstream();
if (!existsSync(join(runtimePackage, 'node_modules/@deepseek-ai/dsh'))) throw new Error('Run yarn run setup first');
verifyRuntimeDependencies();
const nodePaths = [join(runtimePackage, 'node_modules')];
mkdirSync(runtimePackage, {recursive: true});
// The 0.1.7 Profile resolver anchors external Project imports at Desktop's
// module URL. MCP SDK's converter must therefore exist at that anchor as a
// declared compatibility dependency in the packaged production graph.
const converterSource = join(repository, '.cache/project-dependencies/zod-to-json-schema');
const converterTarget = join(runtimePackage, 'node_modules/zod-to-json-schema');
if (!existsSync(join(converterSource, 'package.json'))) throw new Error('Project MCP converter is missing from the pinned dependency cache');
if (!existsSync(join(converterTarget, 'package.json'))) cpSync(converterSource, converterTarget, {recursive: true});
for (const name of ['package.json', 'cordis.patch.yml', 'build']) {
  cpSync(join(desktopSource, name), join(runtimePackage, name), {recursive: true});
}
// Since Desktop 2.0.15, the client imports Tailwind 4 onboarding CSS. Build
// that client with the official Vite pipeline so its style plugin scopes and
// installs the generated CSS inside the Loader factory exactly as upstream.
for (const name of ['src', 'vite.client.config.ts']) {
  cpSync(join(desktopSource, name), join(runtimePackage, name), {recursive: true});
}
cpSync(join(repository, '.upstream/desktop/LICENSE'), join(runtimePackage, 'LICENSE'));
if (existsSync(join(desktopSource, 'THIRD_PARTY_NOTICES.md'))) {
  cpSync(join(desktopSource, 'THIRD_PARTY_NOTICES.md'), join(runtimePackage, 'THIRD_PARTY_NOTICES.md'));
}
// Compile unmodified library modules, never the official app entry or launcher.
const entries = readdirSync(join(desktopSource, 'src')).filter(name => name.endsWith('.ts')
  && !['main.ts', 'bin.ts', 'preload.ts', 'compatibility-preload.ts'].includes(name));
await build({entryPoints: entries.map(name => join(desktopSource, 'src', name)),
  outdir: join(runtimePackage, 'lib'), bundle: true, splitting: true, format: 'esm', platform: 'node',
  target: 'node22', packages: 'external', nodePaths, sourcemap: true, logLevel: 'warning'});
for (const name of ['preload', 'compatibility-preload']) await build({
  entryPoints: [join(desktopSource, 'src', name + '.ts')], outfile: join(runtimePackage, 'lib', name + '.cjs'),
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', target: 'node22', nodePaths,
});
await buildDesktopDialog();
await buildProjectUpdateDownload();
const browser = {bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', sourcemap: true,
  define: {'process.env.NODE_ENV': '"production"'}, nodePaths,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-primitives']};
const envelope = id => ({banner: {js: `window.__ModuleLoader__.load({id:${JSON.stringify(id)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`},
  footer: {js: 'return module.exports;}});'}});
execFileSync(process.execPath, [join(runtimePackage, 'node_modules/vite/bin/vite.js'), 'build',
  '--config', join(runtimePackage, 'vite.client.config.ts')], {cwd: runtimePackage, stdio: 'inherit'});

mkdirSync(projectPackage, {recursive: true});
for (const name of ['package.json', 'cordis.patch.yml', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  cpSync(join(projectSource, name), join(projectPackage, name));
}
const projectPaths = [...nodePaths, join(repository, '.cache/project-dependencies')];
await build({entryPoints: ['index', 'project', 'project-files'].map(name => join(projectSource, 'src', name + '.ts')),
  outdir: join(projectPackage, 'lib'), bundle: true, format: 'esm', platform: 'node', packages: 'external',
  target: 'node22', sourcemap: true, nodePaths: projectPaths});
await build({...browser, ...envelope('dsh-plugin-project'), nodePaths: projectPaths,
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit'],
  entryPoints: [join(projectSource, 'src/client/index.tsx')], outfile: join(projectPackage, 'lib/client.js')});
writeFileSync(join(projectPackage, 'lib/build.json'), JSON.stringify({desktop: lock.desktop.version,
  harness: {stable: {version: lock.harness.version, commit: lock.harness.commit}}}) + '\n');
mkdirSync(join(repository, 'dist'), {recursive: true});
writeFileSync(join(repository, 'dist/build.json'), JSON.stringify({desktop: lock.desktop.commit,
  harness: lock.harness.commit, project: lock.project.commit,
  ...(localProjectSource === undefined ? {} : {projectLocalSource: localProjectSource})}, null, 2) + '\n');
const shellPackage = join(repository, '.cache/runtime/dsh-project-shell');
mkdirSync(shellPackage, {recursive: true});
const officialManifest = JSON.parse(readFileSync(join(runtimePackage, 'package.json'), 'utf8'));
writeFileSync(join(shellPackage, 'package.json'), JSON.stringify({name: 'dsh-project-shell', version: productVersion, type: 'module',
  exports: {'.': './index.mjs', './client': './client.js', './package.json': './package.json'},
  dsh: {client: officialManifest.dsh.client}}, null, 2));
writeFileSync(join(shellPackage, 'index.mjs'), "export * from '../../../src/desktop-adapter/stable/shell-host.mjs';\n");
const shellBuild = await build({...browser, ...envelope('dsh-project-shell'),
  // Official Desktop CSS is handled by its Vite build; keep esbuild from
  // traversing Tailwind imports here. The Shell's own settings CSS is appended
  // explicitly below so it cannot be silently dropped by this empty loader.
  external: [...browser.external, '@deepseek-ai/dsh-client-store'], loader: {'.module.css': 'local-css', '.css': 'empty'}, jsx: 'automatic',
  entryPoints: [join(repository, 'src/desktop-adapter/stable/shell-client.ts')], outfile: join(shellPackage, 'client.js'), write: false});
// Package the unchanged official Models page's CSS with our own client module.
const shellCss = [
  shellBuild.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '',
  readFileSync(join(repository, 'src/desktop-adapter/stable/settings.css'), 'utf8'),
].join('\n');
for (const file of shellBuild.outputFiles) writeFileSync(file.path, basename(file.path) === 'client.js' ? file.text +
  `\n{const style=document.createElement('style');style.dataset.plugin='dsh-project-shell';style.textContent=${JSON.stringify(shellCss)};document.head.appendChild(style);}\n` : file.contents);
// Helpers are compiled from the locked plugin, not copied into our source tree.
await build({entryPoints: [join(projectSource, 'src/project-files.ts')], outfile: join(repository, 'dist/project-files.mjs'),
  bundle: true, format: 'esm', platform: 'node', nodePaths: projectPaths, packages: 'external'});
await build({entryPoints: [join(repository, 'src/desktop-adapter/stable/guide-resources-entry.ts')],
  outfile: join(repository, 'dist/guide-resources.mjs'), bundle: true, format: 'esm', platform: 'node', nodePaths: projectPaths, external: ['yaml']});
await build({entryPoints: [join(repository, 'src/guide/preload.cjs')], outfile: join(repository, 'dist/guide/preload.cjs'),
  bundle: true, platform: 'node', format: 'cjs', external: ['electron']});
await build({entryPoints: [join(repository, 'src/guide/index.tsx')], outfile: join(repository, 'dist/guide/index.js'),
  bundle: true, platform: 'browser', format: 'iife', nodePaths, jsx: 'automatic', minify: true,
  alias: {react: join(nodePaths[0], 'react'), 'react-dom': join(nodePaths[0], 'react-dom')},
  define: {'process.env.NODE_ENV': '"production"'}, loader: {'.module.css': 'local-css', '.woff': 'file', '.woff2': 'file', '.ttf': 'file'}});
const themeStyles = join(repository, '.upstream/harness-guide/packages/client/ui-theme/src/styles');
writeFileSync(join(repository, 'dist/guide/official.css'), ['base', 'corner-shape', 'design-platform', 'scrollbar', 'gradient-shadow-text', 'shiki']
  .map(name => readFileSync(join(themeStyles, name + '.css'), 'utf8')).join('\n'));
cpSync(join(repository, 'src/guide/index.html'), join(repository, 'dist/guide/index.html'));
verifyUpstream();
console.log(localProjectSource === undefined
  ? 'Built official stable libraries and the pinned Project plugin without modifying either source tree.'
  : `Built official stable libraries and the local Project plugin from ${localProjectSource} (development build, not a release).`);
