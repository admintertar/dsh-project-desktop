import {createHash} from 'node:crypto';

/** Synthetic release responses for deterministic checks; never a production update source. */
export function updateFixture(version = '0.1.1', platform = 'darwin') {
  const body = Buffer.alloc(512);
  if (platform === 'darwin') body.write('koly');
  else {body.write('MZ'); body.writeUInt32LE(64, 0x3c); body.write('PE\0\0', 64)}
  const hash = createHash('sha256').update(body).digest('hex');
  const name = `DSH-Project-Desktop-${version}-${platform === 'darwin' ? 'mac-universal.dmg' : 'win-x64-Setup.exe'}`;
  const checksum = `${hash}  ${name}\n`;
  const base = 'https://github.com/admintertar/dsh-project-desktop';
  const release = {tag_name: `v${version}`, draft: false, prerelease: false, published_at: '2026-09-19T00:00:00Z',
    html_url: `${base}/releases/tag/v${version}`, assets: [
      {id: 1, name, size: body.length, digest: 'sha256:' + hash, state: 'uploaded', browser_download_url: `${base}/releases/download/v${version}/${name}`},
      {id: 2, name: name + '.sha256', size: Buffer.byteLength(checksum), state: 'uploaded', browser_download_url: `${base}/releases/download/v${version}/${name}.sha256`},
    ]};
  return {body, hash, name, checksum, release};
}
