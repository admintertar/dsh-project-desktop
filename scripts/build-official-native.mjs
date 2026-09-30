import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** 编译固定官方模块；不改写官方工作树或打补丁到生成后的 bundle。 */
export async function buildOfficialNative(source, destination) {
  const version = JSON.parse(readFileSync(join(source, 'apps/desktop/package.json'), 'utf8')).version;
  const shim = fileURLToPath(new URL('../src/desktop-adapter/official/scoped-electron.mjs', import.meta.url));
  const modules = ['keyboard', 'directory-picker', 'device-info', 'locale', 'welcome-backend',
    'browser-guests', 'platform-view', 'microphone-permissions'];
  await build({stdin: {contents: [
    ...modules.map(name => `export * from ${JSON.stringify(join(source, 'apps/desktop/src', name + '.ts'))};`),
    `export {createWindowIpcScope, withProjectSessionScope} from ${JSON.stringify(shim)};`,
  ].join('\n'), resolveDir: source, sourcefile: 'shell-official-native.ts', loader: 'ts'},
  outfile: join(destination, 'native-services.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
  define: {'process.env.DSH_CLIENT_VERSION': JSON.stringify(version)},
  banner: {js: "import {createRequire as __shellRequire} from 'node:module'; const require = __shellRequire(import.meta.url);"},
  plugins: [{name: 'window-scoped-electron', setup(builder) {
    builder.onResolve({filter: /^electron$/}, args => args.importer === shim
      ? {path: 'electron', external: true} : {path: shim});
  }}]});
}
