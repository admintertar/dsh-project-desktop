import assert from 'node:assert/strict';
import {releaseRepository} from '../src/app/update-manifest.mjs';
assert.equal(process.env.GITHUB_REPOSITORY, releaseRepository);
assert.match(process.env.BUILD_RUN ?? '', /^\d+$/);
const response = await fetch(`https://api.github.com/repos/${releaseRepository}/actions/runs/${process.env.BUILD_RUN}`, {
  headers: {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json'}, signal: AbortSignal.timeout(30000)});
assert.equal(response.status, 200);
const run = await response.json();
assert.equal(run.head_sha, process.env.GITHUB_SHA);
assert.equal(run.conclusion, 'success');
assert.equal(run.path, '.github/workflows/package.yml');
assert.equal(run.head_repository.full_name, releaseRepository);
assert.notEqual(run.event, 'pull_request');
console.log(`Verified native build ${run.id} for ${run.head_sha}`);
