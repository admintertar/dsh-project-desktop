import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stringify} from 'yaml';
import {readProjectAgentInstructions} from '../src/app/project-agent.mjs';

test('loads root and linked resource AGENT.md files without requiring them', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-agent-'));
  try {
    const external = join(root, 'external'); mkdirSync(external); writeFileSync(join(external, 'AGENT.md'), 'external rule');
    mkdirSync(join(root, '.agent-project'));
    const manifest = join(root, 'demo.agent-project');
    writeFileSync(manifest, stringify({schemaVersion: 1, id: 'demo', name: 'Demo', resources: [
      {id: 'root', name: 'Demo', type: 'local', path: '.'},
      {id: 'external', name: 'External', type: 'git'},
    ], memory: []}));
    writeFileSync(join(root, 'AGENT.md'), 'root rule');
    writeFileSync(join(root, '.agent-project', 'local.yaml'), stringify({resources: {external}}));
    const context = readProjectAgentInstructions(manifest);
    assert.match(context, /root rule/);
    assert.match(context, /external rule/);
    assert.match(context, /external \(External\)/);
  } finally {rmSync(root, {recursive: true, force: true});}
});
test('ignores oversized instruction files and returns an empty context when none are present', () => {
  const root = mkdtempSync(join(tmpdir(), 'project-agent-empty-'));
  try {
    const manifest = join(root, 'demo.agent-project');
    writeFileSync(manifest, stringify({schemaVersion: 1, id: 'demo', name: 'Demo', resources: [], memory: []}));
    assert.equal(readProjectAgentInstructions(manifest), '');
    writeFileSync(join(root, 'AGENT.md'), 'x'.repeat(70 * 1024));
    assert.equal(readProjectAgentInstructions(manifest), '');
  } finally {rmSync(root, {recursive: true, force: true});}
});
