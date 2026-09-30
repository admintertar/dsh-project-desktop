import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile, readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {parse, stringify} from 'yaml';
import {runtimeDirectory} from '../src/desktop-adapter/official/paths.mjs';
import {officialCredentials} from '../src/desktop-adapter/official/credential-runtime.mjs';
import {accountCredentialProvider, ACCOUNT_GRANT, ACCOUNT_DEVICE} from '../src/desktop-adapter/official/account-credentials.mjs';
import {prepareSharedAccountStore} from '../src/desktop-adapter/official/shared-account-store.mjs';
import {sharedAccountProfile} from '../src/desktop-adapter/official/account-profile.mjs';

const official = await officialCredentials(runtimeDirectory());
const {applyEntryPatches} = await import(pathToFileURL(join(runtimeDirectory(), 'dsh/node_modules/@deepseek-ai/cordis-plugin-include/lib/index.js')).href);
const grant = {kind: 'grant', payload: {version: 1, issuer: 'https://platform.deepseek.com', token: 'fixture-only'}};
const device = {kind: 'grant', payload: {id: 'fixture-device'}};
const until = async predicate => {
  for (let n = 0; n < 100; n++) {if (await predicate()) return; await delay(25)}
  throw new Error('Shared account did not converge');
};

test('real official providers share only account records, hot-sync deletion, and survive closing one Host', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shell-shared-account-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const Shared = accountCredentialProvider(official, join(root, 'shared.yaml'));
  const boot = async id => {
    const ctx = new official.Context();
    const fiber = ctx.plugin(Shared, {path: join(root, id + '.yaml')});
    t.after(() => fiber.dispose());
    await fiber;
    return {ctx, store: ctx.credentials, close: () => fiber.dispose()};
  };
  const a = await boot('a'), b = await boot('b');
  let updates = 0, signOuts = 0;
  b.ctx.on('credentials/record-updated', key => {if (key === ACCOUNT_GRANT) updates++});
  b.ctx.on('deepseek-account/signed-out', () => signOuts++);
  await a.store.set('PROJECT_ACCOUNT_TEST_KEY', 'project-a');
  await a.store.modifyRecord('client-connection/browser-session', async () => ({kind: 'grant', payload: {secret: 'host-a'}}));
  await a.store.modifyRecord(ACCOUNT_DEVICE, async () => device);
  await a.store.modifyRecord(ACCOUNT_GRANT, async () => grant);
  await until(async () => (await b.store.describeRecord(ACCOUNT_GRANT)).configured);
  assert.deepEqual(await b.store.readRecord(ACCOUNT_GRANT), grant);
  assert.deepEqual(await b.store.readRecord(ACCOUNT_DEVICE), device);
  assert.equal(await b.store.resolve('PROJECT_ACCOUNT_TEST_KEY'), undefined);
  assert.equal(await b.store.readRecord('client-connection/browser-session'), undefined);
  assert.ok(updates > 0);
  assert.deepEqual((await b.store.listRecords()).map(row => row.key).sort(), [ACCOUNT_GRANT, ACCOUNT_DEVICE].sort());
  const c = await boot('c');
  assert.deepEqual(await c.store.readRecord(ACCOUNT_GRANT), grant);
  await a.close();
  await c.store.deleteRecord(ACCOUNT_GRANT);
  await until(async () => !(await b.store.describeRecord(ACCOUNT_GRANT)).configured && signOuts > 0);
  const reopened = await boot('a');
  assert.equal(await reopened.store.readRecord(ACCOUNT_GRANT), undefined);
  assert.equal((await reopened.store.resolve('PROJECT_ACCOUNT_TEST_KEY')).value, 'project-a');
  const raw = official.parseCredentialsDocument(await readFile(join(root, 'shared.yaml'), 'utf8'), 'fixture');
  assert.equal(raw.refs.size, 0);
  assert.deepEqual([...raw.records.keys()], [ACCOUNT_DEVICE]);
  if (process.platform !== 'win32') assert.equal((await stat(join(root, 'shared.yaml'))).mode & 0o777, 0o600);
});

async function seedProject(root, id, records) {
  const home = join(root, 'projects', id, 'dsh');
  await mkdir(home, {recursive: true});
  await writeFile(join(home, 'official-shell.json'), JSON.stringify({schemaVersion: 1, sourceCommit: 'official'}));
  await writeFile(join(home, '.credentials.yaml'), stringify({version: 1, refs: {PRIVATE_KEY: 'local'}, records}), {mode: 0o600});
}

test('one-time migration adopts the existing login and never resurrects it after sign-out', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shell-account-migrate-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await seedProject(root, 'a', {[ACCOUNT_GRANT]: grant, [ACCOUNT_DEVICE]: device,
    'client-connection/browser-session': {kind: 'grant', payload: {secret: 'private'}}});
  const options = {userData: root, sourceCommit: 'official', credentials: official};
  const path = await prepareSharedAccountStore(options);
  const adopted = official.parseCredentialsDocument(await readFile(path, 'utf8'), 'shared');
  assert.equal(adopted.refs.size, 0);
  assert.deepEqual([...adopted.records.keys()].sort(), [ACCOUNT_GRANT, ACCOUNT_DEVICE].sort());
  await writeFile(path, 'version: 1\nrecords: {}\n', {mode: 0o600});
  await prepareSharedAccountStore(options);
  assert.equal(official.parseCredentialsDocument(await readFile(path, 'utf8'), 'shared').records.size, 0);
});

test('conflicting legacy logins are not silently replaced', async t => {
  const root = await mkdtemp(join(tmpdir(), 'shell-account-conflict-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await seedProject(root, 'a', {[ACCOUNT_GRANT]: grant});
  await seedProject(root, 'b', {[ACCOUNT_GRANT]: {...grant, payload: {...grant.payload, token: 'other-fixture'}}});
  await assert.rejects(prepareSharedAccountStore({userData: root, sourceCommit: 'official', credentials: official}), /Multiple project sign-ins/);
});

test('the real official patch algorithm disables the original provider and inserts the account adapter once', () => {
  const source = '# preserve this comment\n- id: credentials\n  config:\n    path: /project/private-credentials.yaml\n';
  const adapter = 'file:///shell/shared-credentials-host.mjs';
  const text = sharedAccountProfile(source, adapter);
  assert.match(text, /preserve this comment/);
  assert.equal(sharedAccountProfile(text, adapter), text);
  const warnings = [];
  const resolved = applyEntryPatches([{id: 'credentials', name: '@deepseek-ai/dsh-credentials-local'}], parse(text), (...args) => warnings.push(args));
  assert.deepEqual(warnings, []);
  assert.equal(resolved[0].disabled, true);
  assert.equal(resolved[1].name, adapter);
  assert.equal(resolved[1].config.path, '/project/private-credentials.yaml');
});
