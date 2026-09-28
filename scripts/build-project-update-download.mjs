import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {desktopSource, runtimePackage} from '../src/desktop-adapter/paths.mjs';
import {releaseRepository} from '../src/app/update-manifest.mjs';

/** Compile the complete official downloader with only our product's origin policy.
 * The upstream service's allowlist cannot accept GitHub release assets. Keep its
 * HTTPS/redirect, byte limit, digest, file validation and atomic replacement gates.
 * A changed upstream policy must be reviewed explicitly before building.
 */
export async function buildProjectUpdateDownload() {
  const source = readFileSync(join(desktopSource, 'src/update-download.ts'), 'utf8');
  const officialTargets = "  { host: 'www.dshdesktop.cn' },\n  { host: 'dshdesktop.cn' },\n  { host: 'modelscope.cn', pathPrefix: '/models/t4wefan/deepseek-harness-desktop/' },";
  if (source.split(officialTargets).length !== 2) throw new Error('Review the changed official update origin policy');
  const contents = source.replace(officialTargets,
    `  { host: 'github.com', pathPrefix: '/${releaseRepository}/releases/download/' },\n  { host: 'release-assets.githubusercontent.com' },`);
  await build({stdin: {contents, resolveDir: join(desktopSource, 'src'), sourcefile: 'project-update-download.ts', loader: 'ts'},
    outfile: join(runtimePackage, 'lib/project-update-download.js'), bundle: true, format: 'esm', platform: 'node',
    packages: 'external', target: 'node22', sourcemap: true, nodePaths: [join(runtimePackage, 'node_modules')]});
}
