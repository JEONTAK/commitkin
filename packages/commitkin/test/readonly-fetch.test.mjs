import test from 'node:test';
import assert from 'node:assert/strict';
import { readOnlyGithubFetch } from '../src/infrastructure/github/read-only-fetch.mjs';
import { CLOSING_ISSUES_QUERY } from '../src/infrastructure/github/client.mjs';
import { executeAction } from '../bin/commitkin-actions.mjs';
test('analysis transport allows GET and only the exact fixed GraphQL query, never mutations or arbitrary destinations', async () => {
  const calls = [], fetch = readOnlyGithubFetch(async (...args) => { calls.push(args); return true; });
  assert.equal(await fetch('https://api.github.com/repos/a/a', { method: 'GET' }), true);
  const query = { operationName: 'CommitkinClosingIssues', query: CLOSING_ISSUES_QUERY, variables: { owner: 'a', name: 'a', number: 1, after: null } };
  assert.equal(await fetch('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify(query) }), true);
  for (const [url, options] of [
    ['https://evil.invalid', { method: 'GET' }], ['invalid', { method: 'GET' }], ['https://token@api.github.com/x', { method: 'GET' }],
    ['https://api.github.com/x#fragment', { method: 'GET' }], ['https://api.github.com/repos/a/a/git/blobs', { method: 'POST' }],
    ['https://api.github.com/graphql', { method: 'POST', body: '{' }], ['https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ ...query, query: 'mutation { updateRefs }' }) }],
    ['https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ ...query, arbitrary: true }) }], ['https://api.github.com/x', { method: 'DELETE' }],
  ]) assert.throws(() => fetch(url, options), /READ_ONLY/);
  assert.equal(calls.length, 2); assert.throws(() => readOnlyGithubFetch(null));
});
test('Actions environment rejects malformed intent and unauthorized events before all network access', async () => {
  for (const environment of [null, {}, { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'synthetic-token-only', GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'synthetic-token-only', GITHUB_EVENT_NAME: 'workflow_dispatch', COMMITKIN_DRY_RUN: '0' }]) {
    const report = await executeAction({ environment, fetchImpl: () => { throw new TypeError('MUST_NOT_FETCH'); } });
    assert.equal(report.code, 'ACTIONS_CONTEXT_INVALID'); assert.equal(report.actualRecordsChanged, false);
  }
});
test('Actions entrypoint retains repository/profile acquisition refusal without echoing credential or raw errors', async () => {
  const report = await executeAction({ environment: { GITHUB_ACTIONS: 'true', GITHUB_TOKEN: 'synthetic-private-marker', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SERVER_URL: 'https://evil.invalid' }, fetchImpl: () => { throw new Error('private-error'); } });
  assert.equal(report.code, 'INSTALLATION_CONTEXT_INVALID'); assert.equal(report.published, false);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-private-marker|private-error|stack/);
});
