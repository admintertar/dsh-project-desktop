/** Fixed native-target selectors and external dependency locks for official runtimes. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** Reject targets that cannot be prepared and executed by the current migration pipeline. */
export function officialRuntimeTarget(platform, arch) {
  const target = `${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}-${arch}`;
  if (!['mac-arm64', 'mac-x64', 'win-x64'].includes(target)) throw new Error(`Unsupported official runtime target: ${target}`);
  return target;
}

/** Refuse dependency resolution drift before pnpm installs or runs native build scripts. */
export function readOfficialRuntimeLock(directory, {pin, packageSetSha256, release, target}) {
  const metadata = JSON.parse(readFileSync(join(directory, 'inputs.json'), 'utf8'));
  const expected = {schemaVersion: 1, repository: pin.repository, commit: pin.commit, version: pin.version,
    target, packageSetSha256, nodeVersion: release.nodeVersion, pnpmVersion: release.pnpmVersion};
  const mismatches = Object.entries(expected).filter(([key, value]) => metadata[key] !== value)
    .map(([key, value]) => `${key}: lock=${JSON.stringify(metadata[key])}, build=${JSON.stringify(value)}`);
  if (mismatches.length) {
    throw new Error(`Official production dependency lock does not match the source, tarballs or native target: ${mismatches.join('; ')}`);
  }
  const body = readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8');
  if (createHash('sha256').update(body).digest('hex') !== metadata.lockfileSha256) {
    throw new Error('Official production dependency lock checksum changed');
  }
  return {body, metadata};
}
