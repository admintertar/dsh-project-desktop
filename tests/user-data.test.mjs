import test from 'node:test';
import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {resolveUserData} from '../src/app/user-data.mjs';

const appData = '/tmp/application-support';

test('a normal launch keeps the per-user default, and an isolated directory replaces it', () => {
  assert.equal(resolveUserData({appData, environment: {}}), join(appData, 'dsh-project-desktop'));
  assert.equal(resolveUserData({appData, environment: {DSH_PROJECT_DESKTOP_USER_DATA: '/tmp/dsh-dev'}}), resolve('/tmp/dsh-dev'));
  assert.equal(resolveUserData({appData, environment: {DSH_PROJECT_DESKTOP_USER_DATA: 'relative/dev'}}), resolve('relative/dev'));
  // An empty override is not an override; the default still wins.
  assert.equal(resolveUserData({appData, environment: {DSH_PROJECT_DESKTOP_USER_DATA: ''}}), join(appData, 'dsh-project-desktop'));
});

test('testing modes keep their harness directory and cannot be redirected by the development override', () => {
  const environment = {DSH_PROJECT_DESKTOP_SMOKE_DATA: '/tmp/dsh-smoke', DSH_PROJECT_DESKTOP_USER_DATA: '/tmp/dsh-dev'};
  assert.equal(resolveUserData({testing: true, appData, environment}), resolve('/tmp/dsh-smoke'));
  assert.throws(() => resolveUserData({testing: true, appData, environment: {}}), /DSH_PROJECT_DESKTOP_SMOKE_DATA/);
});

test('the installation check keeps its own temporary directory', () => {
  const temporaryDirectory = () => '/tmp/dsh-project-install-check-fixture';
  assert.equal(resolveUserData({installationCheck: true, testing: true, appData, environment: {}, temporaryDirectory}), temporaryDirectory());
  assert.equal(resolveUserData({installationCheck: true, appData, environment: {}, temporaryDirectory}), temporaryDirectory());
});
