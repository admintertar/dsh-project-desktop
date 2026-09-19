import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync} from 'node:fs';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {parse, stringify} from 'yaml';
import {createProjectInDirectory} from '../src/app/project-files.mjs';
import {repository} from '../src/desktop-adapter/paths.mjs';
import {startProjectHost} from '../src/desktop-adapter/index.mjs';
import {materializeProjectDependencies} from '../src/desktop-adapter/stable/materialize.mjs';
import {captureProjectCheckpoint, createProjectRecovery, assertProjectRecoveryComplete} from '../src/desktop-adapter/stable/recovery.mjs';

mkdirSync(join(repository, '.runtime'), {recursive: true});
const root = mkdtempSync(join(repository, '.runtime/network-recovery-'));
process.env.PNPM_HOME = join(root, 'pnpm');
process.env.XDG_CONFIG_HOME = join(root, 'config');
const store = join(root, 'store');
let offline = false, corruptArchive = false, upstreamRequests = 0, downloadedBytes = 0, rejectedRequests = 0;
const server = createServer(async (req, res) => {
  if (offline) {rejectedRequests++; res.writeHead(503); res.end('Deliberate acceptance-test outage'); return}
  try {
    if (!['/is-number', '/is-number/-/is-number-7.0.0.tgz'].includes(req.url)) throw new Error('Unexpected registry request: ' + req.url);
    const upstream = await fetch('https://registry.npmjs.org' + req.url, {signal: AbortSignal.timeout(30000)});
    assert.equal(upstream.status, 200); upstreamRequests++;
    let body = Buffer.from(await upstream.arrayBuffer()); downloadedBytes += body.length;
    if (corruptArchive && req.url.endsWith('.tgz')) body = Buffer.from('deliberately damaged acceptance-test archive');
    if (req.url === '/is-number') {
      const metadata = JSON.parse(body);
      for (const version of Object.values(metadata.versions)) if (version.dist?.tarball) {
        version.dist.tarball = version.dist.tarball.replace('https://registry.npmjs.org', registry);
      }
      body = Buffer.from(JSON.stringify(metadata));
    }
    res.writeHead(200, {'content-type': req.url.endsWith('.tgz') ? 'application/octet-stream' : 'application/json'}); res.end(body);
  } catch (error) {res.writeHead(502); res.end(error.message)}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const registry = `http://127.0.0.1:${server.address().port}`;
const projectRoot = join(root, 'Fixture'); mkdirSync(projectRoot);
const manifestPath = await createProjectInDirectory(projectRoot), stateDirectory = join(root, 'state');
let host, recovery;
const state = {manifestPath, projectRoot, stateDirectory};
try {
  host = await startProjectHost(state);
  const {homeDir, profile: profileDir} = host.result; await host.close(); host = undefined;
  const options = {stateDirectory, homeDir, profileDir};
  const packagePath = join(profileDir, 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath)); manifest.dependencies['is-number'] = '7.0.0';
  writeFileSync(packagePath, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(profileDir, '.npmrc'), `registry=${registry}\n`);
  const workspacePath = join(profileDir, 'pnpm-workspace.yaml');
  writeFileSync(workspacePath, stringify({...parse(readFileSync(workspacePath, 'utf8')), storeDir: store,
    cacheDir: join(root, 'metadata'), fetchRetries: 0, fetchTimeout: 10000, verifyStoreIntegrity: true, packageImportMethod: 'copy'}));
  await materializeProjectDependencies({...options, updateLockfile: true});
  host = await startProjectHost(state); await host.close(); host = undefined;
  await captureProjectCheckpoint(stateDirectory);
  recovery = await createProjectRecovery(state);
  const slot = recovery.list()[0].id;
  const replaceModules = name => renameSync(join(profileDir, 'node_modules'), join(root, name));
  const restore = async () => recovery.restore((await recovery.preview(slot)).previewId);
  const alter = () => {const current = JSON.parse(readFileSync(packagePath)); current.description = 'damaged declaration'; writeFileSync(packagePath, JSON.stringify(current))};
  // Truly empty store: all registry bytes must cross the network.
  replaceModules('initial-modules'); renameSync(store, join(root, 'initial-store')); alter();
  const beforeCold = upstreamRequests; await restore(); assertProjectRecoveryComplete(stateDirectory);
  assert.ok(upstreamRequests > beforeCold, 'cold rebuild must download');
  const installed = createRequire(packagePath)('is-number'); assert.equal(installed('42'), true);
  // Damage exactly one content-addressed file in the isolated pnpm store.
  const expected = readFileSync(createRequire(packagePath).resolve('is-number'));
  function findContent(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {const found = findContent(path); if (found) return found}
      else if (entry.isFile() && readFileSync(path).equals(expected)) return path;
    }
  }
  cpSync(join(root, 'initial-store'), store, {recursive: true});
  const corrupted = findContent(store); assert.ok(corrupted, 'pnpm content store entry');
  writeFileSync(corrupted, Buffer.alloc(expected.length, 120));
  replaceModules('cold-modules'); alter();
  const beforeRepair = upstreamRequests; await restore();
  assert.ok(upstreamRequests > beforeRepair, 'corrupt cache must re-download verified bytes');
  assert.deepEqual(readFileSync(createRequire(packagePath).resolve('is-number')), expected);
  // A real refused registry response leaves the project blocked until explicit retry.
  replaceModules('repaired-modules'); alter(); offline = true;
  await assert.rejects(restore(), error => error.operationStage === 'dependency-materialization' && /503/.test(error.diagnosticDetail));
  assert.ok(rejectedRequests > 0); assert.throws(() => assertProjectRecoveryComplete(stateDirectory), /incomplete/);
  await assert.rejects(startProjectHost(state), /incomplete/);
  offline = false; corruptArchive = true;
  await assert.rejects(restore(), error => error.operationStage === 'dependency-materialization' && /integrity|TARBALL/i.test(error.diagnosticDetail));
  assert.throws(() => assertProjectRecoveryComplete(stateDirectory), /incomplete/);
  corruptArchive = false; await restore(); assertProjectRecoveryComplete(stateDirectory);
  host = await startProjectHost(state);
  assert.equal((await host.request('/api/project/snapshot')).status, 200);
  const result = {ok: true, electron: process.versions.electron, upstreamRequests, downloadedBytes, rejectedRequests,
    checks: ['real-registry-cold-store', 'frozen-checkpoint-rebuild', 'corrupt-cache-bypassed-and-redownloaded', '503-blocks-host', 'damaged-download-rejected', 'explicit-retry', 'real-project-host-after-rebuild'], evidence: root};
  writeFileSync(join(root, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally {await host?.close(); recovery?.dispose(); await new Promise(resolve => server.close(resolve))}
