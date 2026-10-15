import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collectPublicSources } from '../src/application/collect-public-sources.mjs';
import { createGithubClient } from '../src/infrastructure/github/client.mjs';

const prefix = '/repos/owner/project';
const user = { id: '1001', type: 'User', login: 'not-returned', email: 'private-email-not-returned' };
const metadata = () => ({ id: '9001', full_name: 'owner/project', owner: { id: '1001', type: 'User' }, private: false, visibility: 'public', fork: false, archived: false, default_branch: 'main' });
const paths = {
  metadata: '/repositories/9001', pulls: prefix + '/pulls?state=all&sort=created&direction=asc&per_page=100',
  events: prefix + '/issues/events?per_page=100', releases: prefix + '/releases?per_page=100', commits: prefix + '/commits?sha=main&per_page=100',
};
const blobOid = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
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
    const pagePath = page => page === 1 ? path : path + (path.includes('?') ? '&' : '?') + 'page=' + page;
    const pageSnapshots = kind === 'get' ? undefined : Array.from({ length: route.pages }, (_, index) => {
      const startIndex = Math.floor(route.items.length * index / route.pages); const endIndexExclusive = Math.floor(route.items.length * (index + 1) / route.pages);
      return { sequence: index + 1, requestPath: pagePath(index + 1), itemCount: endIndexExclusive - startIndex, nextPath: index + 1 === route.pages ? null : pagePath(index + 2), startIndex, endIndexExclusive };
    });
    return structuredClone(kind === 'get' ? { ok: true, data: route.data } : { ok: true, complete: route.complete ?? true, pages: route.pages, items: route.items, pageSnapshots });
  }
  const client = { get: async path => invoke('get', path), paginate: async (path, options) => invoke('paginate', path, options), budget: () => ({ used, remaining: Math.max(limit - used, 0), limit }) };
  return { routes, calls, client, request: { client, repositories: [{ id: '9001', name: 'owner/project' }], subjectAccountId: '1001', startDate: '2026-07-17', cutoffDate: '2026-10-15' } };
}
function observed(mock = setup()) {
  mock.request.model = 'observed-api-v1';
  mock.routes.set(prefix + '/git/ref/heads/main', { kind: 'get', data: { ref: 'refs/heads/main', object: { type: 'commit', sha: '9'.repeat(40) } } });
  mock.routes.set(prefix + '/commits?sha=' + '9'.repeat(40) + '&per_page=100', mock.routes.get(paths.commits));
  const closing = new Map();
  mock.client.closingIssues = async options => {
    mock.calls.push({ kind: 'closingIssues', options });
    return structuredClone(closing.get(options.repository + ':' + options.pullNumber));
  };
  mock.client.commitFiles = async ({ repository, oid, maxPages }) => {
    const path = '/repos/' + repository + '/commits/' + oid + '?per_page=100';
    const result = await mock.client.get(path);
    if (!result.ok) return { ...result, complete: false, files: [] };
    const data = result.data;
    return { ok: true, complete: true, metadata: { oid: data.sha, treeOid: data.commit?.tree?.sha, parentOids: data.parents?.map(parent => parent.sha), committedAt: data.commit?.committer?.date },
      files: data.files, pages: 1, receivedItems: data.files.length,
      pageSnapshots: [{ sequence: 1, requestPath: path, itemCount: data.files.length, nextPath: null, startIndex: 0, endIndexExclusive: data.files.length }] };
  };
  mock.closing = closing; return mock;
}
function addObservedPr(mock, options) {
  const detail = addPr(mock, options); const { id, number } = detail;
  mock.routes.set(prefix + '/issues/' + number + '/labels?per_page=100', { kind: 'paginate', items: [], pages: 1 });
  mock.closing.set('owner/project:' + number, {
    ok: true, complete: true, code: 'CAPTURED', repositoryId: '9001', repositoryName: 'owner/project', pullRequestId: id, pullNumber: number,
    items: [], excludedPrivateCount: 0, totalCount: 0, pages: 1,
    pageSnapshots: [{ sequence: 1, requestCursor: null, endCursor: null, hasNextPage: false, itemCount: 0, includedCount: 0, excludedPrivateCount: 0, startIndex: 0, endIndexExclusive: 0 }],
  });
  return detail;
}
function addCommit(mock, { sha = '8'.repeat(40), committedAt = '2026-10-14T09:00:00Z', authoredAt = '2010-01-01T00:00:00Z', root = false, author = user, kind = 'modified', beforePath = 'src/main.ts', afterPath = 'src/main.ts', beforeText = 'old code\n', afterText = 'new code\n', mode = '100644', type = 'blob' } = {}) {
  const parents = root ? [] : [{ sha: '7'.repeat(40) }];
  mock.routes.get(paths.commits).items.push({ sha, author, commit: { author: { date: authoredAt }, committer: { date: committedAt }, message: 'RAW_COMMIT_MESSAGE_MUST_NOT_RETURN' } });
  mock.routes.set(prefix + '/commits/' + sha + '/pulls?per_page=100', { kind: 'paginate', items: [], pages: 1 });
  const left = root || beforeText === null ? null : { path: beforePath, sha: blobOid(beforeText), mode, type };
  const right = afterText === null ? null : { path: afterPath, sha: blobOid(afterText), mode, type };
  const file = { filename: afterPath ?? beforePath, status: root ? 'added' : kind, sha: (right ?? left).sha };
  if (['renamed', 'copied'].includes(kind)) file.previous_filename = beforePath;
  const detail = { sha, parents, commit: { tree: { sha: '6'.repeat(40) }, committer: { date: committedAt } }, files: [file] };
  mock.routes.set(prefix + '/commits/' + sha + '?per_page=100', { kind: 'get', data: detail });
  mock.routes.set(prefix + '/git/commits/' + sha, { kind: 'get', data: { sha, tree: { sha: '6'.repeat(40) }, parents } });
  if (!root) mock.routes.set(prefix + '/git/commits/' + '7'.repeat(40), { kind: 'get', data: { sha: '7'.repeat(40), tree: { sha: '5'.repeat(40) }, parents: [] } });
  mock.routes.set(prefix + '/git/trees/' + '5'.repeat(40) + '?recursive=1', { kind: 'get', data: { sha: '5'.repeat(40), truncated: false, tree: left ? [left] : [] } });
  mock.routes.set(prefix + '/git/trees/' + '6'.repeat(40) + '?recursive=1', { kind: 'get', data: { sha: '6'.repeat(40), truncated: false, tree: kind === 'copied' ? [left, right] : right ? [right] : [] } });
  for (const text of [beforeText, afterText].filter(value => value !== null)) mock.routes.set(prefix + '/git/blobs/' + blobOid(text), { kind: 'get', data: { sha: blobOid(text), encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') } });
  return detail;
}
function addPr(mock, { id = '17', number = '4', files = 1 } = {}) {
  mock.routes.get(paths.pulls).items.push({ id, number, title: 'RAW_TITLE_MUST_NOT_RETURN', body: 'RAW_BODY_MUST_NOT_RETURN' });
  const detail = { id, number, state: 'closed', user, created_at: '2010-01-01T00:00:00Z', merged_at: '2026-10-14T09:00:00Z', merge_commit_sha: 'd'.repeat(40), base: { repo: { id: '9001' }, sha: 'a'.repeat(40) }, head: { repo: { id: '9999' }, sha: 'b'.repeat(40) }, labels: [{ id: '601', name: 'bug' }], changed_files: files, title: 'RAW_TITLE_MUST_NOT_RETURN', body: 'RAW_BODY_MUST_NOT_RETURN', merged_by: { id: '999', type: 'User' } };
  const beforeText = '# Old fixture\n'; const afterText = '# New fixture\n';
  const fileItems = Array.from({ length: files }, (_, index) => ({ filename: `docs/${index}.md`, status: 'modified', sha: blobOid(afterText), patch: 'RAW_SOURCE_PATCH_NOT_RETURNED', raw_url: 'https://evil.invalid/never-follow' }));
  mock.routes.set(prefix + '/pulls/' + number, { kind: 'get', data: detail });
  mock.routes.set(prefix + '/pulls/' + number + '/files?per_page=100', { kind: 'paginate', items: fileItems, pages: Math.max(1, Math.ceil(files / 100)) });
  mock.routes.set(prefix + '/pulls/' + number + '/reviews?per_page=100', { kind: 'paginate', items: [], pages: 1 });
  const commits = [['d', '4', ['e', 'b']], ['e', '3', ['f']], ['f', '1', []], ['b', '2', ['f']]];
  for (const [sha, tree, parents] of commits) mock.routes.set(prefix + '/git/commits/' + sha.repeat(40), { kind: 'get', data: { sha: sha.repeat(40), tree: { sha: tree.repeat(40) }, parents: parents.map(parent => ({ sha: parent.repeat(40) })) } });
  mock.routes.set(prefix + '/compare/' + 'e'.repeat(40) + '...' + 'b'.repeat(40) + '?per_page=1', { kind: 'get', data: { base_commit: { sha: 'e'.repeat(40) }, merge_base_commit: { sha: 'f'.repeat(40) } } });
  for (const tree of ['1', '2', '3', '4']) mock.routes.set(prefix + '/git/trees/' + tree.repeat(40) + '?recursive=1', { kind: 'get', data: { sha: tree.repeat(40), truncated: false, tree: fileItems.map(file => ({ path: file.filename, type: 'blob', mode: '100644', sha: blobOid(['1', '3'].includes(tree) ? beforeText : afterText) })) } });
  for (const text of [beforeText, afterText]) mock.routes.set(prefix + '/git/blobs/' + blobOid(text), { kind: 'get', data: { sha: blobOid(text), encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') } });
  return detail;
}
function addIssueEvent(mock, { id = '751', issueId = '51', issueNumber = '1', date = '2026-10-14T16:00:00Z', event = 'labeled' } = {}) {
  const value = { id, event, created_at: date, actor: user, issue: { id: issueId, number: issueNumber }, label: { id: '601', name: 'not-returned' }, assignee: user, milestone: { id: '88' }, body: 'RAW_BODY_MUST_NOT_RETURN' };
  mock.routes.get(paths.events).items.push(value);
  mock.routes.set(prefix + '/issues/' + issueNumber, { kind: 'get', data: { id: issueId, number: issueNumber, user: { id: '2002', type: 'User' }, created_at: '2010-01-01T00:00:00Z', labels: [], body: 'RAW_BODY_MUST_NOT_RETURN', title: 'RAW_TITLE_MUST_NOT_RETURN' } });
  return value;
}
function fileScenario(mock, { kind = 'modified', beforePath = 'docs/old.md', afterPath = 'docs/old.md', beforeText = '# before\n', afterText = '# after\n', mode = '100644', type = 'blob' } = {}) {
  const detail = addPr(mock);
  const left = beforeText === null ? null : { path: beforePath, sha: blobOid(beforeText), mode, type };
  const right = afterText === null ? null : { path: afterPath, sha: blobOid(afterText), mode, type };
  const file = { filename: afterPath ?? beforePath, status: kind, sha: (right ?? left).sha };
  if (['renamed', 'copied'].includes(kind)) file.previous_filename = beforePath;
  mock.routes.get(prefix + '/pulls/4/files?per_page=100').items = [file];
  for (const tree of ['1', '2', '3', '4']) {
    const beforeSide = ['1', '3'].includes(tree);
    mock.routes.get(prefix + '/git/trees/' + tree.repeat(40) + '?recursive=1').data.tree = beforeSide ? left ? [left] : [] : kind === 'copied' ? [left, right] : right ? [right] : [];
  }
  for (const text of [beforeText, afterText].filter(value => value !== null)) mock.routes.set(prefix + '/git/blobs/' + blobOid(text), { kind: 'get', data: { sha: blobOid(text), encoding: 'base64', size: Buffer.byteLength(text), content: Buffer.from(text).toString('base64') } });
  return detail;
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
  assert.equal(result.capabilities.fullBeforeAfterFileContents, 'supported_for_proven_candidate_prs');
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

test('candidate file text is hash-verified at actual merge-base/head, never advanced base-tip guesses', async () => {
  const mock = setup(); addPr(mock); const result = await ready(mock); const file = result.capture.files[0];
  assert.equal(file.observedBlobOid, blobOid('# New fixture\n')); assert.equal(file.contentProof, 'text_pair');
  assert.equal(file.beforeText, '# Old fixture\n'); assert.equal(file.beforeOid, blobOid(file.beforeText));
  assert.equal(file.afterText, '# New fixture\n'); assert.equal(file.afterOid, blobOid(file.afterText));
  assert.equal(result.capture.pullRequests[0].diffBaseOid, 'f'.repeat(40));
  assert.ok(!mock.calls.some(call => call.path.includes('/compare/' + 'a'.repeat(40))));
  assert.equal(mock.calls.find(call => call.path.includes('/files?')).options.maxPages, 30);
});

test('added/removed/renamed/copied files retain exact null sides and old/new paths', async () => {
  for (const scenario of [
    { kind: 'added', beforePath: null, beforeText: null, afterPath: 'docs/new.md' },
    { kind: 'removed', afterPath: null, afterText: null, beforePath: 'docs/old.md' },
    { kind: 'renamed', beforePath: 'docs/old.md', afterPath: 'docs/new.md' },
    { kind: 'copied', beforePath: 'docs/old.md', afterPath: 'docs/new.md' },
  ]) {
    const mock = setup(); fileScenario(mock, scenario); const result = await ready(mock); const file = result.capture.files[0];
    assert.equal(file.beforePath, scenario.beforePath); assert.equal(file.afterPath, scenario.afterPath);
    assert.equal(file.beforeOid === null, scenario.kind === 'added'); assert.equal(file.afterOid === null, scenario.kind === 'removed');
    assert.equal(file.beforeText === null, scenario.kind === 'added'); assert.equal(file.afterText === null, scenario.kind === 'removed');
    assert.equal(file.contentProof, 'text_pair');
  }
});

test('squash/rebase one-parent merge accepted only when exact merged diff matches PR inventory', async () => {
  const mock = setup(); addPr(mock); mock.routes.get(prefix + '/git/commits/' + 'd'.repeat(40)).data.parents = [{ sha: 'e'.repeat(40) }];
  const result = await ready(mock); assert.equal(result.capture.pullRequests[0].mergeParentOid, 'e'.repeat(40));
});

test('wrong merge parent, advanced/conflicting merge effect and incomplete trees hold rather than guess', async () => {
  const parent = setup(); addPr(parent); parent.routes.get(prefix + '/git/commits/' + 'd'.repeat(40)).data.parents[1].sha = '9'.repeat(40); await held(parent, 'PR_MERGE_PROOF_AMBIGUOUS');
  const conflict = setup(); addPr(conflict); conflict.routes.get(prefix + '/git/trees/' + '3'.repeat(40) + '?recursive=1').data.tree[0].sha = '8'.repeat(40); await held(conflict, 'PR_MERGED_DIFF_AMBIGUOUS');
  const incomplete = setup(); addPr(incomplete); incomplete.routes.get(prefix + '/git/trees/' + '1'.repeat(40) + '?recursive=1').data.truncated = true; await held(incomplete, 'GIT_TREE_INCOMPLETE');
});

test('independent full-tree diff catches omitted changes even matching PR count claims', async () => {
  const mock = setup(); addPr(mock);
  for (const tree of ['2', '4']) mock.routes.get(prefix + '/git/trees/' + tree.repeat(40) + '?recursive=1').data.tree.push({ path: 'docs/omitted.md', mode: '100644', type: 'blob', sha: blobOid('hidden') });
  await held(mock, 'PR_DIFF_INVENTORY_MISMATCH');
});

test('symlink, submodule and binary content are unsupported, never text_pair guesses', async () => {
  for (const [mode, type] of [['120000', 'blob'], ['160000', 'commit']]) {
    const mock = setup(); fileScenario(mock, { mode, type }); await held(mock, 'PR_FILE_MODE_UNSUPPORTED');
  }
  const binary = setup(); fileScenario(binary, { afterText: 'binary\0payload' }); await held(binary, 'GIT_BLOB_BINARY_OR_NON_UTF8');
});

test('full blob hash, byte size, encoding and UTF8 must all agree', async () => {
  const mismatch = setup(); addPr(mismatch); mismatch.routes.get(prefix + '/git/blobs/' + blobOid('# New fixture\n')).data.content = Buffer.from('tampered text\n').toString('base64');
  mismatch.routes.get(prefix + '/git/blobs/' + blobOid('# New fixture\n')).data.size = Buffer.byteLength('tampered text\n');
  await held(mismatch, 'GIT_BLOB_HASH_MISMATCH');
  const tooLarge = setup(); addPr(tooLarge); tooLarge.routes.get(prefix + '/git/blobs/' + blobOid('# New fixture\n')).data.size = 1024 * 1024 + 1; await held(tooLarge, 'GIT_BLOB_UNAVAILABLE_OR_TOO_LARGE');
  const encoding = setup(); addPr(encoding); encoding.routes.get(prefix + '/git/blobs/' + blobOid('# New fixture\n')).data.encoding = 'utf-8'; await held(encoding, 'GIT_BLOB_UNAVAILABLE_OR_TOO_LARGE');
});

test('BOM and multibyte source text stay byte-exact, cached blobs do not repeat requests', async () => {
  const mock = setup(); fileScenario(mock, { beforeText: '\uFEFF한글 😀 before\n', afterText: '\uFEFF한글 😀 after\n' }); const result = await ready(mock);
  assert.equal(result.capture.files[0].afterText, '\uFEFF한글 😀 after\n');
  const many = setup(); addPr(many, { files: 3 }); await ready(many);
  assert.equal(many.calls.filter(call => call.path.includes('/git/blobs/')).length, 2);
});

test('known irrelevant PRs skip file/text requests but preserve complete review history', async () => {
  for (const condition of ['other', 'bot', 'open', 'old']) {
    const mock = setup(); const pr = addPr(mock);
    if (condition === 'other') pr.user = { id: '2002', type: 'User' };
    else if (condition === 'bot') pr.user = { id: '1001', type: 'Bot' };
    else if (condition === 'open') { pr.state = 'open'; pr.merged_at = null; }
    else pr.merged_at = '2010-01-01T00:00:00Z';
    const result = await ready(mock); assert.equal(result.capture.files.length, 0); assert.equal(result.capture.pullRequests[0].fileProof, 'not_collected');
    assert.equal(mock.calls.some(call => call.path.includes('/files?') || call.path.includes('/git/blobs/')), false);
    assert.equal(mock.calls.some(call => call.path.includes('/reviews?')), true);
  }
});

test('collector exposes actual client page snapshots and rejects invented flattened-page provenance', async () => {
  const mock = setup(); mock.routes.get(paths.pulls).pages = 2;
  const result = await ready(mock); const query = result.capture.queries.find(item => item.kind === 'pull_requests');
  assert.deepEqual(query.pageSnapshots.map(page => [page.sequence, page.itemCount, page.startIndex, page.endIndexExclusive]), [[1, 0, 0, 0], [2, 0, 0, 0]]);
  const absent = setup(); const paginate = absent.client.paginate; absent.client.paginate = async (...args) => { const result = await paginate(...args); delete result.pageSnapshots; return result; };
  await held(absent, 'CAPTURE_PAGE_PROVENANCE_UNAVAILABLE');
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

test('observed model is explicit and unsupported models fail before any port call', async () => {
  const legacy = setup(); const result = await ready(legacy); assert.equal(Object.hasOwn(result.capture, 'model'), false);
  const mock = observed(); const current = await ready(mock);
  assert.equal(current.capture.model, 'observed-api-v1');
  assert.equal(current.capabilities.observedCommittedDate, 'supported');
  const unknown = setup(); unknown.request.model = 'caller-invented-model'; await held(unknown, 'COLLECTION_MODEL_UNSUPPORTED'); assert.equal(unknown.calls.length, 0);
});

test('observed ancestry is bound to one actually observed default-branch HEAD', async () => {
  const mock = observed(); const result = await ready(mock);
  assert.equal(result.capture.repositories[0].defaultBranchHeadOid, '9'.repeat(40));
  const query = result.capture.queries.find(item => item.kind === 'default_branch_commits');
  assert.deepEqual(query.filters, { branch: 'main', headOid: '9'.repeat(40), ancestry: 'all', reflectionTimeFromAuthorDate: false });
  assert.ok(mock.calls.some(call => call.path === prefix + '/commits?sha=' + '9'.repeat(40) + '&per_page=100'));
  assert.equal(mock.calls.some(call => call.path === paths.commits), false);
  const wrong = observed(); wrong.routes.get(prefix + '/git/ref/heads/main').data.object.type = 'tag'; await held(wrong, 'DEFAULT_BRANCH_HEAD_INVALID');
});

test('observed direct commits use Git committer date, not authored date or first-reflection assertions', async () => {
  const mock = observed(); addCommit(mock); const result = await ready(mock);
  const commit = result.capture.commits[0];
  assert.equal(commit.committedAt, '2026-10-14T09:00:00Z'); assert.equal(commit.defaultBranchMembership, 'current_ancestry');
  assert.equal(commit.defaultBranchReflectionProof, 'unsupported'); assert.equal(Object.hasOwn(commit, 'reflectedAt'), false);
  assert.equal(commit.firstParentOid, '7'.repeat(40)); assert.equal(commit.treeOid, '6'.repeat(40)); assert.equal(commit.parentTreeOid, '5'.repeat(40));
  assert.equal(commit.fileProof, 'complete_revision_inventory'); assert.equal(commit.changedFiles, 1); assert.equal(commit.fullFileContents, 'text_pair');
  const pair = result.capture.files[0]; assert.equal(pair.commitOid, commit.oid); assert.equal(Object.hasOwn(pair, 'pullRequestId'), false);
  assert.equal(pair.beforeText, 'old code\n'); assert.equal(pair.afterText, 'new code\n'); assert.equal(pair.contentProof, 'text_pair');
  const inventory = result.capture.queries.find(query => query.kind === 'commit_files');
  assert.equal(inventory.receivedItems, 1); assert.equal(inventory.parentId, commit.oid); assert.deepEqual(inventory.filters, { wholeParentRevision: true });
});

test('genesis direct commit proves an empty before side with parents[] rather than a fabricated parent', async () => {
  const mock = observed(); addCommit(mock, { root: true, beforeText: null }); const result = await ready(mock);
  const commit = result.capture.commits[0]; const file = result.capture.files[0];
  assert.equal(commit.firstParentOid, null); assert.equal(commit.parentTreeOid, null);
  assert.equal(file.kind, 'added'); assert.equal(file.beforePath, null); assert.equal(file.beforeOid, null); assert.equal(file.beforeText, null);
  assert.equal(mock.calls.some(call => call.path === prefix + '/git/commits/' + '7'.repeat(40)), false);
});

test('complete parent associations exclude a represented commit before any direct file request', async () => {
  const mock = observed(); addObservedPr(mock); addCommit(mock);
  mock.routes.get(prefix + '/commits/' + '8'.repeat(40) + '/pulls?per_page=100').items = [{ id: '17' }];
  const result = await ready(mock); assert.deepEqual(result.capture.commits[0].associatedPrIds, ['17']);
  assert.equal(result.capture.commits[0].fullFileContents, 'not_collected');
  assert.equal(result.capture.files.some(file => file.commitOid), false);
  assert.equal(mock.calls.some(call => call.path === prefix + '/commits/' + '8'.repeat(40) + '?per_page=100'), false);
  const missing = observed(); addCommit(missing); missing.routes.get(prefix + '/commits/' + '8'.repeat(40) + '/pulls?per_page=100').items = [{ id: '999' }]; await held(missing, 'ASSOCIATED_PR_DETAIL_UNAVAILABLE');
});

test('old/future/current-cutoff/bot/other/fork direct commits never cause unnecessary content reads', async () => {
  for (const condition of ['old', 'future', 'cutoff', 'bot', 'other', 'fork']) {
    const mock = observed();
    addCommit(mock, { committedAt: condition === 'old' ? '2010-01-01T00:00:00Z' : condition === 'future' ? '2027-01-01T00:00:00Z' : condition === 'cutoff' ? '2026-10-15T00:00:00Z' : '2026-10-14T09:00:00Z', author: condition === 'bot' ? { id: '1001', type: 'Bot' } : condition === 'other' ? { id: '2002', type: 'User' } : user, authoredAt: '2026-10-14T09:00:00Z' });
    if (condition === 'fork') mock.routes.get(paths.metadata).data.fork = true;
    const result = await ready(mock); assert.equal(result.capture.files.length, 0, condition);
    assert.equal(result.capture.commits[0].fileProof, 'not_collected');
    assert.equal(mock.calls.some(call => call.path.includes('/git/blobs/') || call.path.endsWith('/commits/' + '8'.repeat(40) + '?per_page=100')), false, condition);
  }
});

test('observed direct content binds SHA, actual first parent and committed date across metadata endpoints', async () => {
  const date = observed(); const dateDetail = addCommit(date); dateDetail.commit.committer.date = '2026-10-13T09:00:00Z'; await held(date, 'COMMIT_DATE_MISMATCH');
  const parent = observed(); const detail = addCommit(parent); detail.parents = [{ sha: '4'.repeat(40) }]; await held(parent, 'COMMIT_PARENT_MISMATCH');
  const sha = observed(); const shaDetail = addCommit(sha); shaDetail.sha = '3'.repeat(40); await held(sha, 'COMMIT_DETAIL_INVALID');
  const malformed = observed(); addCommit(malformed); delete malformed.routes.get(paths.commits).items[0].commit.committer.date; await held(malformed, 'SOURCE_TIMESTAMP_INVALID');
});

test('independent first-parent tree inventory rejects omitted direct file changes and truncated trees', async () => {
  const omitted = observed(); addCommit(omitted); omitted.routes.get(prefix + '/git/trees/' + '6'.repeat(40) + '?recursive=1').data.tree.push({ path: 'src/hidden.ts', sha: blobOid('hidden'), type: 'blob', mode: '100644' });
  await held(omitted, 'COMMIT_DIFF_INVENTORY_MISMATCH');
  const truncated = observed(); addCommit(truncated); truncated.routes.get(prefix + '/git/trees/' + '5'.repeat(40) + '?recursive=1').data.truncated = true; await held(truncated, 'GIT_TREE_INCOMPLETE');
});

test('direct rename keeps a same-content text pair instead of inventing removed+added activity', async () => {
  const mock = observed(); addCommit(mock, { kind: 'renamed', beforePath: 'src/old.ts', afterPath: 'src/new.ts', beforeText: 'same code\n', afterText: 'same code\n' });
  const result = await ready(mock); const file = result.capture.files[0];
  assert.equal(result.capture.files.length, 1); assert.equal(file.kind, 'renamed'); assert.equal(file.beforePath, 'src/old.ts'); assert.equal(file.afterPath, 'src/new.ts');
  assert.equal(file.beforeText, file.afterText); assert.equal(file.beforeOid, file.afterOid);
});

test('observed current labels come from a closed label endpoint, not embedded current-label assumptions', async () => {
  const mock = observed(); addObservedPr(mock); const result = await ready(mock); const pr = result.capture.pullRequests[0];
  assert.deepEqual(pr.currentLabels, []); assert.equal(pr.labelsProof, 'complete_current_labels');
  assert.deepEqual(pr.closingIssueIds, []); assert.equal(pr.excludedClosingIssueCount, 0); assert.equal(pr.closingIssuesProof, 'complete_current_resolving_issues');
  const labelsQuery = result.capture.queries.find(query => query.kind === 'observed_current_labels');
  assert.deepEqual(labelsQuery.filters, { observation: 'current', targetKind: 'pull_request' }); assert.equal(labelsQuery.receivedItems, 0);
  assert.equal(result.capture.queries.find(query => query.kind === 'observed_closing_issues').receivedItems, 0);
  const uppercase = observed(); addObservedPr(uppercase); uppercase.routes.get(prefix + '/issues/4/labels?per_page=100').items = [{ id: '601', name: 'BuG' }];
  assert.deepEqual((await ready(uppercase)).capture.pullRequests[0].currentLabels, [{ type: 'numeric', value: '601', name: 'BuG' }]);
});

test('public closing issues outside activity scope supply only explicit current public label evidence', async () => {
  const mock = observed(); addObservedPr(mock); const closing = mock.closing.get('owner/project:4');
  closing.items = [{ repositoryId: '9901', repositoryName: 'external/issue-repository', number: '8', sourceId: { type: 'numeric', value: '88' } }];
  closing.totalCount = 1; Object.assign(closing.pageSnapshots[0], { itemCount: 1, includedCount: 1, endIndexExclusive: 1, endCursor: 'last-cursor' });
  mock.routes.set('/repositories/9901', { kind: 'get', data: { id: '9901', full_name: 'external/renamed-issues', private: false, visibility: 'public' } });
  mock.routes.set('/repos/external/renamed-issues/issues/8', { kind: 'get', data: { id: '88', number: '8', state: 'open', user: { id: '2002', type: 'User' }, created_at: '2010-01-01T00:00:00Z', labels: [], body: 'RAW_BODY_MUST_NOT_RETURN' } });
  mock.routes.set('/repos/external/renamed-issues/issues/8/labels?per_page=100', { kind: 'paginate', items: [{ id: '606', name: 'bug' }], pages: 1 });
  const result = await ready(mock); const pr = result.capture.pullRequests[0]; const issue = result.capture.issues[0];
  assert.deepEqual(pr.closingIssueIds, [{ repositoryId: '9901', number: '8', sourceId: { type: 'numeric', value: '88' } }]);
  assert.equal(issue.repositoryId, '9901'); assert.equal(issue.visibility, 'public'); assert.equal(issue.state, 'OPEN'); assert.deepEqual(issue.currentLabels, [{ type: 'numeric', value: '606', name: 'bug' }]);
  assert.deepEqual(result.capture.repositories.map(repository => repository.repositoryId), ['9001']);
});

test('confirmed private closing issues are count-only excluded without source identity disclosure', async () => {
  const mock = observed(); addObservedPr(mock); const closing = mock.closing.get('owner/project:4');
  closing.totalCount = 2; closing.excludedPrivateCount = 2;
  Object.assign(closing.pageSnapshots[0], { itemCount: 2, includedCount: 0, excludedPrivateCount: 2, endIndexExclusive: 2 });
  const result = await ready(mock); assert.equal(result.capture.pullRequests[0].excludedClosingIssueCount, 2); assert.deepEqual(result.capture.issues, []);
  const query = result.capture.queries.find(item => item.kind === 'observed_closing_issues'); assert.equal(query.receivedItems, 2); assert.equal(query.excludedPrivateCount, 2);
});

test('observed closing and triage share one bound issue/current-label snapshot instead of duplicate public resources', async () => {
  const mock = observed(); addObservedPr(mock); addIssueEvent(mock);
  mock.routes.get(prefix + '/issues/1').data.state = 'closed';
  mock.routes.set(prefix + '/issues/1/labels?per_page=100', { kind: 'paginate', items: [{ id: '601', name: 'bug' }], pages: 1 });
  const closing = mock.closing.get('owner/project:4');
  closing.items = [{ repositoryId: '9001', repositoryName: 'owner/project', number: '1', sourceId: { type: 'numeric', value: '51' } }]; closing.totalCount = 1;
  Object.assign(closing.pageSnapshots[0], { itemCount: 1, includedCount: 1, endIndexExclusive: 1 });
  const result = await ready(mock);
  assert.equal(result.capture.issues.length, 1); assert.equal(result.capture.issues[0].state, 'CLOSED'); assert.equal(result.capture.issueEvents.length, 1);
  assert.equal(mock.calls.filter(call => call.path === prefix + '/issues/1').length, 1);
  assert.equal(result.capture.queries.filter(query => query.kind === 'observed_current_labels' && query.parentId === '51').length, 1);
});

test('all six supported triage actions preserve their explicit stable target kind', async () => {
  for (const event of ['labeled', 'unlabeled', 'assigned', 'unassigned', 'milestoned', 'demilestoned']) {
    const mock = setup(); addIssueEvent(mock, { event }); const result = await ready(mock);
    assert.equal(result.capture.issueEvents[0].target.kind, ['labeled', 'unlabeled'].includes(event) ? 'label' : ['assigned', 'unassigned'].includes(event) ? 'assignee' : 'milestone');
  }
});

test('label/closing partial pages, wrong parent and falsified GraphQL closure hold all capture', async () => {
  const labels = observed(); addObservedPr(labels); labels.routes.get(prefix + '/issues/4/labels?per_page=100').failure = 'PAGE_LIMIT_REACHED'; await held(labels, 'PAGE_LIMIT_REACHED');
  const parent = observed(); addObservedPr(parent); parent.closing.get('owner/project:4').pullRequestId = '999'; await held(parent, 'CLOSING_ISSUES_PARENT_MISMATCH');
  const partial = observed(); addObservedPr(partial); partial.closing.get('owner/project:4').complete = false; await held(partial, 'CLOSING_ISSUES_UNAVAILABLE');
  const counts = observed(); addObservedPr(counts); counts.closing.get('owner/project:4').totalCount = 1; await held(counts, 'CLOSING_ISSUES_COUNT_MISMATCH');
  const provenance = observed(); addObservedPr(provenance); provenance.closing.get('owner/project:4').pageSnapshots[0].requestCursor = 'invented'; await held(provenance, 'CLOSING_ISSUES_PROVENANCE_INVALID');
  const capability = observed(); addObservedPr(capability); delete capability.client.closingIssues; await held(capability, 'CLOSING_ISSUES_CAPABILITY_UNAVAILABLE');
});

test('a required public closing issue404 or private-scope race never becomes a no-bug assertion', async () => {
  for (const failure of ['REPOSITORY_UNAVAILABLE', 'private']) {
    const mock = observed(); addObservedPr(mock); const closing = mock.closing.get('owner/project:4');
    closing.items = [{ repositoryId: '9901', repositoryName: 'external/issues', number: '8', sourceId: { type: 'numeric', value: '88' } }]; closing.totalCount = 1;
    Object.assign(closing.pageSnapshots[0], { itemCount: 1, includedCount: 1, endIndexExclusive: 1 });
    mock.routes.set('/repositories/9901', failure === 'private' ? { kind: 'get', data: { id: '9901', full_name: 'external/issues', private: true, visibility: 'private' } } : { kind: 'get', failure });
    await held(mock, failure === 'private' ? 'LINKED_ISSUE_SCOPE_CHANGED' : failure);
  }
});

test('observed unmatched/excluded paths keep complete true revision inventory without loading irrelevant binary bodies', async () => {
  for (const path of ['assets/logo.png', 'app.config.toml', '.commitkin/card.png', '.commitkin/ledger.json']) {
    const mock = observed(); addCommit(mock, { beforePath: path, afterPath: path, beforeText: 'before\0binary', afterText: 'after\0binary', mode: '120000' });
    const result = await ready(mock); const pair = result.capture.files[0];
    assert.equal(pair.contentProof, 'not_required', path); assert.equal(Object.hasOwn(pair, 'beforeText'), false); assert.equal(Object.hasOwn(pair, 'afterText'), false);
    assert.equal(pair.beforeOid, blobOid('before\0binary')); assert.equal(pair.afterOid, blobOid('after\0binary'));
    assert.equal(result.capture.commits[0].changedFiles, 1); assert.equal(mock.calls.some(call => call.path.includes('/git/blobs/')), false, path);
  }
});

test('observed known-category binary/symlink changes still hold, never non-contributing guesses', async () => {
  const binary = observed(); addCommit(binary, { afterText: 'source\0binary' }); await held(binary, 'GIT_BLOB_BINARY_OR_NON_UTF8');
  const symlink = observed(); addCommit(symlink, { mode: '120000' }); await held(symlink, 'COMMIT_FILE_MODE_UNSUPPORTED');
});

test('observed unmatched PR binary paths retain closure and skip text only, legacy strict mode still holds', async () => {
  const mock = observed(); fileScenario(mock, { beforePath: 'assets/logo.png', afterPath: 'assets/logo.png', beforeText: 'before\0binary', afterText: 'after\0binary', mode: '120000' });
  mock.routes.set(prefix + '/issues/4/labels?per_page=100', { kind: 'paginate', items: [], pages: 1 });
  mock.closing.set('owner/project:4', { ok: true, complete: true, repositoryId: '9001', repositoryName: 'owner/project', pullRequestId: '17', pullNumber: '4', items: [], excludedPrivateCount: 0, totalCount: 0, pages: 1, pageSnapshots: [{ sequence: 1, requestCursor: null, endCursor: null, hasNextPage: false, itemCount: 0, includedCount: 0, excludedPrivateCount: 0, startIndex: 0, endIndexExclusive: 0 }] });
  const result = await ready(mock); assert.equal(result.capture.files[0].contentProof, 'not_required');
  assert.equal(result.capture.pullRequests[0].fileProof, 'complete_revision_inventory');
  const legacy = setup(); fileScenario(legacy, { beforePath: 'assets/logo.png', afterPath: 'assets/logo.png', mode: '120000' }); await held(legacy, 'PR_FILE_MODE_UNSUPPORTED');
});

test('actual injected GitHub client collects101 direct files across pages and independently matches both full trees', async () => {
  for (const dropContinuation of [false, true]) {
    const mock = observed(); const detail = addCommit(mock);
    detail.files = Array.from({ length: 101 }, (_, index) => ({ filename: `src/${index}.ts`, sha: blobOid('new code\n'), status: 'modified' }));
    for (const [tree, text] of [['5', 'old code\n'], ['6', 'new code\n']]) mock.routes.get(prefix + '/git/trees/' + tree.repeat(40) + '?recursive=1').data.tree = detail.files.map(file => ({ path: file.filename, type: 'blob', mode: '100644', sha: blobOid(text) }));
    const calls = []; const filePath = prefix + '/commits/' + '8'.repeat(40) + '?per_page=100';
    const client = createGithubClient({ token: 'test_not_a_real_token', maxRetries: 0, requestBudget: 1000, fetchImpl: async (url, init) => {
      assert.equal(init.method, 'GET'); const path = url.slice('https://api.github.com'.length); calls.push(path);
      if (path === filePath || path === filePath + '&page=2') {
        const second = path.endsWith('page=2');
        return new Response(JSON.stringify({ ...detail, files: detail.files.slice(second ? 100 : 0, second ? 101 : 100) }), { headers: !second && !dropContinuation ? { link: `<https://api.github.com${filePath}&page=2>; rel="next"` } : {} });
      }
      const route = mock.routes.get(path); assert.ok(route, 'Unexpected injected request ' + path);
      return new Response(JSON.stringify(route.kind === 'get' ? route.data : route.items));
    } });
    mock.request.client = client;
    const result = await collectPublicSources(mock.request);
    if (dropContinuation) { assert.equal(result.decision, 'hold'); assert.equal(result.code, 'COMMIT_DIFF_INVENTORY_MISMATCH'); assert.equal(result.capture, null); }
    else {
      assert.equal(result.decision, 'ready', result.code); assert.equal(result.capture.commits[0].changedFiles, 101); assert.equal(result.capture.files.length, 101);
      const query = result.capture.queries.find(item => item.kind === 'commit_files'); assert.equal(query.pages, 2); assert.equal(query.receivedItems, 101);
      assert.deepEqual(query.pageSnapshots.map(page => [page.itemCount, page.startIndex, page.endIndexExclusive]), [[100, 0, 100], [1, 100, 101]]);
      assert.equal(calls.filter(path => path.includes('/git/blobs/')).length, 2);
    }
  }
});

test('direct file pagination capability and actual count/provenance are required rather than inferred', async () => {
  const missing = observed(); addCommit(missing); delete missing.client.commitFiles; await held(missing, 'COMMIT_FILES_CAPABILITY_UNAVAILABLE');
  const count = observed(); addCommit(count); const commitFiles = count.client.commitFiles; count.client.commitFiles = async input => { const result = await commitFiles(input); result.receivedItems += 1; return result; }; await held(count, 'COMMIT_FILE_COUNT_MISMATCH');
  const snapshots = observed(); addCommit(snapshots); const original = snapshots.client.commitFiles; snapshots.client.commitFiles = async input => { const result = await original(input); result.pageSnapshots[0].requestPath += '&invented=true'; return result; }; await held(snapshots, 'CAPTURE_PAGE_PROVENANCE_INVALID');
  const tree = observed(); const detail = addCommit(tree); detail.commit.tree.sha = '4'.repeat(40); await held(tree, 'COMMIT_TREE_MISMATCH');
  const cap = observed(); addCommit(cap); cap.client.commitFiles = async () => ({ ok: false, complete: false, code: 'COMMIT_FILE_LIMIT_REACHED', files: [] }); await held(cap, 'COMMIT_FILE_LIMIT_REACHED');
});
