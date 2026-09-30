/** Exact official workspace paths consumed by the Shell development adapter. */
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const packages = {
  desktop: ['apps/desktop', '@deepseek-ai/dsh-desktop'],
  host: ['apps/desktop-host', '@deepseek-ai/dsh-desktop-host'],
  cli: ['apps/cli', '@deepseek-ai/dsh'],
  web: ['apps/web', '@deepseek-ai/dsh-web-frontend'],
};

/** Resolve built artifacts only after the checkout has passed the Git pin check. */
export function officialBuildInputs(source, pin) {
  const root = resolve(source);
  if (pin.repository !== 'https://github.com/deepseek-ai/deepseek-harness.git') {
    throw new Error('Official Desktop build inputs require the DeepSeek source pin');
  }
  for (const [directory, name] of Object.values(packages)) {
    const path = join(root, directory, 'package.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.name !== name || manifest.version !== pin.version) {
      throw new Error(`Official package differs from pin: ${directory}`);
    }
  }
  const paths = {
    root,
    desktop: join(root, packages.desktop[0]),
    host: join(root, packages.host[0]),
    cli: join(root, packages.cli[0]),
    web: join(root, packages.web[0]),
    webDocument: join(root, 'apps/desktop/src/web-document.ts'),
    desktopMain: join(root, 'apps/desktop/lib/main.js'),
    desktopPreload: join(root, 'apps/desktop/lib/preload-app.cjs'),
    hostEntry: join(root, 'apps/desktop-host/lib/index.js'),
    cliEntry: join(root, 'apps/cli/lib/bin.js'),
    webDist: join(root, 'apps/web/dist'),
    dependencyDir: join(root, 'node_modules/.pnpm/node_modules'),
    pnpmPackage: join(root, 'apps/desktop/node_modules/pnpm/package.json'),
    electronPackage: join(root, 'apps/desktop/node_modules/electron/index.js'),
    officeSkills: join(root, 'packages/skill/skill-office/assets'),
    license: join(root, 'LICENSE'),
  };
  for (const key of ['webDocument', 'desktopMain', 'desktopPreload', 'hostEntry', 'cliEntry', 'dependencyDir',
    'pnpmPackage', 'electronPackage', 'officeSkills', 'license']) {
    if (!existsSync(paths[key])) throw new Error(`Build official source first: ${key} (${paths[key]})`);
  }
  if (!existsSync(join(paths.webDist, 'index.html'))) throw new Error('Build official Web dist first');
  const pnpm = JSON.parse(readFileSync(paths.pnpmPackage, 'utf8'));
  const workspace = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (workspace.version !== pin.version || workspace.packageManager !== `pnpm@${pnpm.version}`) {
    throw new Error('Official Desktop pnpm version differs from the pinned workspace');
  }
  return paths;
}
