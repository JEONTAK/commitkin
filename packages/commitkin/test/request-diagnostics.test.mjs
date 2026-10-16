import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubClient } from '../src/infrastructure/github/client.mjs';
import { createActionRunUseCase } from '../src/application/run-action.mjs';

const response = (status, headers = {}) => new Response('{}', { status, headers });
const token = 'PRIVATE_TOKEN_MUST_NEVER_APPEAR';
test('bounded diagnostics count retries and fixed endpoint labels without source or request paths', async () => {
  let calls = 0;
  const client = createGithubClient({ token, requestBudget: 3, maxRetries: 1, waitImpl: async () => {}, fetchImpl: async () => {
    calls += 1;
    return response(calls === 1 ? 503 : 200, { 'x-ratelimit-resource': 'core', 'x-ratelimit-limit': '1000', 'x-ratelimit-remaining': String(1000 - calls), 'x-ratelimit-used': String(calls), 'x-ratelimit-reset': '1802649600' });
  } });
  assert.equal((await client.get('/repos/PRIVATE_PATH/project/commits/opaque/pulls?secret=PRIVATE_QUERY')).ok, true);
  assert.equal((await client.get('/repos/PRIVATE_PATH/project/git/blobs/opaque')).ok, true);
  assert.equal((await client.get('/user')).code, 'REQUEST_BUDGET_EXHAUSTED');
  const diagnostic = client.diagnostics();
  assert.equal(diagnostic.requests, 3); assert.deepEqual(diagnostic.requestsByKind, { commit_associations: 2, git_blob: 1 });
  assert.deepEqual(diagnostic.rateLimits.core, { limit: 1000, remaining: 997, used: 3, reset: 1802649600 });
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE|opaque|secret|token|Bearer|https/);
  diagnostic.requestsByKind.git_blob = 999;
  assert.equal(client.diagnostics().requestsByKind.git_blob, 1);
});
test('malformed or unknown provider quota headers are not echoed as diagnostics', async () => {
  for (const extra of [{ 'x-ratelimit-resource': 'PRIVATE' }, { 'x-ratelimit-resource': 'core', 'x-ratelimit-limit': 'PRIVATE' }, { 'x-ratelimit-resource': 'graphql', 'x-ratelimit-limit': '-1' }]) {
    const client = createGithubClient({ token, maxRetries: 0, fetchImpl: async () => response(403, extra) });
    assert.equal((await client.get('/user')).ok, false);
    assert.deepEqual(client.diagnostics().rateLimits, {});
  }
});
test('pending and held reports preserve the safe collection cause and cost without record bytes', async () => {
  const collectionDiagnostics = { repositories: [{ repositoryId: '9001', requests: 897, completed: false }], operation: 'commit_pull_requests' };
  for (const decision of ['pending', 'hold']) {
    const run = createActionRunUseCase({ prepare: async () => ({ decision, code: decision === 'pending' ? 'INITIAL_FACTION_RESERVED_ANALYSIS_PENDING' : 'REQUEST_BUDGET_EXHAUSTED', causeCode: 'REQUEST_BUDGET_EXHAUSTED', causeStage: 'collection', stage: 'collection', collectionDiagnostics, files: ['PRIVATE_RECORD_BYTES'], candidate: { token: 'PRIVATE' } }) });
    const report = await run({ workflowContext: {} });
    assert.deepEqual(report.collectionDiagnostics, collectionDiagnostics);
    if (decision === 'pending') { assert.equal(report.causeCode, 'REQUEST_BUDGET_EXHAUSTED'); assert.equal(report.causeStage, 'collection'); }
    assert.equal(report.actualRecordsChanged, false); assert.equal(report.published, false);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE/);
  }
});
