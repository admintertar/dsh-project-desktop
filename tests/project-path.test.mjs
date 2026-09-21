import assert from 'node:assert/strict';
import {test} from 'node:test';
import {projectPathPreview} from '../src/shared/project-path.mjs';

test('the create guide previews the Windows project path with one separator style', () => {
  assert.equal(projectPathPreview('D:\\DevelopProjiectluss', 'uss', 'win32'), 'D:\\DevelopProjiectluss\\uss');
  assert.equal(projectPathPreview('D:\\Develop\\uss\\', 'app', 'win32'), 'D:\\Develop\\uss\\app');
  // Typed forward slashes are shown the way node:path.join creates the folder.
  assert.equal(projectPathPreview('D:/Develop/uss', 'app', 'win32'), 'D:\\Develop\\uss\\app');
  assert.equal(projectPathPreview('C:\\', 'app', 'win32'), 'C:\\app');
  assert.equal(projectPathPreview('\\\\server\\share\\team', 'app', 'win32'), '\\\\server\\share\\team\\app');
  assert.equal(projectPathPreview('D:\\Develop\\uss', '', 'win32'), 'D:\\Develop\\uss');
});

test('other platforms keep their separator and root', () => {
  assert.equal(projectPathPreview('/Users/me/projects', 'app', 'darwin'), '/Users/me/projects/app');
  assert.equal(projectPathPreview('/Users/me/projects/', 'app', 'darwin'), '/Users/me/projects/app');
  assert.equal(projectPathPreview('/', 'app', 'linux'), '/app');
  assert.equal(projectPathPreview('/Users/me/projects', '', 'darwin'), '/Users/me/projects');
});

test('an empty location never emits a leading separator', () => {
  assert.equal(projectPathPreview('', 'app', 'win32'), 'app');
  assert.equal(projectPathPreview('  ', 'app', 'darwin'), 'app');
  assert.equal(projectPathPreview('', '', 'win32'), '');
});
