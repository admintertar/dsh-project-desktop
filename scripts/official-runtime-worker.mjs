/**
 * Development-only adaptation of official apps/desktop/scripts/prepare-dsh.ts.
 * Reuse its package metadata, install policy, filtering, descriptors and smoke
 * checks. Omit Developer ID signing, preserve the generated dependency lock,
 * and write only Shell-owned build directories. This is not a release package.
 */
import {execFileSync, spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyOfficialPackageSet} from './prepare-official-package-set.mjs';
import {verifyOfficialSource} from './verify-official-source.mjs';
import {bindOfficialRuntimeLock} from './bind-official-runtime-lock.mjs';
import {inventoryOfficialPayload, verifyOfficialRuntimePayload} from '../src/desktop-adapter/official/runtime-payload.mjs';
import {build} from 'esbuild';
import {buildOfficialNative} from './build-official-native.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const {source, pin} = verifyOfficialSource(process.argv[2]);
const load = path => import(pathToFileURL(join(source, path)).href);
const [project, core, trees, policy, manifests, primary, smoke, paths, protocol, releaseModule, environment, office] = await Promise.all([
  load('apps/desktop/src/project-manager.ts'), load('apps/desktop/src/core-package-set.ts'),
  load('apps/desktop/src/runtime-tree.ts'), load('apps/desktop/scripts/runtime-file-policy.ts'),
  load('apps/desktop/scripts/prepare-runtime-manifests.ts'), load('apps/desktop/scripts/prepare-primary-runtime.ts'),
  load('apps/desktop/scripts/smoke-prepared-runtime.ts'), load('apps/desktop/scripts/desktop-build-paths.mjs'),
  load('apps/desktop/src/host-protocol.ts'), load('apps/desktop/src/release.ts'),
  load('apps/desktop/src/node-environment.ts'), load('scripts/libreoffice-packages.mjs'),
]);
// Match the running process explicitly; inherited release-target overrides must
// never redirect this development job to another target or user's profile.
const target = paths.resolveDesktopBuildTarget({}, process.platform, process.arch);
const targetPlatform = paths.desktopTargetPlatform(target);
const buildPaths = paths.desktopTargetBuildPaths(target);
const node = join(buildPaths.electron, process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron');
const versions = JSON.parse(readFileSync(join(buildPaths.runtime, 'versions.json'), 'utf8'));
const executableVersions = JSON.parse(execFileSync(node, ['-p', 'JSON.stringify(process.versions)'],
  {encoding: 'utf8', env: {...process.env, ELECTRON_RUN_AS_NODE: '1'}}));
const pnpmVersion = JSON.parse(readFileSync(join(source, 'apps/desktop/node_modules/pnpm/package.json'), 'utf8')).version;
const electronVersion = JSON.parse(readFileSync(join(source, 'apps/desktop/node_modules/electron/package.json'), 'utf8')).version;
if (executableVersions.node !== versions.node || executableVersions.electron !== electronVersion || versions.pnpm !== pnpmVersion) {
  throw new Error('Prepared Electron/Node/pnpm resources differ from the official build inputs');
}
const primaryManifest = JSON.parse(readFileSync(join(buildPaths.runtime, 'primary-runtime/runtime.json'), 'utf8'));
const primaryLock = JSON.parse(readFileSync(join(source, 'scripts/primary-runtime/lock.json'), 'utf8'));
const {primaryRuntimePayloadDigest} = await load('scripts/primary-runtime/prepare.ts');
if (primaryManifest.desktopVersion !== pin.version || primaryManifest.platform !== process.platform
  || primaryManifest.arch !== process.arch || primaryManifest.payloadDigest !== primaryRuntimePayloadDigest(target, primaryLock, pnpmVersion)) {
  throw new Error('Prepared primary runtime differs from the official source and target');
}
const release = releaseModule.parseDesktopRelease({schemaVersion: 1, version: pin.version,
  hostProtocolVersion: protocol.DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: versions.node, pnpmVersion: versions.pnpm});
const set = join(repository, '.cache/official-package-set');
const verified = verifyOfficialPackageSet(source, set);
const install = mkdtempSync(join(repository, `.cache/official-runtime-install-${target}-`));
const store = join(repository, '.cache/official-runtime-store', target);
const destination = join(repository, '.cache/official-runtime', target);
const staging = `${destination}.building-${process.pid}`;
const scrubbed = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/KEY|TOKEN|SECRET|PASSWORD/iu.test(name) && !/^(?:npm|pnpm|corepack|DSH_DESKTOP)_/iu.test(name)
  && !['NODE_OPTIONS', 'NODE_PATH'].includes(name)));
const config = join(install, '.build-config');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Invoke the bundled pnpm using Electron's exact Node ABI and the official node launcher. */
async function pnpm(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(node, ['--expose-internals', join(buildPaths.runtime, 'pnpm/bin/pnpm.mjs'),
      '--config.registry=https://registry.npmjs.org/', `--config.store-dir=${store}`,
      '--config.enable-global-virtual-store=false', `--config.userconfig=${join(config, 'npmrc')}`, ...args], {
      cwd: install, stdio: 'inherit', timeout: 600000,
      env: {...environment.desktopNodeEnvironment(node, join(buildPaths.runtime, 'bin'), scrubbed),
        NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/', NPM_CONFIG_USERCONFIG: join(config, 'npmrc'),
        XDG_CACHE_HOME: join(config, 'cache'), XDG_CONFIG_HOME: config, XDG_STATE_HOME: join(config, 'state')},
    });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error(`Runtime pnpm exited ${code ?? signal}`)));
  });
}

try {
  mkdirSync(config, {recursive: true});
  writeFileSync(join(config, 'npmrc'), '');
  cpSync(join(set, core.DESKTOP_PACKAGE_SET_FILE), join(install, core.DESKTOP_PACKAGE_SET_FILE));
  cpSync(join(set, core.DESKTOP_PACKAGES_DIR), join(install, core.DESKTOP_PACKAGES_DIR), {recursive: true});
  project.createRuntimeProjectMetadata(install, release);
  const {body: lock} = bindOfficialRuntimeLock(join(repository, 'official-runtime-locks', target), set,
    {pin, release, target});
  writeFileSync(join(install, 'pnpm-lock.yaml'), lock);
  core.verifyDesktopCoreLockfile(lock, core.readDesktopCorePackageSet(install, pin.version));
  await pnpm(['install', '--prod', '--frozen-lockfile', '--trust-lockfile']);
  rmSync(staging, {recursive: true, force: true});
  mkdirSync(staging, {recursive: true});
  try {
    const dsh = join(staging, 'dsh');
    const modules = join(install, 'node_modules');
    const officeManifest = JSON.parse(readFileSync(join(modules, '@deepseek-ai/libreoffice-kit/package.json'), 'utf8'));
    const officeEngine = office.selectOfficeEngine(officeManifest, targetPlatform);
    cpSync(modules, join(dsh, 'node_modules'), {recursive: true, dereference: true,
      filter: path => policy.desktopRuntimeFileExclusion(relative(modules, path), targetPlatform, officeEngine) === undefined});
    const packageSet = core.readDesktopCorePackageSet(install, pin.version);
    writeFileSync(join(dsh, 'package.json'), JSON.stringify({name: '@deepseek-ai/dsh-desktop-runtime', private: true,
      version: pin.version, type: 'module', dependencies: Object.fromEntries(packageSet.packages.map(p => [p.name, p.version]))}, null, 2) + '\n');
    for (const file of core.DESKTOP_HOST_RUNTIME_FILES) {
      if (!existsSync(join(dsh, 'node_modules', core.DESKTOP_HOST_PACKAGE, file))) throw new Error(`Missing Host file ${file}`);
    }
    if (!existsSync(join(dsh, 'node_modules', `@deepseek-ai/libreoffice-kit-${officeEngine}`, 'prebuilds.json'))) {
      throw new Error(`Missing Office engine ${officeEngine}`);
    }
    cpSync(buildPaths.runtime, join(staging, 'runtime'), {recursive: true, dereference: true});
    cpSync(buildPaths.electron, join(staging, 'electron'), {recursive: true, verbatimSymlinks: true});
    // Carry the same official Web/preload inputs as the earlier linked probe,
    // so consumers need no source workspace paths for the window resources.
    const desktop = join(staging, 'desktop');
    mkdirSync(desktop);
    cpSync(join(source, 'apps/web/dist'), join(desktop, 'web'), {recursive: true});
    for (const name of ['preload-app.cjs', 'preload-platform-account.cjs']) {
      cpSync(join(source, 'apps/desktop/lib', name), join(desktop, name));
    }
    cpSync(join(source, 'LICENSE'), join(staging, 'LICENSE'));
    writeFileSync(join(staging, 'package.json'), JSON.stringify({name: '@deepseek-ai/dsh-official-runtime', version: pin.version, type: 'module'}) + '\n');
    await build({entryPoints: [join(source, 'apps/desktop/src/web-document.ts')], outfile: join(desktop, 'web-document.mjs'),
      bundle: true, platform: 'node', format: 'esm', target: 'node22'});
    // Shell 的项目窗口直接复用官方 Desktop 的 Host 生命周期；把官方源码编译进
    // payload 后，启动时不需要读取官方工作树，也不会落回社区 dsh-desktop 模块。
    const official = join(staging, 'official');
    mkdirSync(official);
    await build({entryPoints: [join(source, 'apps/desktop/src/host-process.ts')],
      outfile: join(official, 'host-process.mjs'), bundle: true, platform: 'node',
      format: 'esm', target: 'node22'});
    await build({entryPoints: [join(source, 'apps/desktop/src/web-document.ts')],
      outfile: join(official, 'web-document.mjs'), bundle: true, platform: 'node',
      format: 'esm', target: 'node22'});
    await buildOfficialNative(source, official);
    await manifests.prepareRuntimeManifests(dsh);
    // Upstream's pnpm version check inherits cwd. Keep it outside the Shell's
    // Yarn workspace so repository package-manager policy cannot affect it.
    const smokeCwd = mkdtempSync(join(tmpdir(), 'dsh-official-primary-smoke-'));
    const previousCwd = process.cwd();
    try {
      process.chdir(smokeCwd);
      primary.smokePrimaryRuntime(join(staging, 'runtime/primary-runtime'));
    } finally {process.chdir(previousCwd); rmSync(smokeCwd, {recursive: true, force: true});}
    trees.writeDesktopRuntime(dsh, release, packageSet.packages.map(p => p.name), targetPlatform);
    const descriptor = await trees.verifyDesktopRuntime(dsh, pin.version, targetPlatform);
    const stagedNode = join(staging, 'electron', process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron');
    await smoke.smokePreparedRuntime(dsh, stagedNode, join(staging, 'runtime'), descriptor);
    await trees.verifyDesktopRuntime(dsh, pin.version, targetPlatform);
    writeFileSync(join(staging, 'pnpm-lock.yaml'), lock);
    const backup = `${destination}.previous-${process.pid}`;
    if (existsSync(destination)) renameSync(destination, backup);
    try {
      renameSync(staging, destination);
      const relocatedDsh = join(destination, 'dsh');
      const relocatedNode = join(destination, 'electron', process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron');
      const relocatedDescriptor = await trees.verifyDesktopRuntime(relocatedDsh, pin.version, targetPlatform);
      await smoke.smokePreparedRuntime(relocatedDsh, relocatedNode, join(destination, 'runtime'), relocatedDescriptor);
      await trees.verifyDesktopRuntime(relocatedDsh, pin.version, targetPlatform);
      writeFileSync(join(destination, 'source.json'), JSON.stringify({schemaVersion: 1, kind: 'official-unsigned-development-runtime',
        repository: pin.repository, commit: pin.commit, version: pin.version, target, signed: false,
        desktopTree: pin.desktopTree, dependencyLockBlob: pin.dependencyLockBlob,
        packageCount: packageSet.packages.length, files: descriptor.files.length, dependencyLockSha256: hash(lock),
        packageSetSha256: verified.metadata.descriptorSha256, smoke: 'official-payload-host-office', relocated: true,
        inventory: inventoryOfficialPayload(destination)}, null, 2) + '\n');
      verifyOfficialRuntimePayload(destination, pin, target);
    } catch (error) {
      rmSync(destination, {recursive: true, force: true});
      if (existsSync(backup)) renameSync(backup, destination);
      throw error;
    }
    rmSync(backup, {recursive: true, force: true});
  } finally {rmSync(staging, {recursive: true, force: true});}
} finally {rmSync(install, {recursive: true, force: true});}
