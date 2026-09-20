/** Public, dependency-free contract shared by the app and release publisher. */
export const releaseRepository = 'admintertar/dsh-project-desktop';
export const releasesPage = `https://github.com/${releaseRepository}/releases`;
export const updateManifestName = 'update.json';
export const latestUpdateManifestUrl = `${releasesPage}/latest/download/${updateManifestName}`;
export const versionUpdateManifestUrl = version => `${releasesPage}/download/v${version}/${updateManifestName}`;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseUpdateManifest(value) {
  if (value?.schemaVersion !== 1 || value.channel !== 'stable' || typeof value.version !== 'string'
    || !stableVersion.test(value.version) || !/^[a-f0-9]{40}$/.test(value.sourceCommit)
    || value.releaseUrl !== `${releasesPage}/tag/v${value.version}` || !Array.isArray(value.assets)) {
    throw new Error('Invalid stable Project Desktop update manifest');
  }
  const assets = ['mac-universal.dmg', 'win-x64-Setup.exe', 'win-x64-Portable.zip'].map(suffix => {
    const name = `DSH-Project-Desktop-${value.version}-${suffix}`;
    const matches = value.assets.filter(item => item?.name === name);
    if (matches.length !== 1) throw new Error('The update manifest is missing an unambiguous package');
    const item = matches[0];
    if (!Number.isSafeInteger(item.size) || item.size <= 0 || !/^[a-f0-9]{64}$/.test(item.sha256)
      || item.url !== `${releasesPage}/download/v${value.version}/${name}`) {
      throw new Error('Invalid Project Desktop update package');
    }
    return {name, url: item.url, size: item.size, sha256: item.sha256};
  });
  if (value.assets.length !== assets.length) throw new Error('Unexpected update manifest package');
  return {schemaVersion: 1, channel: 'stable', version: value.version, sourceCommit: value.sourceCommit,
    releaseUrl: value.releaseUrl, assets};
}

/** Input is the publisher's already verified distribution assets, never paths or logs. */
export function createUpdateManifest(assets, version, sourceCommit) {
  return parseUpdateManifest({schemaVersion: 1, channel: 'stable', version, sourceCommit,
    releaseUrl: `${releasesPage}/tag/v${version}`,
    assets: assets.filter(asset => !asset.name.endsWith('.sha256')).map(asset => ({
      name: asset.name, size: asset.size, sha256: asset.digest?.replace(/^sha256:/, ''),
      url: `${releasesPage}/download/v${version}/${asset.name}`,
    })),
  });
}
