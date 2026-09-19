import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DEFAULT_PROJECT_MARKET, readProjectMarketPreference} from '../src/desktop-adapter/stable/profile.mjs';
import {createProjectMarketProfileIdentity} from '../src/desktop-adapter/stable/project-bootstrap.mjs';

test('project market inherits dsh-market and accepts only stable project overrides', () => {
  const directory = mkdtempSync(join(tmpdir(), 'project-market-'));
  const settings = join(directory, 'settings.yaml');
  assert.equal(readProjectMarketPreference(settings), DEFAULT_PROJECT_MARKET);
  writeFileSync(settings, 'locale:\n  preference: zh\n');
  assert.equal(readProjectMarketPreference(settings), DEFAULT_PROJECT_MARKET);
  writeFileSync(settings, 'dsh-project-market:\n  provider: disabled\n');
  assert.equal(readProjectMarketPreference(settings), 'disabled');
  writeFileSync(settings, 'dsh-project-market:\n  provider: community-market\n');
  assert.throws(() => readProjectMarketPreference(settings), /must be disabled or dsh-market/);
});

test('project market receives immutable current Profile identity without management methods', () => {
  const identity = createProjectMarketProfileIdentity({name: 'desktop', dir: '/tmp/project-profile'});
  assert.deepEqual(identity, {current: {name: 'desktop', dir: '/tmp/project-profile'}});
  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.current), true);
  assert.equal('select' in identity, false);
  assert.throws(() => createProjectMarketProfileIdentity(undefined), /identity is unavailable/);
});
