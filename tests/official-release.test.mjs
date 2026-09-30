import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {packagingPlan} from '../scripts/ci-plan.mjs';
import {collectReleaseAssets} from '../scripts/publish-release.mjs';
import {createUpdateManifest, parseUpdateManifest} from '../src/app/update-manifest.mjs';
import {ProjectReleaseUpdater} from '../src/desktop-adapter/official/project-release-updater.mjs';
const read = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url)));
const official = read('official-source.lock.json'), project = read('project-source.lock.json');
const version = '0.2.0', commit = 'b'.repeat(40);
test('release matrix rejects community sources and mismatched tags, and uses three native hosts', () => {
  assert.deepEqual(JSON.parse(packagingPlan(official, project, version).matrix).include.map(t => t.target), ['mac-arm64', 'mac-x64', 'win-x64']);
  assert.equal(JSON.parse(packagingPlan(official, project, version, 'win').matrix).include[0].shell, 'pwsh');
  assert.throws(() => packagingPlan({...official, repository: 'https://github.com/anywhere/dsh-desktop.git'}, project, version), /DeepSeek/);
  assert.throws(() => packagingPlan(official, {...project, commit: 'master'}, version), /full commit/);
  assert.throws(() => packagingPlan(official, project, version, 'all', 'refs/tags/v0.1.11'), /tag must match/);
});
function fixture(root) {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']]) {
    const directory = join(root, `${platform}-${arch}`); mkdirSync(directory);
    const bytes = Buffer.from('Verified fixture ' + platform + arch), sha = createHash('sha256').update(bytes).digest('hex');
    const suffixes = platform === 'darwin' ? [`mac-${arch}.dmg`] : ['win-x64-Setup.exe', 'win-x64-Portable.zip'];
    for (const suffix of suffixes) {
      const name = `DSH-Project-Desktop-${version}-${suffix}`;
      writeFileSync(join(directory, name), bytes); writeFileSync(join(directory, name + '.sha256'), `${sha}  ${name}\n`);
    }
    writeFileSync(join(directory, 'package-result.json'), JSON.stringify({platform, arch, sourceCommit: commit, sourceHasLocalChanges: false,
      officialCommit: official.commit, projectCommit: project.commit,
      bytes: platform === 'darwin' ? bytes.length : {installer: bytes.length, portable: bytes.length},
      sha256: platform === 'darwin' ? sha : {installer: sha, portable: sha},
      validation: {ok: true, packaged: true, platform, arch, version, officialCommit: official.commit, projectCommit: project.commit}}));
  }
}
test('publisher requires all verified targets and refuses tampered packages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-release-test-'));
  try {
    fixture(root); const assets = collectReleaseAssets(root, version, commit);
    assert.equal(assets.length, 8); const manifest = createUpdateManifest(assets, version, commit);
    assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.assets.length, 4);
    assert.deepEqual(parseUpdateManifest(manifest), manifest);
    for (const arch of ['arm64', 'x64']) {
      const updater = new ProjectReleaseUpdater({directory: root, platform: 'darwin', arch, request: async () => Response.json(manifest)});
      try {await updater.checkForUpdates(); assert.ok(updater.candidate.installer.name.endsWith(`mac-${arch}.dmg`));} finally {updater.dispose()}
    }
    writeFileSync(assets[0].path, 'tampered');
    assert.throws(() => collectReleaseAssets(root, version, commit));
  } finally {rmSync(root, {recursive: true, force: true})}
});
