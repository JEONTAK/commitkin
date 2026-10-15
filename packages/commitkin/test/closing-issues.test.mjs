import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSING_ISSUES_QUERY, createGithubClient } from '../src/infrastructure/github/client.mjs';

const TOKEN = 'test_not_a_real_secret_token';
const input = { repository: 'owner/project', pullNumber: '7' };
function response(data, status = 200, headers = {}) { return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers }); }
function options(fetchImpl, extra = {}) { return { token: TOKEN, fetchImpl, maxRetries: 0, waitImpl: async () => {}, ...extra }; }
function issue(id = '901', number = 3, repository = {}) {
  return { fullDatabaseId: id, number, repository: { fullDatabaseId: '100', nameWithOwner: 'owner/project', isPrivate: false, ...repository } };
}
function payload(nodes = [issue()], connection = {}, repo = {}, pull = {}) {
  return { data: { repository: { fullDatabaseId: '100', nameWithOwner: 'owner/project', isPrivate: false, ...repo, pullRequest: {
    fullDatabaseId: '700', number: 7, ...pull, closingIssuesReferences: { totalCount: nodes.length, nodes, pageInfo: { hasNextPage: false, endCursor: nodes.length ? 'last-cursor' : null }, ...connection },
  } } } };
}
function clientWith(pages, extra = {}) {
  const calls = [];
  const client = createGithubClient(options(async (url, init) => {
    calls.push({ url, init, body: init.body === undefined ? null : JSON.parse(init.body) });
    const page = pages[calls.length - 1];
    return typeof page === 'function' ? page(url, init) : response(page);
  }, extra));
  return { client, calls };
}
function failed(result, code, pages = 0) {
  assert.equal(result.ok, false); assert.equal(result.complete, false); assert.equal(result.code, code); assert.equal(result.pages, pages);
  assert.deepEqual(result.items, []); assert.equal(JSON.stringify(result).includes(TOKEN), false);
}

test('closing issues uses only the fixed read-only document and fixed GitHub API with scoped variables', async () => {
  const { client, calls } = clientWith([payload()]);
  const result = await client.closingIssues(input);
  assert.equal(result.ok, true); assert.equal(result.complete, true); assert.equal(result.pages, 1); assert.equal(result.totalCount, 1);
  assert.deepEqual(result.items, [{ repositoryId: '100', repositoryName: 'owner/project', number: '3', sourceId: { type: 'numeric', value: '901' } }]);
  assert.equal(result.repositoryId, '100'); assert.equal(result.pullRequestId, '700'); assert.equal(result.pullNumber, '7');
  assert.equal(calls[0].url, 'https://api.github.com/graphql'); assert.equal(calls[0].init.method, 'POST'); assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(calls[0].body, { operationName: 'CommitkinClosingIssues', query: CLOSING_ISSUES_QUERY, variables: { owner: 'owner', name: 'project', number: 7, after: null } });
  assert.equal(/\bmutation\b/.test(CLOSING_ISSUES_QUERY), false);
  assert.equal(/\b(?:body|bodyText|url|title|labels)\b/.test(CLOSING_ISSUES_QUERY), false);
  assert.equal(typeof client.post, 'undefined'); assert.equal(typeof client.request, 'undefined');
});

test('closed empty connection is complete with one real zero-item page', async () => {
  const { client } = clientWith([payload([])]);
  const result = await client.closingIssues(input);
  assert.equal(result.ok, true); assert.deepEqual(result.items, []); assert.equal(result.totalCount, 0); assert.equal(result.excludedPrivateCount, 0);
  assert.deepEqual(result.pageSnapshots, [{ sequence: 1, requestCursor: null, endCursor: null, hasNextPage: false, itemCount: 0, includedCount: 0, excludedPrivateCount: 0, startIndex: 0, endIndexExclusive: 0 }]);
});

test('multiple pages follow actual cursors and retain real raw count ranges', async () => {
  const { client, calls } = clientWith([
    payload([issue()], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } }),
    payload([issue('902', 4, { fullDatabaseId: '101', nameWithOwner: 'other/public' })], { totalCount: 2 }),
  ]);
  const result = await client.closingIssues(input);
  assert.equal(result.ok, true); assert.equal(result.pages, 2); assert.equal(result.items.length, 2);
  assert.equal(calls[1].body.variables.after, 'cursor-1'); assert.equal(calls[1].body.query, CLOSING_ISSUES_QUERY);
  assert.deepEqual(result.pageSnapshots, [
    { sequence: 1, requestCursor: null, endCursor: 'cursor-1', hasNextPage: true, itemCount: 1, includedCount: 1, excludedPrivateCount: 0, startIndex: 0, endIndexExclusive: 1 },
    { sequence: 2, requestCursor: 'cursor-1', endCursor: 'last-cursor', hasNextPage: false, itemCount: 1, includedCount: 1, excludedPrivateCount: 0, startIndex: 1, endIndexExclusive: 2 },
  ]);
});

test('fullDatabaseId remains an exact string beyond JavaScript safe integer precision', async () => {
  const id = '900719925474099312345';
  const { client } = clientWith([payload([issue(id, 3, { fullDatabaseId: id, nameWithOwner: 'other/public' })], {}, {}, { fullDatabaseId: id })]);
  const result = await client.closingIssues(input);
  assert.equal(result.ok, true); assert.equal(result.items[0].sourceId.value, id); assert.equal(result.items[0].repositoryId, id); assert.equal(result.pullRequestId, id);
});

test('confirmed private linked issues contribute counts only and leak no private identities', async () => {
  const privateIssue = issue('987654321', 54321, { fullDatabaseId: '8888888', nameWithOwner: 'hidden/private-repository', isPrivate: true });
  const { client } = clientWith([payload([privateIssue, issue()])]);
  const result = await client.closingIssues(input);
  assert.equal(result.ok, true); assert.equal(result.totalCount, 2); assert.equal(result.excludedPrivateCount, 1); assert.equal(result.items.length, 1);
  assert.equal(result.pageSnapshots[0].itemCount, 2); assert.equal(result.pageSnapshots[0].includedCount, 1); assert.equal(result.pageSnapshots[0].excludedPrivateCount, 1);
  for (const secret of ['987654321', '54321', '8888888', 'hidden/private-repository']) assert.equal(JSON.stringify(result).includes(secret), false);
});

test('all-private closing connection can close without pretending no references exist', async () => {
  const { client } = clientWith([payload([issue('902', 4, { fullDatabaseId: '101', nameWithOwner: 'other/private', isPrivate: true })])]);
  const result = await client.closingIssues(input);
  assert.equal(result.ok, true); assert.equal(result.totalCount, 1); assert.equal(result.excludedPrivateCount, 1); assert.deepEqual(result.items, []);
});

for (const value of [undefined, null, [], {}, { ...input, query: 'mutation { evil }' }, { ...input, repository: 'https://evil.test/x' },
  { ...input, repository: 'owner/..' }, { ...input, repository: 'owner/x\n' }, { ...input, repository: 'owner/repo/path' },
  ...[7, '0', '-1', '01', '7.0', '2147483648', '9007199254740993', '7) { mutation }'].map(pullNumber => ({ ...input, pullNumber }))]) {
  test(`unsafe closing input is rejected before fetch: ${JSON.stringify(value)}`, async () => {
    const { client, calls } = clientWith([]); failed(await client.closingIssues(value), 'CLOSING_ISSUES_INPUT_INVALID'); assert.equal(calls.length, 0);
  });
}
for (const maxPages of [0, -1, 1.5, 101, '10', null, Infinity]) {
  test(`invalid closing page bound is rejected before fetch: ${maxPages}`, async () => {
    const { client, calls } = clientWith([]); failed(await client.closingIssues({ ...input, maxPages }), 'PAGINATION_OPTIONS_INVALID'); assert.equal(calls.length, 0);
  });
}

test('GraphQL Int upper bound is passed exactly, never by lossy conversion', async () => {
  const { client, calls } = clientWith([payload([], {}, {}, { number: 2147483647 })]);
  assert.equal((await client.closingIssues({ ...input, pullNumber: '2147483647' })).ok, true); assert.equal(calls[0].body.variables.number, 2147483647);
});

test('input repository case is accepted only for the same canonical GitHub name', async () => {
  const { client } = clientWith([payload([], {}, { nameWithOwner: 'Owner/Project' })]);
  const result = await client.closingIssues(input); assert.equal(result.ok, true); assert.equal(result.repositoryName, 'Owner/Project');
});

for (const [errors, code] of [[[{ type: 'RATE_LIMITED', message: TOKEN }], 'RATE_LIMITED'], [[{ type: 'FORBIDDEN', message: TOKEN }], 'ACCESS_DENIED'],
  [[{ type: 'NOT_FOUND', message: TOKEN }], 'REPOSITORY_UNAVAILABLE'], [[{ type: TOKEN, message: TOKEN }], 'CLOSING_ISSUES_QUERY_FAILED'],
  [null, 'CLOSING_ISSUES_RESPONSE_INVALID'], [{ message: TOKEN }, 'CLOSING_ISSUES_RESPONSE_INVALID']]) {
  test(`HTTP 200 partial GraphQL error rejects all source rows: ${code}`, async () => {
    const { client } = clientWith([{ ...payload(), errors }]); failed(await client.closingIssues(input), code);
  });
}

for (const [label, modify, code = 'CLOSING_ISSUES_RESPONSE_INVALID'] of [
  ['missing payload', () => null], ['array payload', () => []], ['missing data', () => ({})],
  ['unknown repository', () => ({ data: { repository: null } }), 'REPOSITORY_UNAVAILABLE'],
  ['unknown pull request', value => { value.data.repository.pullRequest = null; return value; }, 'REPOSITORY_UNAVAILABLE'],
  ['private parent', value => { value.data.repository.isPrivate = true; return value; }, 'ACCESS_DENIED'],
  ['wrong parent name', value => { value.data.repository.nameWithOwner = 'other/repository'; return value; }, 'CLOSING_ISSUES_IDENTITY_MISMATCH'],
  ['wrong pull number', value => { value.data.repository.pullRequest.number = 8; return value; }, 'CLOSING_ISSUES_IDENTITY_MISMATCH'],
  ['numeric BigInt', value => { value.data.repository.fullDatabaseId = 100; return value; }],
  ['zero BigInt', value => { value.data.repository.fullDatabaseId = '0'; return value; }],
  ['noncanonical BigInt', value => { value.data.repository.fullDatabaseId = '0100'; return value; }],
  ['missing visibility', value => { delete value.data.repository.isPrivate; return value; }],
  ['missing connection', value => { delete value.data.repository.pullRequest.closingIssuesReferences; return value; }],
  ['null issue', value => { value.data.repository.pullRequest.closingIssuesReferences.nodes = [null]; return value; }],
  ['null issue repository', value => { value.data.repository.pullRequest.closingIssuesReferences.nodes[0].repository = null; return value; }],
  ['unknown linked visibility', value => { delete value.data.repository.pullRequest.closingIssuesReferences.nodes[0].repository.isPrivate; return value; }],
  ['missing issue ID', value => { delete value.data.repository.pullRequest.closingIssuesReferences.nodes[0].fullDatabaseId; return value; }],
  ['fractional issue number', value => { value.data.repository.pullRequest.closingIssuesReferences.nodes[0].number = 3.5; return value; }],
  ['null nodes', value => { value.data.repository.pullRequest.closingIssuesReferences.nodes = null; return value; }],
  ['noninteger total', value => { value.data.repository.pullRequest.closingIssuesReferences.totalCount = '1'; return value; }],
  ['negative total', value => { value.data.repository.pullRequest.closingIssuesReferences.totalCount = -1; return value; }],
  ['missing page info', value => { delete value.data.repository.pullRequest.closingIssuesReferences.pageInfo; return value; }],
  ['nonboolean continuation', value => { value.data.repository.pullRequest.closingIssuesReferences.pageInfo.hasNextPage = 'false'; return value; }],
  ['missing cursor field', value => { delete value.data.repository.pullRequest.closingIssuesReferences.pageInfo.endCursor; return value; }],
  ['invalid cursor', value => { value.data.repository.pullRequest.closingIssuesReferences.pageInfo.endCursor = '\n'; return value; }],
]) {
  test(`malformed or mismatched closing capture holds: ${label}`, async () => {
    const { client } = clientWith([modify(payload())]); failed(await client.closingIssues(input), code);
  });
}

for (const [label, connection, code] of [
  ['early terminal', { totalCount: 2 }, 'CLOSING_ISSUES_COUNT_MISMATCH'],
  ['more nodes than total', { totalCount: 0 }, 'CLOSING_ISSUES_COUNT_MISMATCH'],
  ['continuation with count already exhausted', { totalCount: 1, pageInfo: { hasNextPage: true, endCursor: 'next' } }, 'CLOSING_ISSUES_COUNT_MISMATCH'],
  ['continuation without cursor', { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: null } }, 'CLOSING_ISSUES_RESPONSE_INVALID'],
]) {
  test(`count and continuation closure rejects: ${label}`, async () => {
    const { client } = clientWith([payload([issue()], connection)]); failed(await client.closingIssues(input), code);
  });
}

test('empty nonterminal page and oversized server page cannot claim closure', async () => {
  for (const value of [payload([], { totalCount: 1, pageInfo: { hasNextPage: true, endCursor: 'next' } }), payload(Array.from({ length: 101 }, (_, n) => issue(String(n + 901), n + 1)))]) {
    const { client } = clientWith([value]); failed(await client.closingIssues(input), 'CLOSING_ISSUES_RESPONSE_INVALID');
  }
});

test('cursor cycle, count drift and parent identity drift discard previously captured rows', async () => {
  for (const [second, code] of [
    [payload([issue('902', 4)], { totalCount: 3, pageInfo: { hasNextPage: true, endCursor: 'next' } }), 'PAGINATION_CYCLE'],
    [payload([issue('902', 4)], { totalCount: 2 }), 'CLOSING_ISSUES_COUNT_CHANGED'],
    [payload([issue('902', 4)], { totalCount: 3 }, { fullDatabaseId: '200' }), 'CLOSING_ISSUES_IDENTITY_MISMATCH'],
    [payload([issue('902', 4)], { totalCount: 3 }, {}, { fullDatabaseId: '800' }), 'CLOSING_ISSUES_IDENTITY_MISMATCH'],
  ]) {
    const { client } = clientWith([payload([issue()], { totalCount: 3, pageInfo: { hasNextPage: true, endCursor: 'next' } }), second]);
    failed(await client.closingIssues(input), code, 1);
  }
});

test('duplicate issue identity or repository/number fails instead of silently deduplicating', async () => {
  for (const nodes of [[issue(), issue('901', 4)], [issue(), issue('902', 3)]]) {
    const { client } = clientWith([payload(nodes)]); failed(await client.closingIssues(input), 'CLOSING_ISSUES_DUPLICATE');
  }
});

test('one repository identity cannot change name, ID or visibility within a connection', async () => {
  for (const nodes of [
    [issue('902', 4, { nameWithOwner: 'other/name' })],
    [issue('902', 4, { fullDatabaseId: '101' })],
    [issue('902', 4, { isPrivate: true })],
    [issue('901', 3, { fullDatabaseId: '101', nameWithOwner: 'other/public' }), issue('902', 4, { fullDatabaseId: '101', nameWithOwner: 'other/renamed' })],
  ]) {
    const { client } = clientWith([payload(nodes)]); failed(await client.closingIssues(input), 'CLOSING_ISSUES_IDENTITY_MISMATCH');
  }
});

test('page limit exhaustion does not return a usable partial connection', async () => {
  const { client, calls } = clientWith([payload([issue()], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'next' } })]);
  failed(await client.closingIssues({ ...input, maxPages: 1 }), 'PAGE_LIMIT_REACHED', 1); assert.equal(calls.length, 1);
});

test('fixed GraphQL request shares the REST request budget with no anonymous fallback', async () => {
  const { client, calls } = clientWith([{}], { requestBudget: 1 });
  await client.get('/user'); failed(await client.closingIssues(input), 'REQUEST_BUDGET_EXHAUSTED'); assert.equal(calls.length, 1);
});

test('budget exhaustion mid-pagination discards partial results and does not request again', async () => {
  const { client, calls } = clientWith([payload([issue()], { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: 'next' } })], { requestBudget: 1 });
  failed(await client.closingIssues(input), 'REQUEST_BUDGET_EXHAUSTED', 1); assert.equal(calls.length, 1);
});

test('read-only POST network failure is not misreported as an ambiguous write', async () => {
  const { client, calls } = clientWith([() => { throw new Error(TOKEN); }], { maxRetries: 3 });
  failed(await client.closingIssues(input), 'NETWORK_UNAVAILABLE'); assert.equal(calls.length, 1);
});

test('read-only query timeout is bounded even when fetch ignores AbortSignal', async () => {
  const { client } = clientWith([() => new Promise(() => {})], { timeoutMs: 5 });
  failed(await client.closingIssues(input), 'NETWORK_UNAVAILABLE');
});

test('transport redirect, HTTP, strict JSON and size protections apply unchanged to the fixed query', async () => {
  for (const [makeResponse, extra, code] of [
    [() => response('', 302, { location: 'https://evil.test' }), {}, 'REDIRECT_REJECTED'],
    [() => response({ message: TOKEN }, 403), {}, 'ACCESS_DENIED'],
    [() => response({ message: TOKEN }, 429), {}, 'RATE_LIMITED'],
    [() => response({ message: TOKEN }, 404), {}, 'REPOSITORY_UNAVAILABLE'],
    [() => response('{"data":{},"data":{}}'), {}, 'RESPONSE_JSON_INVALID'],
    [() => response('{"data":{"id":9007199254740993}}'), {}, 'UNSAFE_JSON_INTEGER'],
    [() => response(payload()), { maxResponseBytes: 100 }, 'RESPONSE_TOO_LARGE'],
  ]) {
    const { client } = clientWith([makeResponse], extra); failed(await client.closingIssues(input), code);
  }
});
