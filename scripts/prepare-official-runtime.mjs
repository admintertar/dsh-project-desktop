/** Assemble an unsigned development runtime using the fixed official Desktop helpers. */
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, openSync, closeSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyOfficialPackageSet} from './prepare-official-package-set.mjs';
import {verifyOfficialSource} from './verify-official-source.mjs';
import {officialRuntimeTarget} from '../src/desktop-adapter/official/runtime-inputs.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));

/** Keep verbose upstream output local while reporting the stage and log location. */
async function run(command, args, cwd, log, env = process.env) {
  console.log(`Official runtime: ${log}`);
  const descriptor = openSync(log, 'w', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, {cwd, env, stdio: ['ignore', descriptor, descriptor]});
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolve()
        : reject(new Error(`Official runtime stage failed (${code ?? signal}); see ${log}`)));
    });
  } finally {closeSync(descriptor);}
}

/** Prepare resources and then materialize the production dependency tree without release signing. */
export async function prepareOfficialRuntime(source, {reuseResources = false} = {}) {
  const checked = verifyOfficialSource(source);
  verifyOfficialPackageSet(checked.source);
  const target = officialRuntimeTarget(process.platform, process.arch);
  if (!existsSync(join(repository, 'official-runtime-locks', target, 'inputs.json'))) {
    throw new Error(`No reviewed official runtime dependency lock for ${target}`);
  }
  const logs = join(repository, '.cache/official-runtime-logs');
  mkdirSync(logs, {recursive: true});
  const pnpm = join(checked.source, 'apps/desktop/node_modules/pnpm/bin/pnpm.mjs');
  if (!reuseResources) await run(process.execPath, [pnpm, '--filter', '@deepseek-ai/dsh-desktop', 'run', 'prepare:runtime'],
    checked.source, join(logs, `resources-${target}.log`), {...process.env,
      DSH_DESKTOP_TARGET_PLATFORM: process.platform, DSH_DESKTOP_TARGET_ARCH: process.arch});
  await run(process.execPath, ['--import', pathToFileURL(join(checked.source, 'node_modules/tsx/dist/loader.mjs')).href,
    join(repository, 'scripts/official-runtime-worker.mjs'), checked.source], repository, join(logs, `materialize-${target}.log`));
  verifyOfficialSource(checked.source);
  const destination = join(repository, '.cache/official-runtime', target);
  const result = JSON.parse(readFileSync(join(destination, 'source.json'), 'utf8'));
  console.log(`Prepared unsigned ${target} runtime: ${result.files} files at ${destination}`);
  return {destination, result};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const reuseResources = args.includes('--reuse-resources');
  const positional = args.filter(arg => arg !== '--reuse-resources');
  if (positional.length !== 1) throw new Error('Usage: node scripts/prepare-official-runtime.mjs <official-source> [--reuse-resources]');
  await prepareOfficialRuntime(positional[0], {reuseResources});
}
