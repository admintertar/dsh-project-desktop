import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LastDirectories, pickRememberedDirectory} from '../src/app/last-directories.mjs';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'last-directories-'));
  return {root, file: join(root, 'last-directories.json'), directory: join(root, 'workspace')};
};

test('the remembered import directory survives a new state instance', () => {
  const f = fixture(); mkdirSync(f.directory);
  try {
    assert.equal(new LastDirectories(f.file).directory('import'), undefined);
    new LastDirectories(f.file).remember('import', f.directory);
    assert.equal(new LastDirectories(f.file).directory('import'), f.directory);
    assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')), {version: 1, paths: {import: f.directory}});
    // The in-project chooser shares the file through its own key.
    new LastDirectories(f.file).remember('resource', f.directory);
    assert.equal(new LastDirectories(f.file).directory('resource'), f.directory);
    // Unknown keys and non-directories are never stored.
    new LastDirectories(f.file).remember('elsewhere', f.directory);
    new LastDirectories(f.file).remember('import', join(f.root, 'missing'));
    assert.deepEqual(JSON.parse(readFileSync(f.file, 'utf8')).paths, {import: f.directory, resource: f.directory});
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('a directory that disappeared stops being offered but the file is kept', () => {
  const f = fixture(); mkdirSync(f.directory);
  try {
    const state = new LastDirectories(f.file);
    state.remember('import', f.directory);
    rmSync(f.directory, {recursive: true});
    assert.equal(new LastDirectories(f.file).directory('import'), undefined);
    assert.equal(existsSync(f.file), true);
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('unreadable or invalid preference files are preserved instead of blocking the guide', () => {
  const f = fixture(); mkdirSync(f.directory);
  try {
    for (const content of ['{not json', JSON.stringify({version: 2, paths: {}}), JSON.stringify({version: 1, paths: {other: f.directory}}),
      JSON.stringify({version: 1, paths: {import: ''}})]) {
      writeFileSync(f.file, content);
      assert.equal(new LastDirectories(f.file).directory('import'), undefined);
      const quarantined = readdirSync(f.root).filter(name => name.startsWith('last-directories.json.unreadable-'));
      assert.equal(quarantined.length, 1, content);
      assert.equal(readFileSync(join(f.root, quarantined[0]), 'utf8'), content);
      rmSync(join(f.root, quarantined[0]));
      // A fresh instance can start over and store a usable value again.
      new LastDirectories(f.file).remember('import', f.directory);
      assert.equal(new LastDirectories(f.file).directory('import'), f.directory);
      rmSync(f.file);
    }
  } finally {rmSync(f.root, {recursive: true, force: true})}
});

test('the chooser starts at the remembered directory and replaces it only on a real pick', async () => {
  const f = fixture(); mkdirSync(f.directory);
  const other = join(f.root, 'other'); mkdirSync(other);
  try {
    const state = new LastDirectories(f.file);
    const asked = [];
    const open = async previous => {asked.push(previous); return previous === undefined ? other : null};
    assert.equal(await pickRememberedDirectory(state, 'resource', open), other);
    assert.deepEqual(asked, [undefined]);
    assert.equal(new LastDirectories(f.file).directory('resource'), other);
    // The next attempt starts where the first one ended, and cancelling keeps it.
    assert.equal(await pickRememberedDirectory(state, 'resource', open), null);
    assert.deepEqual(asked, [undefined, other]);
    assert.equal(new LastDirectories(f.file).directory('resource'), other);
  } finally {rmSync(f.root, {recursive: true, force: true})}
});
