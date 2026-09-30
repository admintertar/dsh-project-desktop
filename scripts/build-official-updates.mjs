import {build} from 'esbuild';
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

/** Build unchanged official update services and their isolated dialog into Shell-owned output. */
export async function buildOfficialUpdates(source, output) {
  const desktop = join(source, 'apps/desktop');
  const destination = join(output, 'official-updates');
  mkdirSync(destination, {recursive: true});
  const modules = ['update-coordinator', 'update-schedule', 'update-dialog', 'update-overlay', 'update-presentation', 'locale', 'web-document'];
  const result = await build({stdin: {contents: modules.map(name => `export * from ${JSON.stringify(join(desktop, 'src', name + '.ts'))};`).join('\n'),
    resolveDir: desktop, sourcefile: 'shell-official-updates.ts', loader: 'ts'},
    outfile: join(destination, 'services.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
    external: ['electron'], metafile: true,
    banner: {js: "import {createRequire as __shellRequire} from 'node:module'; const require = __shellRequire(import.meta.url);"}});
  const preload = await build({entryPoints: [join(desktop, 'src/preload-update-dialog.ts')],
    outfile: join(destination, 'preload.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    external: ['electron'], metafile: true});
  const assets = ['update-dialog.html', 'update-dialog.js', 'update-dialog.css', 'update-close.svg'];
  for (const asset of assets) cpSync(join(desktop, 'renderer', asset), join(destination, asset));
  const inputs = [...Object.keys(result.metafile.inputs), ...Object.keys(preload.metafile.inputs),
    ...assets.map(asset => join(desktop, 'renderer', asset))];
  const packages = new Map();
  for (const input of inputs.filter(input => input.includes('node_modules/'))) {
    let directory = dirname(resolve(input));
    while (dirname(directory) !== directory && !existsSync(join(directory, 'package.json'))) directory = dirname(directory);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    packages.set(`${manifest.name}@${manifest.version}`, {directory, manifest});
  }
  const notices = [readFileSync(join(source, 'LICENSE'), 'utf8')];
  for (const [name, {directory, manifest}] of packages) {
    const files = readdirSync(directory, {withFileTypes: true}).filter(file => file.isFile() && /^(license|copying|notice)(\.|$)/i.test(file.name));
    const paths = files.map(file => join(directory, file.name));
    notices.push(`${name} (${manifest.license ?? 'see license below'})\n\n` + (paths.length
      ? paths.map(path => readFileSync(path, 'utf8')).join('\n')
      : `This published package contains no separate license file. Its original package metadata:\n${JSON.stringify(manifest, null, 2)}`));
    inputs.push(join(directory, 'package.json'), ...paths);
  }
  writeFileSync(join(destination, 'THIRD_PARTY_LICENSES.txt'), notices.join('\n\n-----\n\n'));
  return [...inputs, join(source, 'LICENSE')];
}
