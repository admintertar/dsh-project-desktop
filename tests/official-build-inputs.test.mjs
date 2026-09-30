import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {officialBuildInputs} from '../src/desktop-adapter/official/build-inputs.mjs';
import {verifyOfficialDevelopment} from '../scripts/prepare-official-development.mjs';

test('official build inputs require matching packages and complete Host/Web outputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-official-build-inputs-'));
  const pin = {repository: 'https://github.com/deepseek-ai/deepseek-harness.git', version: '0.2.0-rc.2'};
  const write = (relative, content = '') => {
    const path = join(root, relative);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content);
  };
  try {
    for (const [directory, name] of [
      ['apps/desktop', '@deepseek-ai/dsh-desktop'], ['apps/desktop-host', '@deepseek-ai/dsh-desktop-host'],
      ['apps/cli', '@deepseek-ai/dsh'], ['apps/web', '@deepseek-ai/dsh-web-frontend'],
    ]) write(`${directory}/package.json`, JSON.stringify({name, version: pin.version}));
    write('package.json', JSON.stringify({version: pin.version, packageManager: 'pnpm@11.7.0'}));
    for (const path of ['apps/desktop/src/web-document.ts', 'apps/desktop/lib/main.js',
      'apps/desktop/lib/preload-app.cjs', 'apps/desktop-host/lib/index.js', 'apps/cli/lib/bin.js',
      'node_modules/.pnpm/node_modules/placeholder', 'apps/desktop/node_modules/electron/index.js',
      'packages/skill/skill-office/assets/placeholder', 'LICENSE', 'apps/web/dist/index.html']) write(path);
    write('apps/desktop/node_modules/pnpm/package.json', JSON.stringify({version: '11.7.0'}));
    const result = officialBuildInputs(root, pin);
    assert.equal(result.hostEntry, join(root, 'apps/desktop-host/lib/index.js'));
    assert.equal(result.webDist, join(root, 'apps/web/dist'));
    write('apps/desktop-host/package.json', JSON.stringify({name: 'dsh-plugin-desktop', version: pin.version}));
    assert.throws(() => officialBuildInputs(root, pin), /Official package differs/);
    assert.throws(() => officialBuildInputs(root, {...pin, repository: 'https://github.com/anywhere-labs/dsh-desktop.git'}), /DeepSeek source pin/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('official development inventory rejects changed or extra staged files', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-official-staging-'));
  const pin = JSON.parse(readFileSync(new URL('../official-source.lock.json', import.meta.url), 'utf8'));
  const content = 'official web';
  const inventory = {kind: 'official-development', repository: pin.repository, commit: pin.commit,
    version: pin.version, desktopTree: pin.desktopTree, dependencyLockBlob: pin.dependencyLockBlob,
    files: [{path: 'web/index.html', sha256: createHash('sha256').update(content).digest('hex')}]};
  try {
    mkdirSync(join(root, 'web'));
    writeFileSync(join(root, 'web/index.html'), content);
    writeFileSync(join(root, 'inputs.json'), JSON.stringify(inventory));
    assert.deepEqual(verifyOfficialDevelopment(root), inventory);
    writeFileSync(join(root, 'web/index.html'), 'modified web');
    assert.throws(() => verifyOfficialDevelopment(root), /staged files changed/);
    writeFileSync(join(root, 'web/index.html'), content);
    writeFileSync(join(root, 'web/extra.js'), 'extra');
    assert.throws(() => verifyOfficialDevelopment(root), /staged files changed/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
