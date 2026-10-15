import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGithubClient, CLOSING_ISSUES_QUERY } from '../src/infrastructure/github/client.mjs';
import { collectPublicSources } from '../src/application/collect-public-sources.mjs';
import { qualifyObservedCapture } from '../src/domain/evidence/observed.mjs';
import { OBSERVED_FILE_RULES } from '../src/domain/evidence/files.mjs';
import { settleQualifiedActivities } from '../src/domain/growth/settlement.mjs';

const ACCOUNT = '1001'; const REPO = '9001'; const PREFIX = '/repos/owner/project';
const START = '2026-07-17'; const CUTOFF = '2026-10-15';
const DIRECT = '8'.repeat(40); const DIRECT_TREE = '9'.repeat(40);
const USER = { id: ACCOUNT, type: 'User', email: 'PRIVATE_EMAIL', login: 'owner' };
const REGISTRY = { fileRules: [{ id: 'commitkin-observed-files-v1', version: '1', body: OBSERVED_FILE_RULES }] };
const blobOid = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const response = (data, headers = {}, status = 200) => new Response(JSON.stringify(data), { headers, status });
const clone = value => structuredClone(value);

/** All requests terminate in this local mock. The real GitHub client/collector run. */
function fixture({ ownBug = false, linkedBug = true, unknownLinkedIssue = false } = {}) {
  const routes = new Map(); const calls = []; const metadata = { id: REPO, full_name: 'owner/project', owner: { id: ACCOUNT, type: 'User' }, private: false, visibility: 'public', fork: false, archived: false, default_branch: 'main' };
  const put = (path, data) => routes.set(path, clone(data));
  const addBlob = text => { const sha = blobOid(text); put(PREFIX + '/git/blobs/' + sha, { sha, encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') }); return sha; };
  const before = addBlob('before eligible change\n'); const after = addBlob('after eligible change\n');
  const directText = 'export const newWork = true;\n'; const directBlob = addBlob(directText);
  const binary = blobOid('UNMATCHED_BINARY\0'); const oldBinary = blobOid('OLD_UNMATCHED_BINARY\0');
  const prPaths = ['src/fix.ts', 'docs/fix.md', 'tests/fix.spec.ts', 'deploy/Dockerfile', 'assets/pr.png'];
  const prFiles = prPaths.map(filename => ({ filename, status: 'modified', sha: filename.startsWith('assets/') ? binary : after, patch: 'RAW_SOURCE_PATCH', raw_url: 'https://evil.invalid/ignored' }));
  const pr = { id: '17', number: 4, state: 'closed', user: USER, created_at: '2020-01-01T00:00:00Z', merged_at: '2026-10-14T09:00:00Z', merge_commit_sha: 'd'.repeat(40), base: { repo: { id: REPO }, sha: 'a'.repeat(40) }, head: { repo: { id: '9999' }, sha: 'b'.repeat(40) }, labels: [{ id: '601', name: 'EMBEDDED_LABEL_IS_NOT_AUTHORITY' }], changed_files: prFiles.length, body: 'RAW_BODY', title: 'RAW_TITLE' };
  put('/repositories/' + REPO, metadata);
  put(PREFIX + '/git/ref/heads/main', { ref: 'refs/heads/main', object: { type: 'commit', sha: DIRECT } });
  put(PREFIX + '/pulls?state=all&sort=created&direction=asc&per_page=100', [{ id: pr.id, number: pr.number }]);
  put(PREFIX + '/pulls/4', pr); put(PREFIX + '/pulls/4/reviews?per_page=100', []); put(PREFIX + '/pulls/4/files?per_page=100', prFiles);
  put(PREFIX + '/issues/4/labels?per_page=100', ownBug ? [{ id: '601', name: 'BuG' }] : []);
  for (const [sha, tree, parents] of [['d', '4', ['e', 'b']], ['e', '3', ['f']], ['f', '1', []], ['b', '2', ['f']]]) put(PREFIX + '/git/commits/' + sha.repeat(40), { sha: sha.repeat(40), tree: { sha: tree.repeat(40) }, parents: parents.map(value => ({ sha: value.repeat(40) })) });
  put(PREFIX + '/compare/' + 'e'.repeat(40) + '...' + 'b'.repeat(40) + '?per_page=1', { base_commit: { sha: 'e'.repeat(40) }, merge_base_commit: { sha: 'f'.repeat(40) } });
  for (const tree of ['1', '2', '3', '4']) {
    const beforeSide = ['1', '3'].includes(tree);
    put(PREFIX + '/git/trees/' + tree.repeat(40) + '?recursive=1', { sha: tree.repeat(40), truncated: false, tree: prPaths.map(path => ({ path, type: 'blob', mode: '100644', sha: path.startsWith('assets/') ? beforeSide ? oldBinary : binary : beforeSide ? before : after })) });
  }
  put(PREFIX + '/issues/events?per_page=100', []);
  put(PREFIX + '/releases?per_page=100', [{ id: '41', author: USER, draft: false, prerelease: false, published_at: '2026-10-14T12:00:00Z', body: 'RAW_BODY', name: 'RAW_TITLE' }]);
  put(PREFIX + '/commits?sha=' + DIRECT + '&per_page=100', [{ sha: DIRECT, author: USER, commit: { author: { date: '2010-01-01T00:00:00Z' }, committer: { date: '2026-10-14T10:00:00Z' }, message: 'RAW_MESSAGE' } }]);
  put(PREFIX + '/commits/' + DIRECT + '/pulls?per_page=100', []);
  put(PREFIX + '/git/commits/' + DIRECT, { sha: DIRECT, tree: { sha: DIRECT_TREE }, parents: [] });
  const directPaths = [...Array.from({ length: 99 }, (_, index) => `src/direct-${index}.ts`), 'docs/direct.md', 'assets/direct.png'];
  const directFiles = directPaths.map(filename => ({ filename, status: 'added', sha: filename.startsWith('assets/') ? binary : directBlob }));
  put(PREFIX + '/git/trees/' + DIRECT_TREE + '?recursive=1', { sha: DIRECT_TREE, truncated: false, tree: directFiles.map(file => ({ path: file.filename, sha: file.sha, type: 'blob', mode: '100644' })) });
  const directDetail = { sha: DIRECT, parents: [], commit: { tree: { sha: DIRECT_TREE }, committer: { date: '2026-10-14T10:00:00Z' } } };
  const filePath = PREFIX + '/commits/' + DIRECT + '?per_page=100';
  put('/repositories/9901', { id: '9901', full_name: 'external/issue-repository', private: false, visibility: 'public' });
  put('/repos/external/issue-repository/issues/8', { id: '88', number: 8, state: 'open', user: { id: '2002', type: 'User' }, created_at: '2020-01-01T00:00:00Z', labels: [], body: 'RAW_BODY' });
  put('/repos/external/issue-repository/issues/8/labels?per_page=100', linkedBug ? [{ id: '608', name: 'BUG' }] : []);
  const client = createGithubClient({ token: 'test_not_a_real_token', requestBudget: 1000, maxRetries: 0, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).origin, 'https://api.github.com'); assert.equal(init.redirect, 'error'); calls.push({ path: url.slice('https://api.github.com'.length), method: init.method });
    const path = calls.at(-1).path;
    if (init.method === 'POST') {
      assert.equal(path, '/graphql'); const document = JSON.parse(init.body); assert.equal(document.query, CLOSING_ISSUES_QUERY); assert.equal(/\bmutation\b/.test(document.query), false);
      assert.deepEqual(document.variables, { owner: 'owner', name: 'project', number: 4, after: null });
      return response({ data: { repository: { fullDatabaseId: REPO, nameWithOwner: 'owner/project', isPrivate: false, pullRequest: { fullDatabaseId: '17', number: 4, closingIssuesReferences: { totalCount: 2, nodes: [
        { fullDatabaseId: '88', number: 8, repository: { fullDatabaseId: '9901', nameWithOwner: 'external/issue-repository', isPrivate: false } },
        { fullDatabaseId: '992', number: 9, repository: { fullDatabaseId: '993', nameWithOwner: 'hidden/private-repository', isPrivate: true } },
      ], pageInfo: { hasNextPage: false, endCursor: 'last-cursor' } } } } } });
    }
    assert.equal(init.method, 'GET');
    if (unknownLinkedIssue && path === '/repos/external/issue-repository/issues/8') return response({ message: 'RAW_PRIVATE_ERROR' }, {}, 404);
    if (path === filePath || path === filePath + '&page=2') {
      const second = path.endsWith('&page=2');
      return response({ ...directDetail, files: directFiles.slice(second ? 100 : 0, second ? 101 : 100) }, second ? {} : { link: `<https://api.github.com${filePath}&page=2>; rel="next"` });
    }
    assert.ok(routes.has(path), 'Unexpected local fixture request: ' + path); return response(routes.get(path));
  } });
  return { client, calls, routes, binary, oldBinary };
}

async function collect(mock) {
  return collectPublicSources({ client: mock.client, repositories: [{ id: REPO, name: 'owner/project' }], subjectAccountId: ACCOUNT, startDate: START, cutoffDate: CUTOFF, model: 'observed-api-v1' });
}
function qualify(capture, previousLedger = null) { return qualifyObservedCapture({ capture, subjectAccountId: ACCOUNT, growthStartDate: START, cutoffDate: CUTOFF, policyRegistry: REGISTRY, previousLedger }); }

test('real injected client -> observed collector -> qualifier composes wide commit/catalog/current labels with no historical claims', async () => {
  const mock = fixture(); const acquired = await collect(mock); assert.equal(acquired.decision, 'ready', acquired.code);
  assert.equal(acquired.progressionAuthorized, false); assert.equal(acquired.sourceAuthenticity, 'not_checked');
  const capture = acquired.capture; const before = clone(capture); const result = qualify(capture);
  assert.equal(result.decision, 'qualified', result.code); assert.deepEqual(capture, before); assert.equal(result.activities.length, 3);
  assert.equal(result.sourceModel, 'observed-api-v1'); assert.equal(result.sourceAuthenticity, 'not_checked'); assert.equal(result.progressionAuthorized, false);
  const pr = result.activities.find(row => row.fact.kind === 'merged_pr').fact;
  assert.deepEqual(pr.families, ['knowledge', 'verification', 'recovery', 'operations']); assert.equal(pr.bugEvidenced, true);
  const direct = result.activities.find(row => row.fact.kind === 'direct_contribution').fact;
  assert.deepEqual(direct.families, ['craft', 'knowledge']); assert.equal(direct.occurredAt, '2026-10-14T10:00:00Z');
  assert.equal(result.activities.find(row => row.fact.kind === 'published_release').fact.occurredAt, '2026-10-14T12:00:00Z');
  const pageProof = capture.queries.find(query => query.kind === 'commit_files');
  assert.equal(pageProof.receivedItems, 101); assert.equal(pageProof.pages, 2); assert.deepEqual(pageProof.pageSnapshots.map(page => page.itemCount), [100, 1]);
  assert.equal(capture.commits[0].changedFiles, 101); assert.equal(capture.commits[0].firstParentOid, null); assert.equal(capture.files.filter(file => file.commitOid).length, 101);
  assert.deepEqual(capture.repositories.map(repo => repo.repositoryId), [REPO]); assert.equal(capture.issues[0].state, 'OPEN'); assert.equal(capture.issues[0].repositoryId, '9901');
  assert.equal(capture.pullRequests[0].excludedClosingIssueCount, 1);
  for (const oid of [mock.binary, mock.oldBinary]) assert.equal(mock.calls.some(call => call.path.endsWith('/git/blobs/' + oid)), false);
  assert.equal(capture.files.filter(file => file.contentProof === 'not_required').length, 2);
  assert.equal(settleQualifiedActivities({ activities: result.activities, reviewHistoryFacts: result.reviewHistoryFacts }).totalXp, '65');
  for (const forbidden of ['hidden/private-repository', '"992"', '"993"', 'RAW_BODY', 'RAW_TITLE', 'RAW_MESSAGE', 'RAW_SOURCE_PATCH', 'PRIVATE_EMAIL', 'evil.invalid']) assert.equal(JSON.stringify(capture).includes(forbidden), false, forbidden);
  for (const raw of ['currentLabels', 'beforeText', 'afterText', 'closingIssueIds', 'sourceId']) assert.equal(JSON.stringify(result.activities.map(row => row.fact)).includes(raw), false);
});

test('current own-PR bug label and first-analysis retention compose through fresh collector snapshots', async () => {
  const first = await collect(fixture({ ownBug: true, linkedBug: false })); assert.equal(first.decision, 'ready', first.code);
  const original = qualify(first.capture); assert.equal(original.decision, 'qualified', original.code);
  const originalPr = original.activities.find(row => row.fact.kind === 'merged_pr').fact; assert.equal(originalPr.bugEvidenced, true);
  const second = await collect(fixture({ ownBug: false, linkedBug: false })); assert.equal(second.decision, 'ready', second.code);
  assert.equal(qualify(second.capture).activities.find(row => row.fact.kind === 'merged_pr').fact.bugEvidenced, false);
  const retained = qualify(second.capture, { owner: { accountId: ACCOUNT }, facts: original.activities.map(row => row.fact) });
  assert.equal(retained.decision, 'qualified', retained.code); assert.equal(retained.retainedClassifications, 1);
  assert.deepEqual(retained.activities.find(row => row.fact.kind === 'merged_pr').fact, originalPr);
});

test('missing public linked detail or removed actual file-page proof cannot settle a successful subset', async () => {
  const unavailable = await collect(fixture({ unknownLinkedIssue: true })); assert.equal(unavailable.decision, 'hold'); assert.equal(unavailable.code, 'REPOSITORY_UNAVAILABLE'); assert.equal(unavailable.capture, null);
  const acquired = await collect(fixture()); assert.equal(acquired.decision, 'ready', acquired.code);
  acquired.capture.queries = acquired.capture.queries.filter(query => query.kind !== 'commit_files');
  const result = qualify(acquired.capture); assert.equal(result.decision, 'hold'); assert.equal(result.code, 'OBSERVED_REQUIRED_QUERY_MISSING'); assert.deepEqual(result.activities, []); assert.equal(result.progressionAuthorized, false);
});
