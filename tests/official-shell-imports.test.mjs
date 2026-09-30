import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

test('the running Shell module graph and guide build have no community Desktop input', async () => {
  const result = await build({entryPoints: ['src/app/main.mjs'], bundle: true, platform: 'node', format: 'esm',
    write: false, metafile: true, packages: 'external', logLevel: 'silent'});
  const inputs = [...Object.keys(result.metafile.inputs), ...JSON.parse(readFileSync('dist/build.json', 'utf8')).inputs];
  assert.ok(inputs.some(path => path.endsWith('official/project-window.mjs')));
  for (const path of inputs) assert.doesNotMatch(path, /desktop-adapter\/stable|\.upstream\/(desktop|harness-guide)|dsh-plugin-desktop|\.cache\/runtime/);
  for (const output of result.outputFiles) assert.doesNotMatch(output.text, /upstream\.lock\.json/);
});
