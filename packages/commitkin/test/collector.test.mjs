import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPublicSources } from '../src/application/collect-public-sources.mjs';

const prefix = '/repos/owner/project';
const user = { id: '1001', type: 'User', login: 'not-returned', email: 'private-email-not-returned' };
const metadata = () => ({ id: '9001', full_name: 'owner/project', owner: { id: '1001', type: 'User' }, private: false, visibility: 'public', fork: false, archived: false, default_branch: 'main' });
const paths = {
  metadata: '/repositories/9001', pulls: prefix + '/pulls?state=all&sort=created&direction=asc&per_page=100',
  events: prefix + '/issues/events?per_page=100', releases: prefix + '/releases?per_page=100', commits: prefix + '/commits?sha=main&per_page=100',
};
function setup({ limit = 1000 } = {}) {
  const routes = new Map([
    [paths.metadata, { kind: 'get', data: metadata() }],
    ...[paths.pulls, paths.events, paths.releases, paths.commits].map(path => [path, { kind: 'paginate', items: [], pages: 1 }]),
  ]);
  const calls = []; let used = 0;
  function invoke(kind, path, options) {
    calls.push({ kind, path, options }); used += 1;
    const route = routes.get(path); assert.ok(route, `Unexpected mock request ${path}`); assert.equal(kind, route.kind);
    if (route.throws) throw new Error('PRIVATE_REMOTE_ERROR_WITH_TOKEN');
    if (route.failure) return { ok: false, complete: false, code: route.failure, items: route.items ?? [] };
    return structuredClone(kind === 'get' ? { ok: true, data: route.data } : { ok: true, complete: route.complete ?? true, pages: route.pages, items: route.items });
  }
  const client = { get: async path => invoke('get', path), paginate: async (path, options) => invoke('paginate', path, options), budget: () => ({ used, remaining: Math.max(limit - used, 0), limit }) };
  return { routes, calls, client, request: { client, repositories: [{ id: '9001', name: 'owner/project' }], subjectAccountId: '1001', startDate: '2026-07-17', cutoffDate: '2026-10-15' } };
}
function addPr(mock, { id = '17', number = '4', files = 1 } = {}) {
  mock.routes.get(paths.pulls).items.push({ id, number, title: 'RAW_TITLE_MUST_NOT_RETURN', body: 'RAW_BODY_MUST_NOT_RETURN' });
  const detail = { id, number, state: 'closed', user, created_at: '2010-01-01T00:00:00Z', merged_at: '2026-10-14T09:00:00Z', base: { repo: { id: '9001' }, sha: 'a'.repeat(40) }, head: { repo: { id: '9999' }, sha: 'b'.repeat(40) }, labels: [{ id: '601', name: 'bug' }], changed_files: files, title: 'RAW_TITLE_MUST_NOT_RETURN', body: 'RAW_BODY_MUST_NOT_RETURN', merged_by: { id: '999', type: 'User' } };
  const fileItems = Array.from({ length: files }, (_, index) => ({ filename: `docs/${index}.md`, status: 'modified', sha: 'c'.repeat(40), patch: 'RAW_SOURCE_PATCH_NOT_RETURNED', raw_url: 'https://evil.invalid/never-follow' }));
  mock.routes.set(prefix + '/pulls/' + number, { kind: 'get', data: detail });
  mock.routes.set(prefix + '/pulls/' + number + '/files?per_page=100', { kind: 'paginate', items: fileItems, pages: Math.max(1, Math.ceil(files / 100)) });
  mock.routes.set(prefix + '/pulls/' + number + '/reviews?per_page=100', { kind: 'paginate', items: [], pages: 1 });
  return detail;
}
function addIssueEvent(mock, { id = '751', issueId = '51', issueNumber = '1', date = '2026-10-14T16:00:00Z', event = 'labeled' } = {}) {
  const value = { id, event, created_at: date, actor: user, issue: { id: issueId, number: issueNumber }, label: { id: '601', name: 'not-returned' }, assignee: user, milestone: { id: '88' }, body: 'RAW_BODY_MUST_NOT_RETURN' };
  mock.routes.get(paths.events).items.push(value);
  mock.routes.set(prefix + '/issues/' + issueNumber, { kind: 'get', data: { id: issueId, number: issueNumber, user: { id: '2002', type: 'User' }, created_at: '2010-01-01T00:00:00Z', labels: [], body: 'RAW_BODY_MUST_NOT_RETURN', title: 'RAW_TITLE_MUST_NOT_RETURN' } });
  return value;
}
async function ready(mock) {
  const result = await collectPublicSources(mock.request); assert.equal(result.decision, 'ready', result.code);
  assert.equal(result.qualificationReady, false); assert.equal(result.progressionAuthorized, false); assert.equal(result.sourceAuthenticity, 'not_checked'); return result;
}
async function held(mock, code) {
  const result = await collectPublicSources(mock.request); assert.equal(result.decision, 'hold'); assert.equal(result.code, code); assert.equal(result.capture, null); return result;
}

test('empty known repository captures all four lists without claiming no account-wide activity', async () => {
  const mock = setup(); const result = await ready(mock);
  assert.equal(result.capture.queries.length, 4); assert.equal(result.capture.repositories.length, 1);
  assert.ok(result.limitations.includes('ACCOUNT_WIDE_DISCOVERY_NOT_GUARANTEED'));
  assert.equal(result.capabilities.defaultBranchReflectionHistory, 'unsupported');
  assert.equal(result.capabilities.fullBeforeAfterFileContents, 'not_collected');
});

test('enumerates old-created PRs and all their historical reviews without actor/date shortcuts', async () => {
  const mock = setup(); addPr(mock);
  mock.routes.get(prefix + '/pulls/4/reviews?per_page=100').items = [
    { id: '20', state: 'APPROVED', submitted_at: '2010-01-02T00:00:00Z', user, commit_id: 'd'.repeat(40), body: 'RAW_BODY_MUST_NOT_RETURN' },
    { id: '21', state: 'COMMENTED', submitted_at: '2026-10-14T10:00:00Z', user: { id: '2002', type: 'User' }, commit_id: 'e'.repeat(40) },
  ];
  const result = await ready(mock);
  assert.equal(result.capture.pullRequests[0].createdAt, '2010-01-01T00:00:00Z');
  assert.equal(result.capture.pullRequests[0].author.accountId, '1001');
  assert.equal(result.capture.reviews.length, 2); assert.equal(result.capture.reviews[0].submittedAt, '2010-01-02T00:00:00Z');
  assert.ok(mock.calls.some(call => call.path.includes('pulls?state=all') && !call.path.includes('since=')));
  assert.equal(result.capture.queries.find(query => query.kind === 'pull_request_reviews').filters.history, 'all');
});

test('pending reviews preserve null submission, never become submitted owner activity', async () => {
  const mock = setup(); addPr(mock);
  mock.routes.get(prefix + '/pulls/4/reviews?per_page=100').items = [{ id: '21', state: 'PENDING', submitted_at: null, user: null, commit_id: null }];
  const result = await ready(mock); assert.equal(result.capture.reviews[0].submittedAt, null); assert.equal(result.capture.reviews[0].reviewer.status, 'unavailable');
});

test('files expose observed blob only, never fake before/after content from parent commit OIDs', async () => {
  const mock = setup(); addPr(mock); const result = await ready(mock); const file = result.capture.files[0];
  assert.equal(file.observedBlobOid, 'c'.repeat(40)); assert.equal(file.contentProof, 'not_collected');
  assert.equal(Object.hasOwn(file, 'beforeOid'), false); assert.equal(Object.hasOwn(file, 'beforeText'), false);
  assert.equal(mock.calls.find(call => call.path.includes('/files?')).options.maxPages, 30);
});

test('exact3000-file ceiling holds even advertised terminal success', async () => {
  const mock = setup(); addPr(mock, { files: 3000 }); await held(mock, 'PR_FILE_LIMIT_REACHED');
});

test('inconsistent detailed changed_files rejects incomplete file enumeration', async () => {
  const mock = setup(); const pr = addPr(mock); pr.changed_files = 2;
  await held(mock, 'PR_FILE_COUNT_MISMATCH');
});

test('file or review pagination failure holds whole capture, not successful subset', async () => {
  for (const path of ['/files?per_page=100', '/reviews?per_page=100']) {
    const mock = setup(); addPr(mock); mock.routes.get(prefix + '/pulls/4' + path).failure = 'PAGE_LIMIT_REACHED';
    await held(mock, 'PAGE_LIMIT_REACHED');
  }
});

test('recent event on old-created issue fetches referenced detail, not all repository issues', async () => {
  const mock = setup(); addIssueEvent(mock); const result = await ready(mock);
  assert.equal(result.capture.issueEvents.length, 1); assert.equal(result.capture.issues[0].createdAt, '2010-01-01T00:00:00Z');
  assert.ok(mock.calls.some(call => call.path === prefix + '/issues/1'));
  assert.ok(!mock.calls.some(call => call.path.startsWith(prefix + '/issues?')));
});

test('event enumeration completes before post-capture interval or actor exclusions', async () => {
  const mock = setup(); addIssueEvent(mock, { date: '2010-01-01T00:00:00Z' });
  const current = addIssueEvent(mock, { id: '752', issueId: '52', issueNumber: '2' }); current.actor = { id: '2002', type: 'User' };
  const result = await ready(mock);
  assert.equal(result.capture.issueEvents.length, 1); assert.equal(result.capture.issueEvents[0].actor.accountId, '2002');
  assert.ok(!mock.calls.some(call => call.path === prefix + '/issues/1'));
  assert.equal(result.capture.queries.find(query => query.kind === 'repository_issue_events').receivedItems, 2);
});

test('PR management event is a conclusive non-issue target, not invented triage', async () => {
  const mock = setup(); const event = addIssueEvent(mock); event.issue.pull_request = { url: 'https://evil.invalid/ignored' };
  const result = await ready(mock); assert.equal(result.capture.issueEvents.length, 0); assert.equal(result.capture.issues.length, 0);
});

test('name-only event label cannot fabricate a stable historical target ID', async () => {
  const mock = setup(); const event = addIssueEvent(mock); delete event.label.id;
  await held(mock, 'ISSUE_EVENT_TARGET_UNAVAILABLE');
});

test('required referenced issue404 holds, without claiming deletion or privacy', async () => {
  const mock = setup(); addIssueEvent(mock); mock.routes.get(prefix + '/issues/1').failure = 'REPOSITORY_UNAVAILABLE';
  await held(mock, 'REPOSITORY_UNAVAILABLE');
});

test('default branch ancestry has no author-date since/until shortcut', async () => {
  const mock = setup(); mock.routes.get(paths.commits).items = [{ sha: 'd'.repeat(40), author: { id: '2002', type: 'User' }, commit: { author: { date: '2010-01-01T00:00:00Z', email: 'private-email-not-returned' }, message: 'RAW_COMMIT_MESSAGE_MUST_NOT_RETURN' } }];
  const result = await ready(mock); const commit = result.capture.commits[0];
  assert.equal(commit.defaultBranchReflectionProof, 'unsupported'); assert.equal(Object.hasOwn(commit, 'reflectedAt'), false);
  const query = result.capture.queries.find(query => query.kind === 'default_branch_commits'); assert.equal(query.filters.ancestry, 'all');
  assert.ok(!mock.calls.find(call => call.path.includes('/commits?')).path.includes('since='));
});

test('own nonfork commit gets full PR association capture only after ancestry closure', async () => {
  const mock = setup(); const sha = 'd'.repeat(40); mock.routes.get(paths.commits).items = [{ sha, author: user }];
  mock.routes.set(prefix + '/commits/' + sha + '/pulls?per_page=100', { kind: 'paginate', pages: 1, items: [{ id: '17' }, { id: '9' }] });
  const result = await ready(mock); assert.deepEqual(result.capture.commits[0].associatedPrIds, ['9', '17']);
  assert.ok(mock.calls.findIndex(call => call.path === paths.commits) < mock.calls.findIndex(call => call.path.includes('/' + sha + '/pulls')));
});

test('huge ancestry budget/page exhaustion is a whole-run hold despite earlier successful PRs', async () => {
  const mock = setup(); addPr(mock); mock.routes.get(paths.commits).failure = 'REQUEST_BUDGET_EXHAUSTED'; mock.routes.get(paths.commits).items = [{ sha: 'd'.repeat(40), author: user }];
  await held(mock, 'REQUEST_BUDGET_EXHAUSTED');
});

test('releases retain current author/state only, not fabricated original publication proof', async () => {
  const mock = setup(); mock.routes.get(paths.releases).items = [{ id: '41', author: { id: '2002', type: 'Bot' }, draft: false, prerelease: true, published_at: '2026-10-14T12:00:00Z', body: 'RAW_BODY_MUST_NOT_RETURN', name: 'RAW_TITLE_MUST_NOT_RETURN' }];
  const result = await ready(mock); assert.equal(result.capture.releases[0].author.type, 'Bot'); assert.equal(result.capture.releases[0].firstPublicationProof, 'unsupported');
});

test('request budget stops before another port call; failure codes are sanitized', async () => {
  const mock = setup({ limit: 1 }); await held(mock, 'REQUEST_BUDGET_EXHAUSTED'); assert.equal(mock.calls.length, 1);
  const unknown = setup(); unknown.routes.get(paths.events).failure = 'RAW_ERROR_WITH_TOKEN'; const result = await held(unknown, 'INCOMPLETE_COLLECTION');
  assert.equal(JSON.stringify(result).includes('RAW_ERROR_WITH_TOKEN'), false);
  const thrown = setup(); thrown.routes.get(paths.events).throws = true; await held(thrown, 'COLLECTION_UNAVAILABLE');
});

test('input URLs, unsafe numericIDs, stableID mismatch and private scope race hold safely', async () => {
  const badName = setup(); badName.request.repositories[0].name = 'https://evil.invalid/steal'; await held(badName, 'REPOSITORY_NAME_INVALID'); assert.equal(badName.calls.length, 0);
  const unsafe = setup(); unsafe.request.repositories[0].id = Number.MAX_SAFE_INTEGER + 1; await held(unsafe, 'SOURCE_IDENTIFIER_INVALID'); assert.equal(unsafe.calls.length, 0);
  const mismatch = setup(); mismatch.routes.get(paths.metadata).data.id = '9999'; await held(mismatch, 'REPOSITORY_ID_MISMATCH');
  const privateRepo = setup(); privateRepo.routes.get(paths.metadata).data.private = true; privateRepo.routes.get(paths.metadata).data.visibility = 'private'; await held(privateRepo, 'REPOSITORY_SCOPE_CHANGED');
});

test('stable-ID verified rename changes only validated endpoint name, not identity', async () => {
  const mock = setup(); mock.routes.get(paths.metadata).data.full_name = 'new-owner/new-project';
  for (const path of [paths.pulls, paths.events, paths.releases, paths.commits]) { const route = mock.routes.get(path); mock.routes.delete(path); mock.routes.set(path.replace(prefix, '/repos/new-owner/new-project'), route); }
  const result = await ready(mock); assert.equal(result.capture.repositories[0].repositoryId, '9001');
  assert.ok(mock.calls.some(call => call.path.startsWith('/repos/new-owner/new-project/')));
});

test('multiple-repository partial success never returns the first successful capture', async () => {
  const mock = setup(); mock.request.repositories.push({ id: '9002', name: 'owner/another' });
  mock.routes.set('/repositories/9002', { kind: 'get', failure: 'ACCESS_DENIED' });
  await held(mock, 'ACCESS_DENIED');
});

test('capture omits raw titles/bodies/emails/patches and arbitrary provider URLs', async () => {
  const mock = setup(); addPr(mock); addIssueEvent(mock);
  mock.routes.get(paths.releases).items = [{ id: '41', author: user, draft: false, prerelease: false, published_at: '2026-10-14T12:00:00Z', body: 'RAW_BODY_MUST_NOT_RETURN', html_url: 'https://evil.invalid/steal' }];
  const result = await ready(mock); const json = JSON.stringify(result);
  for (const forbidden of ['RAW_TITLE', 'RAW_BODY', 'RAW_SOURCE_PATCH', 'private-email', 'evil.invalid']) assert.equal(json.includes(forbidden), false, forbidden);
});

test('input and mock response source objects remain unchanged', async () => {
  const mock = setup(); addPr(mock); addIssueEvent(mock);
  const before = structuredClone({ repositories: mock.request.repositories, routes: [...mock.routes] });
  await ready(mock); assert.deepEqual({ repositories: mock.request.repositories, routes: [...mock.routes] }, before);
});

test('impossible calendar timestamps and unsupported review states do not normalize silently', async () => {
  const invalidTime = setup(); const pr = addPr(invalidTime); pr.created_at = '2026-02-30T00:00:00Z'; await held(invalidTime, 'SOURCE_TIMESTAMP_INVALID');
  const state = setup(); addPr(state); state.routes.get(prefix + '/pulls/4/reviews?per_page=100').items = [{ id: '21', state: 'UNKNOWN' }]; await held(state, 'REVIEW_STATE_UNSUPPORTED');
});

test('empty explicit scope is acquisition-ready only and performs no read calls', async () => {
  const mock = setup(); mock.request.repositories = []; const result = await ready(mock);
  assert.equal(mock.calls.length, 0); assert.equal(result.capture.repositories.length, 0); assert.equal(result.qualificationReady, false);
});
