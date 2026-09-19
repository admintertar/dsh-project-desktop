import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {desktopSource, repository, runtimePackage} from '../src/desktop-adapter/paths.mjs';
import {desktopRequire} from '../src/desktop-adapter/stable/modules.mjs';

/** Build unchanged official dialogs, Profile windows and Recovery Assistant. */
export async function buildDesktopDialog() {
  const {build, loadConfigFromFile} = await import(pathToFileURL(desktopRequire.resolve('vite')).href);
  mkdirSync(join(repository, '.cache'), {recursive: true});
  const staging = mkdtempSync(join(repository, '.cache/native-ui-build-'));
  try {
    // Resolve the pinned UI's build dependencies without adding files to the official snapshot.
    cpSync(join(desktopSource, 'src/native-ui'), join(staging, 'src/native-ui'), {recursive: true});
    for (const name of ['recovery-copy.ts', 'profile-create-copy.ts']) {
      cpSync(join(desktopSource, 'src', name), join(staging, 'src', name));
    }
    cpSync(join(desktopSource, 'vite.native-ui.config.ts'), join(staging, 'vite.native-ui.config.ts'));
    symlinkSync(join(runtimePackage, 'node_modules'), join(staging, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const loaded = await loadConfigFromFile({command: 'build', mode: 'production'}, join(staging, 'vite.native-ui.config.ts'));
    if (!loaded) throw new Error('Official native UI build configuration could not be loaded');
    await build({...loaded.config, configFile: false, logLevel: 'warn', build: {...loaded.config.build,
      outDir: join(runtimePackage, 'lib/native-ui'),
      rollupOptions: {...loaded.config.build.rollupOptions, input: Object.fromEntries(
        ['desktop-dialog', 'recovery', 'profile-create', 'profile-selector'].map(name => [name, join(staging, 'src/native-ui', name + '.html')]))},
    }});
  } finally {rmSync(staging, {recursive: true, force: true})}
}
