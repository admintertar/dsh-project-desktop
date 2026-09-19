import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sourceTree, assertSourceTree} from '../scripts/source-integrity.mjs';

test('source digest matches Git including trees, symlinks and executable modes, and detects edits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'project-source-test-'));
  try {
    const src = join(directory, 'source'); mkdirSync(src);
    writeFileSync(join(src, 'a.txt'), 'original\n'); mkdirSync(join(src, 'a')); writeFileSync(join(src, 'a/x'), 'x');
    writeFileSync(join(src, 'run'), '#!/bin/sh\n'); chmodSync(join(src, 'run'), 0o755);
    symlinkSync('a.txt', join(src, 'link'));
    execFileSync('git', ['init', '-q', directory]); execFileSync('git', ['-C', directory, 'add', 'source']);
    const tree = execFileSync('git', ['-C', directory, 'write-tree'], {encoding: 'utf8'}).trim();
    const expected = execFileSync('git', ['-C', directory, 'rev-parse', `${tree}:source`], {encoding: 'utf8'}).trim();
    assert.equal(sourceTree(src), expected);
    writeFileSync(join(src, 'a.txt'), 'changed');
    assert.throws(() => assertSourceTree(src, expected), /source changed/);
  } finally {rmSync(directory, {recursive: true, force: true})}
});
