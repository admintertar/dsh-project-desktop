import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claimProjectState, projectStatePath} from '../src/app/project-state.mjs';

test('state roots are independent and a project cannot adopt another project or Desktop Home', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-state-test-'));
  try {
    const a = join(root, 'a.agent-project'), b = join(root, 'b.agent-project');
    writeFileSync(a, 'a'); writeFileSync(b, 'b');
    const first = projectStatePath(root, a), second = projectStatePath(root, b);
    assert.notEqual(first.stateDirectory, second.stateDirectory);
    claimProjectState(first.stateDirectory, a); claimProjectState(first.stateDirectory, a);
    assert.throws(() => claimProjectState(first.stateDirectory, b), /another project/);
    const old = join(root, 'old'); mkdirSync(join(old, 'dsh'), {recursive: true});
    writeFileSync(join(old, 'dsh/keep'), 'existing');
    assert.throws(() => claimProjectState(old, a), /unowned/);
    assert.equal(readFileSync(join(old, 'dsh/keep'), 'utf8'), 'existing');
  } finally {rmSync(root, {recursive: true, force: true})}
});
