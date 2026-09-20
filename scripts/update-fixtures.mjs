import {createHash} from 'node:crypto';
import {createUpdateManifest} from '../src/app/update-manifest.mjs';

/** Synthetic release responses for deterministic checks; never a production update source. */
export function updateFixture(version = '0.1.1', platform = 'darwin') {
  const body = Buffer.alloc(512);
  if (platform === 'darwin') body.write('koly');
  else {body.write('MZ'); body.writeUInt32LE(64, 0x3c); body.write('PE\0\0', 64)}
  const hash = createHash('sha256').update(body).digest('hex');
  const name = `DSH-Project-Desktop-${version}-${platform === 'darwin' ? 'mac-universal.dmg' : 'win-x64-Setup.exe'}`;
  const checksum = `${hash}  ${name}\n`;
  const assets = ['mac-universal.dmg', 'win-x64-Setup.exe', 'win-x64-Portable.zip'].map(suffix => ({
    name: `DSH-Project-Desktop-${version}-${suffix}`, size: body.length, digest: 'sha256:' + hash,
  }));
  const release = createUpdateManifest(assets, version, 'a'.repeat(40));
  return {body, hash, name, checksum, release, assets, platform};
}
