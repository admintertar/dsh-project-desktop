import {lstat, mkdir, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {stringify} from 'yaml';
import {ACCOUNT_GRANT, ACCOUNT_DEVICE, isAccountRecord} from './account-credentials.mjs';

/** Read only app-owned, owner-readable credential files; never include their bytes in errors. */
async function readPrivateFile(path) {
  const info = await lstat(path).catch(error => {if (error.code !== 'ENOENT') throw error});
  if (!info) return undefined;
  if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077))) {
    throw new Error('The account store must be a private regular file');
  }
  return readFile(path, 'utf8');
}

/**
 * One-time adoption before starting any project Host. An existing shared file,
 * including an empty signed-out file, is authoritative forever: old project
 * credentials must never bring a signed-out account back on the next launch.
 */
export async function prepareSharedAccountStore({userData, sourceCommit, credentials}) {
  const directory = join(userData, 'account');
  await mkdir(directory, {recursive: true, mode: 0o700});
  if (!(await lstat(directory)).isDirectory()) throw new Error('The account directory must not be a symbolic link');
  const path = join(directory, '.credentials.yaml');
  const {withFileLock, writeFileAtomic, parseCredentialsDocument} = credentials;
  await withFileLock(path, async () => {
    const current = await readPrivateFile(path);
    if (current !== undefined) {
      const parsed = parseCredentialsDocument(current, path);
      if (parsed.refs.size || [...parsed.records.keys()].some(key => !isAccountRecord(key))) {
        throw new Error('The shared account store contains non-account credentials');
      }
      return;
    }
    const projects = join(userData, 'projects');
    const entries = await readdir(projects, {withFileTypes: true}).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return [];
    });
    let adopted;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const home = join(projects, entry.name, 'dsh');
      const info = await lstat(home).catch(error => {if (error.code !== 'ENOENT') throw error});
      if (!info?.isDirectory()) continue;
      let owner;
      try {owner = JSON.parse(await readFile(join(home, 'official-shell.json'), 'utf8'))}
      catch (error) {if (error.code === 'ENOENT') continue; throw new Error('Cannot verify the project account owner')}
      if (owner.schemaVersion !== 1 || owner.sourceCommit !== sourceCommit) continue;
      const local = await readPrivateFile(join(home, '.credentials.yaml'));
      if (local === undefined) continue;
      const records = parseCredentialsDocument(local, 'project credentials').records;
      const grant = records.get(ACCOUNT_GRANT);
      if (!grant) continue;
      if (adopted && !isDeepStrictEqual(adopted.grant, grant)) {
        throw new Error('Multiple project sign-ins were found. Sign out of the extra accounts before enabling shared sign-in.');
      }
      adopted ??= {grant, device: records.get(ACCOUNT_DEVICE)};
    }
    const records = adopted ? {[ACCOUNT_GRANT]: adopted.grant,
      ...(adopted.device ? {[ACCOUNT_DEVICE]: adopted.device} : {})} : {};
    await writeFileAtomic(path, stringify({version: 1, records}), {mode: 0o600, dirMode: 0o700});
  });
  return path;
}
