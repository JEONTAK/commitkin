import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubClient, createGithubPublisher, discoverRepositories } from '../src/infrastructure/github/index.mjs';

const TOKEN = 'test_not_a_real_secret_token';
const HEAD = 'a'.repeat(40); const BASE = 'b'.repeat(40); const TREE = 'c'.repeat(40); const COMMIT = 'd'.repeat(40); const BLOB = 'e'.repeat(40);
const bytes = text => new TextEncoder().encode(text);
function response(data, status = 200, headers = {}) { return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers }); }
function options(fetchImpl, extra = {}) { return { token: TOKEN, fetchImpl, maxRetries: 0, waitImpl: async () => {}, ...extra }; }
function repo(id = 1, full_name = 'owner/project', extras = {}) { return { id, node_id: 'R_kgDOTestRepository', full_name, owner: { id: 1001, type: 'User' }, private: false, visibility: 'public', fork: false, archived: false, default_branch: 'main', ...extras }; }
function files() { return ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/card.png', 'README.md'].map(path => ({ path, content: bytes(path.endsWith('json') ? '{}' : path.endsWith('png') ? 'png bytes test only' : '<!-- commitkin:start -->ok<!-- commitkin:end -->') })); }
function publication(input = {}) { return { repository: 'owner/owner', defaultBranch: 'main', expectedHead: HEAD, files: files(), ...input }; }
function publishMock({ mutationStatus = 200, mutationErrors = null, ambiguousMutation = false, confirmed = false, changed = false } = {}) {
  const calls = []; let mutated = false;
  return { calls, fetch: async (url, init) => {
    const path = new URL(url).pathname; const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method, body });
    if (path === '/repos/owner/owner') return response(repo(9001, 'owner/owner'));
    if (path === '/repos/owner/owner/git/ref/heads/main') return response({ object: { sha: mutated ? COMMIT : changed ? 'f'.repeat(40) : HEAD } });
    if (path === '/repos/owner/owner/git/commits/' + HEAD) return response({ sha: HEAD, tree: { sha: BASE } });
    if (path.endsWith('/git/blobs')) return response({ sha: BLOB }, 201);
    if (path.endsWith('/git/trees')) return response({ sha: TREE }, 201);
    if (path.endsWith('/git/commits')) return response({ sha: COMMIT }, 201);
    if (path === '/graphql') {
      if (ambiguousMutation) { mutated = confirmed; throw new Error('private raw ' + TOKEN); }
      if (mutationErrors) return response({ data: { updateRefs: null }, errors: mutationErrors });
      if (mutationStatus === 200) mutated = true;
      return response({ data: { updateRefs: { clientMutationId: body.variables.input.clientMutationId } } }, mutationStatus);
    }
    throw new Error('Unexpected test request');
  } };
}

test('read-only capability performs fixed-host GET with redirect denial and no write method', async () => {
  const calls = [];
  const client = createGithubClient(options(async (url, init) => { calls.push({ url, init }); return response({ id: 1 }); }));
  assert.equal(typeof client.post, 'undefined'); assert.equal(typeof client.request, 'undefined');
  assert.deepEqual((await client.get('/user')).data, { id: 1 });
  assert.equal(calls[0].url, 'https://api.github.com/user');
  assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(JSON.stringify(client).includes(TOKEN), false);
});
test('arbitrary URL/userinfo/path traversal/encoding/control destinations never call fetch', async () => {
  let calls = 0; const client = createGithubClient(options(async () => { calls += 1; return response({}); }));
  for (const path of ['https://evil.test/x', '//evil.test/x', '/a/../user', '/a/%2e%2e/user', '/%2f%2fevil.test', '/a\\b', '/a#x', '/a\nAuthorization:evil']) assert.equal((await client.get(path)).code, 'GITHUB_DESTINATION_REJECTED');
  assert.equal(calls, 0);
});
test('redirect status, followed redirects and mismatched responseURLs are rejected', async () => {
  for (const value of [response('', 302, { location: 'https://evil.test' }), { redirected: true, status: 200 }, { redirected: false, status: 200, url: 'https://api.github.com/other' }]) {
    const client = createGithubClient(options(async () => value));
    assert.equal((await client.get('/user')).code, 'REDIRECT_REJECTED');
  }
});
test('unsafe numeric IDs reject before normalization while large string IDs survive', async () => {
  const unsafe = createGithubClient(options(async () => response('{"id":9007199254740993}')));
  assert.equal((await unsafe.get('/user')).code, 'UNSAFE_JSON_INTEGER');
  const safe = createGithubClient(options(async () => response({ id: '900719925474099312345' })));
  assert.equal((await safe.get('/user')).data.id, '900719925474099312345');
});
test('strict JSON response rejects duplicate keys, malformedUnicode and nonfinite values', async () => {
  for (const data of ['{"id":1,"id":2}', '{"x":1e999}', '{"x":"\\ud800"}', '/* no */{}']) {
    const client = createGithubClient(options(async () => response(data)));
    assert.equal((await client.get('/user')).code, 'RESPONSE_JSON_INVALID');
  }
});
test('response-byte limit applies to declared and streamed sizes without outputting payload', async () => {
  for (const headers of [{}, { 'content-length': '1000' }]) {
    const client = createGithubClient(options(async () => response({ token: TOKEN.repeat(10) }, 200, headers), { maxResponseBytes: 30 }));
    const result = await client.get('/user');
    assert.equal(result.code, 'RESPONSE_TOO_LARGE'); assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});
test('timeouts are bounded even if an injected fetch ignoresAbortSignal', async () => {
  const client = createGithubClient(options(async () => new Promise(() => {}), { timeoutMs: 5 }));
  assert.equal((await client.get('/user')).code, 'NETWORK_UNAVAILABLE');
});
test('GET transient retries use bounded exponential waits and budget counts everyrequest', async () => {
  let calls = 0; const waits = [];
  const client = createGithubClient(options(async () => { calls += 1; return calls < 3 ? response({}, 503) : response({ ok: true }); }, { maxRetries: 2, waitImpl: async delay => waits.push(delay) }));
  assert.equal((await client.get('/user')).ok, true); assert.deepEqual(waits, [1000, 2000]); assert.equal(client.budget().used, 3);
});
test('HTTP403/429/404 distinguish authorization, rate and unknown repository', async () => {
  for (const [status, headers, code] of [[403, {}, 'ACCESS_DENIED'], [403, { 'x-ratelimit-remaining': '0' }, 'RATE_LIMITED'], [429, {}, 'RATE_LIMITED'], [404, {}, 'REPOSITORY_UNAVAILABLE']]) {
    const client = createGithubClient(options(async () => response({ message: TOKEN }, status, headers)));
    const result = await client.get('/user'); assert.equal(result.code, code); assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});
test('exhausted requestbudget doesnot attempt another request or anonymous fallback', async () => {
  let calls = 0; const client = createGithubClient(options(async () => { calls += 1; return response({}); }, { requestBudget: 1 }));
  assert.equal((await client.get('/user')).ok, true); assert.equal((await client.get('/user')).code, 'REQUEST_BUDGET_EXHAUSTED'); assert.equal(calls, 1);
});
test('pagination follows bounded verified sameendpoint Links and preservescaptureditems', async () => {
  let calls = 0;
  const client = createGithubClient(options(async () => ++calls === 1 ? response([{ id: 1 }], 200, { link: '<https://api.github.com/users/owner/repos?per_page=100&page=2>; rel="next"' }) : response([{ id: 2 }])));
  const result = await client.paginate('/users/owner/repos?per_page=100');
  assert.equal(result.complete, true); assert.deepEqual(result.items.map(item => item.id), [1, 2]); assert.equal(result.pages, 2);
  assert.deepEqual(result.pageSnapshots, [
    { sequence: 1, requestPath: '/users/owner/repos?per_page=100', itemCount: 1, nextPath: '/users/owner/repos?per_page=100&page=2', startIndex: 0, endIndexExclusive: 1 },
    { sequence: 2, requestPath: '/users/owner/repos?per_page=100&page=2', itemCount: 1, nextPath: null, startIndex: 1, endIndexExclusive: 2 },
  ]);
  assert.equal(JSON.stringify(result.pageSnapshots).includes('id'), false);
});

test('verified repository/user pagination follows only their bound canonical numeric aliases', async () => {
  for (const [path, binding, canonical] of [
    ['/repos/cli/cli/pulls?state=closed&per_page=1', { repositoryId: '212613049' }, '/repositories/212613049/pulls?state=closed&per_page=1&page=2'],
    ['/users/JEONTAK/repos?type=owner&sort=full_name&per_page=1', { subjectAccountId: '76037656' }, '/user/76037656/repos?type=owner&sort=full_name&per_page=1&page=2'],
  ]) {
    const calls = [];
    const client = createGithubClient(options(async url => { calls.push(url); return calls.length === 1 ? response([{ id: '1' }], 200, { link: `<https://api.github.com${canonical}>; rel="next"` }) : response([{ id: '2' }]); }));
    const result = await client.paginate(path, binding); assert.equal(result.ok, true, result.code); assert.equal(result.items.length, 2);
    assert.equal(calls[1], 'https://api.github.com' + canonical); assert.equal(result.pageSnapshots[1].requestPath, canonical);
  }
});

test('numeric aliases require a verified string ID and never authorize other paths, hosts, subjects or filters', async () => {
  const initial = '/users/JEONTAK/repos?type=owner&sort=full_name&per_page=100';
  for (const [binding, target, code] of [
    [{}, '/user/76037656/repos?type=owner&sort=full_name&per_page=100&page=2', 'PAGINATION_DESTINATION_REJECTED'],
    [{ subjectAccountId: '76037656' }, '/user/76037657/repos?type=owner&sort=full_name&per_page=100&page=2', 'PAGINATION_DESTINATION_REJECTED'],
    [{ subjectAccountId: '76037656' }, '/user/76037656/events/public?type=owner&sort=full_name&per_page=100&page=2', 'PAGINATION_DESTINATION_REJECTED'],
    [{ subjectAccountId: '76037656' }, '/users/someone/repos?type=owner&sort=full_name&per_page=100&page=2', 'PAGINATION_DESTINATION_REJECTED'],
    [{ subjectAccountId: '76037656' }, '/user/76037656/repos?type=member&sort=full_name&per_page=100&page=2', 'PAGINATION_QUERY_CHANGED'],
    [{ subjectAccountId: '76037656' }, '/user/76037656/repos?type=owner&sort=full_name&per_page=100&page=4', 'PAGINATION_PAGE_INVALID'],
    [{ subjectAccountId: '76037656' }, '/user/76037656/repos?type=owner&sort=full_name&per_page=100&cursor=next', 'PAGINATION_QUERY_CHANGED'],
  ]) {
    const calls = []; const client = createGithubClient(options(async url => { calls.push(url); return response([], 200, { link: `<https://api.github.com${target}>; rel="next"` }); }));
    const result = await client.paginate(initial, binding); assert.equal(result.ok, false); assert.equal(result.code, code); assert.equal(calls.length, 1);
  }
  for (const binding of [{ subjectAccountId: 76037656 }, { subjectAccountId: '076037656' }, { subjectAccountId: null }, { subjectAccountId: '76037656', repositoryId: '9001' }, { repositoryId: '9001' }]) {
    let calls = 0; const client = createGithubClient(options(async () => { calls += 1; return response([]); }));
    assert.equal((await client.paginate(initial, binding)).code, 'PAGINATION_BINDING_INVALID'); assert.equal(calls, 0);
  }
});

test('bound user public-events alias keeps its exact suffix and real page paths', async () => {
  const initial = '/users/owner/events/public?per_page=100'; const canonical = '/user/1001/events/public?per_page=100&page=2';
  let calls = 0; const client = createGithubClient(options(async () => ++calls === 1 ? response([], 200, { link: `<https://api.github.com${canonical}>; rel="next"` }) : response([])));
  const result = await client.paginate(initial, { subjectAccountId: '1001' }); assert.equal(result.ok, true, result.code); assert.equal(result.pageSnapshots[1].requestPath, canonical);
  const arbitrary = createGithubClient(options(async () => { throw new Error('must not request arbitrary alias API'); }));
  assert.equal((await arbitrary.paginate('/users/owner/keys', { subjectAccountId: '1001' })).code, 'PAGINATION_BINDING_INVALID');
});
test('pagination rejects external link/path swap/query rewrite/cycle and invalidsyntax', async () => {
  const cases = [
    ['<https://evil.test/users/owner/repos?page=2>; rel="next"', 'PAGINATION_DESTINATION_REJECTED'],
    ['<https://api.github.com/user?page=2>; rel="next"', 'PAGINATION_DESTINATION_REJECTED'],
    ['<https://api.github.com/users/owner/repos?type=member&page=2>; rel="next"', 'PAGINATION_QUERY_CHANGED'],
    ['<https://api.github.com/users/owner/repos?type=owner>; rel="next"', 'PAGINATION_CYCLE'],
    ['not a link', 'PAGINATION_INVALID'],
  ];
  for (const [link, code] of cases) {
    const client = createGithubClient(options(async () => response([], 200, { link })));
    assert.equal((await client.paginate('/users/owner/repos?type=owner')).code, code);
  }
});
test('pagebudget is explicit incomplete, never successful empty activity', async () => {
  const client = createGithubClient(options(async () => response([], 200, { link: '<https://api.github.com/repos/owner/project/issues?page=2>; rel="next"' })));
  const result = await client.paginate('/repos/owner/project/issues', { maxPages: 1 });
  assert.equal(result.ok, false); assert.equal(result.complete, false); assert.equal(result.code, 'PAGE_LIMIT_REACHED');
});
test('page snapshots preserve real empty-page boundaries and do not duplicate raw resource payloads', async () => {
  let calls = 0;
  const client = createGithubClient(options(async () => {
    calls += 1;
    if (calls === 1) return response([{ id: '1', body: 'RAW_BODY_NOT_IN_PAGE_SNAPSHOT' }, { id: '2' }], 200, { link: '<https://api.github.com/repos/owner/project/pulls?state=all&page=2>; rel="next"' });
    if (calls === 2) return response([], 200, { link: '<https://api.github.com/repos/owner/project/pulls?state=all&page=3>; rel="next"' });
    return response([{ id: '3' }]);
  }));
  const result = await client.paginate('/repos/owner/project/pulls?state=all');
  assert.equal(result.complete, true);
  assert.deepEqual(result.pageSnapshots.map(page => [page.itemCount, page.startIndex, page.endIndexExclusive]), [[2, 0, 2], [0, 2, 2], [1, 2, 3]]);
  assert.equal(result.pageSnapshots.at(-1).nextPath, null);
  assert.equal(JSON.stringify(result.pageSnapshots).includes('RAW_BODY'), false);
});
test('failed later page preserves only observed successful page snapshots without completing the capture', async () => {
  let calls = 0;
  const client = createGithubClient(options(async () => ++calls === 1 ? response([{ id: '1' }], 200, { link: '<https://api.github.com/repos/owner/project/pulls?page=2>; rel="next"' }) : response({}, 403)));
  const result = await client.paginate('/repos/owner/project/pulls');
  assert.equal(result.complete, false); assert.equal(result.code, 'ACCESS_DENIED');
  assert.equal(result.pageSnapshots.length, 1); assert.equal(result.pageSnapshots[0].nextPath, '/repos/owner/project/pulls?page=2');
});
test('invalid options are rejected without network', () => {
  for (const extra of [{ token: 'secret\nHeader:bad' }, { requestBudget: 0 }, { timeoutMs: 60001 }, { maxRetries: 4 }, { fetchImpl: undefined }]) assert.throws(() => createGithubClient(options(async () => response({}), extra)), /GITHUB_OPTIONS_INVALID/);
});

function discoveryMock(routes = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    assert.equal(init.method, 'GET'); const path = new URL(url).pathname; calls.push(path);
    if (Object.hasOwn(routes, path)) { const item = routes[path]; return item instanceof Response ? item : response(item); }
    if (path === '/users/owner/repos' || path === '/users/owner/events/public') return response([]);
    return response({}, 404);
  };
  return { client: createGithubClient(options(fetch)), calls };
}
test('discovery unionsautomatic/additional/tracked IDs and preservesarchived/fork metadata', async () => {
  const mock = discoveryMock({ '/users/owner/repos': [repo(1)], '/users/owner/events/public': [{ repo: { id: 2, name: 'org/other' } }], '/repos/org/other': repo(2, 'org/other'), '/repositories/2': repo(2, 'org/other', { archived: true }), '/repositories/3': repo(3, 'new/renamed', { fork: true }) });
  const result = await discoverRepositories({ client: mock.client, login: 'owner', additional: ['ORG/other'], tracked: [{ id: '3', discoveredVia: ['additional'] }] });
  assert.equal(result.decision, 'ready'); assert.deepEqual(result.repositories.map(item => item.id), ['1', '2', '3']);
  assert.deepEqual(result.repositories[1].discoveredVia, ['additional', 'automatic']);
  assert.equal(result.repositories[1].archived, true); assert.equal(result.repositories[2].fork, true);
  assert.equal(result.limitations.includes('OTHER_PUBLIC_REPOSITORIES_MAY_BE_MISSING'), true);
});
test('explicitexclusion winsadditional/autodiscovery/tracked and verified rename ID', async () => {
  const mock = discoveryMock({ '/repos/old/name': repo(1, 'new/name'), '/users/owner/repos': [repo(1, 'new/name')] });
  const result = await discoverRepositories({ client: mock.client, login: 'owner', additional: ['old/name'], exclude: ['OLD/name'], tracked: [{ id: '1' }] });
  assert.equal(result.decision, 'ready'); assert.equal(result.repositories.length, 0); assert.equal(result.tracked[0].tracking, 'excluded');
  assert.equal(mock.calls.includes('/repositories/1'), false);
});
test('knowntracked404 holds and retainsID instead of inferringdeleted/private/empty', async () => {
  const mock = discoveryMock();
  const result = await discoverRepositories({ client: mock.client, login: 'owner', tracked: [{ id: '123', discoveredVia: ['automatic'] }] });
  assert.equal(result.decision, 'hold'); assert.equal(result.codes.includes('REPOSITORY_UNAVAILABLE'), true);
  assert.deepEqual(result.tracked, [{ id: '123', tracking: 'unavailable', discoveredVia: ['automatic'] }]);
});
test('confirmedprivate/internal areexcluded, not falsely unavailable', async () => {
  const mock = discoveryMock({ '/repositories/1': repo(1, 'owner/private', { private: true, visibility: 'private' }), '/repos/org/internal': repo(2, 'org/internal', { private: true, visibility: 'internal' }) });
  const result = await discoverRepositories({ client: mock.client, login: 'owner', tracked: [{ id: '1' }], additional: ['org/internal'] });
  assert.equal(result.decision, 'ready'); assert.equal(result.repositories.length, 0); assert.equal(result.tracked.every(item => item.tracking === 'outside_public_scope'), true);
});
test('trackedID metadata mismatch holds and doesnot reassignidentity', async () => {
  const mock = discoveryMock({ '/repositories/1': repo(2) });
  const result = await discoverRepositories({ client: mock.client, login: 'owner', tracked: [{ id: '1' }] });
  assert.equal(result.decision, 'hold'); assert.equal(result.codes.includes('REPOSITORY_ID_MISMATCH'), true); assert.equal(result.tracked[0].id, '1');
});
test('unknownadditional404 and discoverybudget failures hold wholeknownscope', async () => {
  const mock = discoveryMock();
  const result = await discoverRepositories({ client: mock.client, login: 'owner', additional: ['org/missing'] });
  assert.equal(result.decision, 'hold'); assert.equal(result.codes.includes('REPOSITORY_UNAVAILABLE'), true);
});
test('discovery refusesURLs/wildcards/noncanonicalIDs before requests', async () => {
  const mock = discoveryMock();
  for (const input of [{ additional: ['https://github.com/org/repo'] }, { exclude: ['org/*'] }, { tracked: [{ id: 9007199254740992 }] }, { login: '../user' }]) assert.equal((await discoverRepositories({ client: mock.client, login: 'owner', ...input })).code, 'DISCOVERY_INPUT_INVALID');
  assert.equal(mock.calls.length, 0);
});

test('discovery forwards an installation-verified subject ID to both public user lists', async () => {
  const calls = []; let repoPages = 0;
  const client = createGithubClient(options(async (url, init) => {
    assert.equal(init.method, 'GET'); const parsed = new URL(url); calls.push(parsed.pathname);
    if (parsed.pathname === '/users/owner/repos') { repoPages += 1; return response([repo(1)], 200, { link: '<https://api.github.com/user/1001/repos?type=owner&sort=full_name&per_page=100&page=2>; rel="next"' }); }
    if (parsed.pathname === '/user/1001/repos') { repoPages += 1; return response([repo(2, 'owner/second')]); }
    if (parsed.pathname === '/users/owner/events/public') return response([], 200, { link: '<https://api.github.com/user/1001/events/public?per_page=100&page=2>; rel="next"' });
    if (parsed.pathname === '/user/1001/events/public') return response([]);
    assert.fail('Unexpected discovery alias request');
  }));
  const result = await discoverRepositories({ client, login: 'owner', subjectAccountId: '1001' });
  assert.equal(result.decision, 'ready', JSON.stringify(result.codes)); assert.equal(repoPages, 2); assert.deepEqual(result.repositories.map(item => item.id), ['1', '2']);
  assert.ok(calls.includes('/user/1001/events/public'));
  const bad = discoveryMock(); assert.equal((await discoverRepositories({ client: bad.client, login: 'owner', subjectAccountId: 1001 })).code, 'DISCOVERY_INPUT_INVALID'); assert.equal(bad.calls.length, 0);
});

test('grouped publication creates five blobs, one base tree, one parent commit and atomic expected-head mutation', async () => {
  const mock = publishMock(); const publisher = createGithubPublisher(options(mock.fetch));
  const result = await publisher.publish(publication());
  assert.equal(result.published, true); assert.equal(result.commitSha, COMMIT);
  assert.equal(mock.calls.filter(call => call.path.endsWith('/git/blobs')).length, 5);
  const tree = mock.calls.find(call => call.path.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree, BASE); assert.deepEqual(tree.tree.map(item => item.path), files().map(item => item.path).sort());
  const commit = mock.calls.find(call => call.path.endsWith('/git/commits')).body;
  assert.deepEqual(commit.parents, [HEAD]); assert.equal(commit.tree, TREE);
  const mutation = mock.calls.find(call => call.path === '/graphql');
  assert.equal(mutation.method, 'POST');
  assert.deepEqual(mutation.body.variables.input, { repositoryId: 'R_kgDOTestRepository', clientMutationId: 'commitkin-' + COMMIT, refUpdates: [{ name: 'refs/heads/main', beforeOid: HEAD, afterOid: COMMIT, force: false }] });
  assert.equal(mutation.body.query, 'mutation CommitkinUpdateRefs($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }');
  assert.equal(mock.calls.at(-1).path, '/repos/owner/owner/git/ref/heads/main');
  assert.equal(mock.calls.some(call => call.method === 'PATCH'), false);
  assert.equal(mock.calls.some(call => call.path.includes('/contents/')), false);
});
test('publication rejectsotherpaths/pathtraversal/duplicate/missingfiles andunpreparedbytes', async () => {
  const mock = publishMock(); const publisher = createGithubPublisher(options(mock.fetch));
  for (const candidate of [files().slice(1), [...files().slice(1), { path: '../README.md', content: bytes('x') }], [...files().slice(1), { path: '.github/workflows/run.yml', content: bytes('x') }], [...files().slice(1), files()[1]], files().map(item => ({ ...item, content: 'raw' }))]) assert.equal((await publisher.publish(publication({ files: candidate }))).code, 'PUBLICATION_INPUT_INVALID');
  assert.equal(mock.calls.length, 0);
});
test('publication rejects token/privatekey content beforemakingrequests', async () => {
  const mock = publishMock(); const publisher = createGithubPublisher(options(mock.fetch)); const candidate = files(); candidate[0].content = bytes('{"secret":"' + TOKEN + '"}');
  const result = await publisher.publish(publication({ files: candidate })); assert.equal(result.code, 'PUBLICATION_SENSITIVE_CONTENT'); assert.equal(mock.calls.length, 0); assert.equal(JSON.stringify(result).includes(TOKEN), false);
});
test('headmismatch stopsbeforecreatingobjects and neversilently overwritesconcurrentstate', async () => {
  const mock = publishMock({ changed: true });
  assert.equal((await createGithubPublisher(options(mock.fetch)).publish(publication())).code, 'REMOTE_CHANGED');
  assert.equal(mock.calls.every(call => call.method === 'GET'), true);
});
test('atomic mutation errors return a sanitized hold without REST fallback or mutation retry', async () => {
  const mock = publishMock({ mutationErrors: [{ type: 'UNPROCESSABLE', message: TOKEN, path: ['updateRefs'] }] });
  const result = await createGithubPublisher(options(mock.fetch)).publish(publication());
  assert.equal(result.published, false); assert.equal(result.code, 'GRAPHQL_MUTATION_REJECTED'); assert.equal(mock.calls.filter(call => call.path === '/graphql').length, 1);
  assert.equal(mock.calls.some(call => call.method === 'PATCH'), false); assert.equal(JSON.stringify(result).includes(TOKEN), false);
});
test('ambiguous GraphQL mutation is never retried; only ref readback can confirm success', async () => {
  for (const confirmed of [false, true]) {
    const mock = publishMock({ ambiguousMutation: true, confirmed });
    const result = await createGithubPublisher(options(mock.fetch, { maxRetries: 2 })).publish(publication());
    assert.equal(result.published, confirmed); assert.equal(mock.calls.filter(call => call.path === '/graphql').length, 1);
    assert.equal(result.code, confirmed ? 'PUBLISHED_READBACK_CONFIRMED' : 'WRITE_OUTCOME_UNKNOWN');
    assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
});
test('ambiguousblobcreation neverretriesunconfirmedwrite', async () => {
  const mock = publishMock(); const fetch = async (url, init) => { if (new URL(url).pathname.endsWith('/git/blobs')) throw new Error(TOKEN); return mock.fetch(url, init); };
  const result = await createGithubPublisher(options(fetch, { maxRetries: 3 })).publish(publication());
  assert.equal(result.code, 'WRITE_OUTCOME_UNKNOWN'); assert.equal(mock.calls.some(call => call.method === 'PATCH'), false);
});
test('publication metadata/defaultbranch mismatch preventswrites', async () => {
  const mock = publishMock(); const fetch = async (url, init) => new URL(url).pathname === '/repos/owner/owner' ? response(repo(9001, 'owner/owner', { default_branch: 'other' })) : mock.fetch(url, init);
  assert.equal((await createGithubPublisher(options(fetch)).publish(publication())).code, 'PUBLICATION_REPOSITORY_MISMATCH');
  assert.equal(mock.calls.length, 0);
});
test('publication invalidbranch/repository/head failclosed withsanitizedcode', async () => {
  const mock = publishMock(); const publisher = createGithubPublisher(options(mock.fetch));
  for (const input of [{ repository: '../other' }, { defaultBranch: '../main' }, { expectedHead: 'main' }]) assert.equal((await publisher.publish(publication(input))).code, 'PUBLICATION_INPUT_INVALID');
  assert.equal(mock.calls.length, 0);
});
test('publication defensivelycopiespreparedbytes beforeasyncnetwork', async () => {
  const mock = publishMock(); const candidate = files(); const first = new Uint8Array(candidate[0].content);
  const fetch = async (url, init) => { candidate[0].content.fill(0); return mock.fetch(url, init); };
  assert.equal((await createGithubPublisher(options(fetch)).publish(publication({ files: candidate }))).published, true);
  const bodies = mock.calls.filter(call => call.path.endsWith('/git/blobs')).map(call => Buffer.from(call.body.content, 'base64'));
  assert.equal(bodies.some(content => content.equals(Buffer.from(first))), true);
});
test('retrywait failure issanitized ratherthanleakinginjectedexceptions', async () => {
  const client = createGithubClient(options(async () => { throw new Error(TOKEN); }, { maxRetries: 1, waitImpl: async () => { throw new Error(TOKEN); } }));
  const result = await client.get('/user'); assert.equal(result.code, 'RETRY_WAIT_UNAVAILABLE'); assert.equal(JSON.stringify(result).includes(TOKEN), false);
});
test('pagination cannot addnonpaging filters or changeperpage', async () => {
  for (const next of ['?type=owner&per_page=100&q=secret&page=2', '?type=owner&per_page=50&page=2']) {
    const client = createGithubClient(options(async () => response([], 200, { link: `<https://api.github.com/users/owner/repos${next}>; rel="next"` })));
    assert.equal((await client.paginate('/users/owner/repos?type=owner&per_page=100')).code, 'PAGINATION_QUERY_CHANGED');
  }
});
test('encoded branch slashes are valid query values, never encoded endpoint separators', async () => {
  const calls = [];
  const client = createGithubClient(options(async (url) => { calls.push(url); return response([]); }));
  const path = '/repos/owner/project/commits?' + new URLSearchParams({ sha: 'release/main', per_page: '100' });
  assert.equal((await client.get(path)).ok, true);
  assert.equal(new URL(calls[0]).searchParams.get('sha'), 'release/main');
  assert.equal((await client.get('/repos/owner%2Fproject/commits?sha=release%2Fmain')).code, 'GITHUB_DESTINATION_REJECTED');
  assert.equal(calls.length, 1);
});
test('publication rechecks the head before mutation and stops an already observable race', async () => {
  const mock = publishMock(); let refs = 0;
  const fetch = async (url, init) => { if (new URL(url).pathname.endsWith('/git/ref/heads/main') && ++refs === 2) return response({ object: { sha: 'f'.repeat(40) } }); return mock.fetch(url, init); };
  assert.equal((await createGithubPublisher(options(fetch)).publish(publication())).code, 'REMOTE_CHANGED');
  assert.equal(mock.calls.some(call => call.path === '/graphql'), false);
});
test('concurrent branch rewind after final read is rejected by the atomic beforeOid condition', async () => {
  const mock = publishMock(); let actualHead = HEAD;
  const calls = [];
  const fetch = async (url, init) => {
    const path = new URL(url).pathname; calls.push({ path, method: init.method });
    if (path === '/graphql') {
      // Simulate an allowed external rewind after the read. A non-force REST ref
      // update could still fast-forward it; updateRefs must reject beforeOid mismatch.
      actualHead = 'f'.repeat(40);
      const update = JSON.parse(init.body).variables.input.refUpdates[0];
      assert.equal(update.beforeOid, HEAD); assert.notEqual(update.beforeOid, actualHead); assert.equal(update.force, false);
      return response({ data: { updateRefs: null }, errors: [{ type: 'UNPROCESSABLE', message: TOKEN }] });
    }
    if (path.endsWith('/git/ref/heads/main') && actualHead !== HEAD) return response({ object: { sha: actualHead } });
    return mock.fetch(url, init);
  };
  const result = await createGithubPublisher(options(fetch)).publish(publication());
  assert.equal(result.code, 'GRAPHQL_MUTATION_REJECTED'); assert.equal(result.published, false); assert.equal(actualHead, 'f'.repeat(40));
  assert.equal(calls.filter(call => call.path === '/graphql').length, 1); assert.equal(calls.some(call => call.method === 'PATCH'), false);
});
test('missing or invalid metadata node ID prevents all object preparation and mutations', async () => {
  for (const node_id of [null, '', 'not an id', 'x'.repeat(1025)]) {
    const calls = [];
    const fetch = async (url, init) => { calls.push(init.method); return response(repo(9001, 'owner/owner', { node_id })); };
    assert.equal((await createGithubPublisher(options(fetch)).publish(publication())).code, 'REPOSITORY_NODE_ID_INVALID');
    assert.deepEqual(calls, ['GET']);
  }
});
test('nominal GraphQL success is not publication until the expected commit is read from the ref', async () => {
  const mock = publishMock();
  const fetch = async (url, init) => {
    if (new URL(url).pathname === '/graphql') { const body = JSON.parse(init.body); return response({ data: { updateRefs: { clientMutationId: body.variables.input.clientMutationId } } }); }
    return mock.fetch(url, init);
  };
  const result = await createGithubPublisher(options(fetch)).publish(publication());
  assert.equal(result.published, false); assert.equal(result.code, 'PUBLICATION_RESULT_UNCONFIRMED');
});
test('invalid GraphQL payload is held and mutations are not retried even with retry-enabled transport', async () => {
  const mock = publishMock(); let mutations = 0;
  const fetch = async (url, init) => { if (new URL(url).pathname === '/graphql') { mutations += 1; return response({ data: { updateRefs: null } }); } return mock.fetch(url, init); };
  assert.equal((await createGithubPublisher(options(fetch, { maxRetries: 3 })).publish(publication())).code, 'GRAPHQL_RESULT_INVALID');
  assert.equal(mutations, 1);
});
