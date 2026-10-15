import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubClient } from '../src/infrastructure/github/client.mjs';

const TOKEN = 'not_a_real_token';
const sha = 'a'.repeat(40); const parent = 'b'.repeat(40); const tree = 'c'.repeat(40); const blob = 'd'.repeat(40);
const input = { repository: 'owner/project', oid: sha };
const path = '/repos/owner/project/commits/' + sha + '?per_page=100';
function file(number = 0) { return { filename: `src/file-${number}.ts`, sha: blob, status: 'modified', patch: 'RAW_PATCH', raw_url: 'https://evil.invalid/ignored' }; }
function payload(files = [file()]) { return { sha, parents: [{ sha: parent }], commit: { tree: { sha: tree }, committer: { date: '2026-10-14T09:00:00Z', email: 'PRIVATE_EMAIL' }, message: 'RAW_MESSAGE' }, files }; }
function response(data, headers = {}, status = 200) { return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status, headers }); }
function setup(pages = [], options = {}) {
  const calls = [];
  const client = createGithubClient({ token: TOKEN, maxRetries: 0, waitImpl: async () => {}, ...options, fetchImpl: async (url, init) => {
    calls.push({ url, init }); const result = pages[calls.length - 1];
    assert.ok(result, 'Unexpected injected fetch'); return typeof result === 'function' ? result(url, init) : response(result);
  } });
  return { client, calls };
}
function failure(result, code) {
  assert.equal(result.ok, false); assert.equal(result.complete, false); assert.equal(result.code, code); assert.deepEqual(result.files, []);
  for (const secret of [TOKEN, 'PRIVATE_EMAIL', 'RAW_MESSAGE', 'RAW_PATCH', 'evil.invalid']) assert.equal(JSON.stringify(result).includes(secret), false);
}
const nextLink = page => `<https://api.github.com${path}&page=${page}>; rel="next"`;

test('fixed commit-files capability makes GET only and returns minimal immutable metadata', async () => {
  const { client, calls } = setup([payload()]); const result = await client.commitFiles(input);
  assert.equal(result.ok, true); assert.equal(result.complete, true); assert.equal(result.pages, 1); assert.equal(result.receivedItems, 1);
  assert.deepEqual(result.metadata, { oid: sha, treeOid: tree, parentOids: [parent], committedAt: '2026-10-14T09:00:00Z' });
  assert.deepEqual(result.files, [{ filename: 'src/file-0.ts', sha: blob, status: 'modified' }]);
  assert.deepEqual(result.pageSnapshots, [{ sequence: 1, requestPath: path, itemCount: 1, nextPath: null, startIndex: 0, endIndexExclusive: 1 }]);
  assert.equal(calls[0].url, 'https://api.github.com' + path); assert.equal(calls[0].init.method, 'GET'); assert.equal(calls[0].init.redirect, 'error');
  for (const secret of ['PRIVATE_EMAIL', 'RAW_MESSAGE', 'RAW_PATCH', 'evil.invalid']) assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(typeof client.post, 'undefined');
});

test('wide101-file commit follows real Link metadata with exact non-overlapping provenance ranges', async () => {
  const first = payload(Array.from({ length: 100 }, (_, index) => file(index))); const second = payload([file(100)]);
  const { client, calls } = setup([() => response(first, { link: nextLink(2) }), second]);
  const result = await client.commitFiles(input); assert.equal(result.ok, true); assert.equal(result.receivedItems, 101); assert.equal(result.pages, 2);
  assert.equal(calls[1].url, 'https://api.github.com' + path + '&page=2');
  assert.deepEqual(result.pageSnapshots, [
    { sequence: 1, requestPath: path, itemCount: 100, nextPath: path + '&page=2', startIndex: 0, endIndexExclusive: 100 },
    { sequence: 2, requestPath: path + '&page=2', itemCount: 1, nextPath: null, startIndex: 100, endIndexExclusive: 101 },
  ]);
});

test('empty/root and SHA256 commits keep exact null-free metadata without inventing a parent', async () => {
  const root = payload([]); root.parents = []; const { client } = setup([root]); const result = await client.commitFiles(input);
  assert.equal(result.ok, true); assert.deepEqual(result.metadata.parentOids, []); assert.equal(result.receivedItems, 0);
  const digest = 'e'.repeat(64); const wide = payload(); wide.sha = digest; wide.commit.tree.sha = 'f'.repeat(64); wide.parents = []; wide.files[0].sha = '1'.repeat(64);
  const modern = setup([wide]); assert.equal((await modern.client.commitFiles({ ...input, oid: digest })).ok, true);
});

test('rename/copy source paths survive projection while arbitrary provider fields do not', async () => {
  const data = payload([{ ...file(), status: 'renamed', previous_filename: 'src/original.ts' }, { ...file(1), status: 'copied', previous_filename: 'src/shared.ts' }]);
  const { client } = setup([data]); const result = await client.commitFiles(input); assert.equal(result.ok, true);
  assert.equal(result.files[0].previous_filename, 'src/original.ts'); assert.equal(result.files[1].previous_filename, 'src/shared.ts');
});

for (const value of [undefined, null, [], {}, { ...input, field: 'files' }, { ...input, path }, { ...input, repository: 'https://evil.invalid/x' }, { ...input, repository: 'owner/..' }, { ...input, repository: 'owner/x/y' }, { ...input, oid: 'main' }, { ...input, oid: sha.toUpperCase() }, { ...input, oid: '../' + sha }]) {
  test(`unsafe commit input is rejected before fetch: ${JSON.stringify(value)}`, async () => {
    const { client, calls } = setup(); failure(await client.commitFiles(value), 'COMMIT_FILES_INPUT_INVALID'); assert.equal(calls.length, 0);
  });
}
for (const maxPages of [0, -1, 31, 1.1, '30', null, Infinity]) {
  test(`unsafe commit pagination bound is rejected before fetch: ${maxPages}`, async () => {
    const { client, calls } = setup(); failure(await client.commitFiles({ ...input, maxPages }), 'PAGINATION_OPTIONS_INVALID'); assert.equal(calls.length, 0);
  });
}

for (const [description, mutate, code = 'COMMIT_FILES_RESPONSE_INVALID'] of [
  ['wrong SHA', data => { data.sha = parent; }],
  ['missing parent list', data => { delete data.parents; }],
  ['invalid parent', data => { data.parents = [{ sha: 'main' }]; }],
  ['duplicate parent', data => { data.parents.push({ sha: parent }); }],
  ['missing tree', data => { delete data.commit.tree; }],
  ['invalid tree', data => { data.commit.tree.sha = 'main'; }],
  ['missing committed date', data => { delete data.commit.committer.date; }],
  ['invalid calendar date', data => { data.commit.committer.date = '2026-02-30T00:00:00Z'; }],
  ['files not an array', data => { data.files = null; }],
  ['oversized server page', data => { data.files = Array.from({ length: 101 }, (_, index) => file(index)); }],
  ['unknown file status', data => { data.files[0].status = 'unknown'; }, 'COMMIT_FILE_METADATA_INVALID'],
  ['invalid file hash', data => { data.files[0].sha = 'main'; }, 'COMMIT_FILE_METADATA_INVALID'],
  ['unsafe file path', data => { data.files[0].filename = '../credentials'; }, 'COMMIT_FILE_METADATA_INVALID'],
  ['nonUTF16 path', data => { data.files[0].filename = '\uD800'; }, 'RESPONSE_JSON_INVALID'],
  ['missing rename path', data => { data.files[0].status = 'renamed'; }, 'COMMIT_FILE_METADATA_INVALID'],
  ['unsafe old path', data => { data.files[0].previous_filename = '/absolute'; }, 'COMMIT_FILE_METADATA_INVALID'],
]) {
  test(`malformed commit metadata fails closed: ${description}`, async () => {
    const data = payload(); mutate(data); const { client } = setup([data]); failure(await client.commitFiles(input), code);
  });
}

test('immutable SHA/tree/parent order/committer date cannot change between file pages', async () => {
  for (const change of [data => { data.sha = parent; }, data => { data.commit.tree.sha = parent; }, data => { data.parents = []; }, data => { data.commit.committer.date = '2026-10-13T09:00:00Z'; }]) {
    const second = payload([file(1)]); change(second);
    const { client } = setup([() => response(payload(), { link: nextLink(2) }), second]);
    const result = await client.commitFiles(input); failure(result, second.sha === sha ? 'COMMIT_FILES_METADATA_CHANGED' : 'COMMIT_FILES_RESPONSE_INVALID');
  }
});

test('duplicate paths within or across pages cannot masquerade as unique complete files', async () => {
  const local = setup([payload([file(), file()])]); failure(await local.client.commitFiles(input), 'DUPLICATE_COMMIT_FILE');
  const repeated = setup([() => response(payload(), { link: nextLink(2) }), payload()]); failure(await repeated.client.commitFiles(input), 'DUPLICATE_COMMIT_FILE');
});

test('GitHub host/path/per-page changes and page skips are rejected without following unsafe links', async () => {
  for (const [link, code] of [
    ['<https://evil.invalid/steal>; rel="next"', 'PAGINATION_DESTINATION_REJECTED'],
    [`<https://api.github.com/repos/owner/other/commits/${sha}?per_page=100&page=2>; rel="next"`, 'PAGINATION_DESTINATION_REJECTED'],
    [`<https://api.github.com${path.replace('100', '99')}&page=2>; rel="next"`, 'PAGINATION_QUERY_CHANGED'],
    [nextLink(3), 'COMMIT_FILES_PAGINATION_INVALID'],
    [`<https://api.github.com${path}&after=cursor>; rel="next"`, 'COMMIT_FILES_PAGINATION_INVALID'],
    [`<https://api.github.com${path}&page=2&page=2>; rel="next"`, 'COMMIT_FILES_PAGINATION_INVALID'],
  ]) {
    const { client, calls } = setup([() => response(payload(), { link })]); failure(await client.commitFiles(input), code); assert.equal(calls.length, 1);
  }
});

test('page budget or empty nonterminal response returns no partial files', async () => {
  const bounded = setup([() => response(payload(), { link: nextLink(2) })]); failure(await bounded.client.commitFiles({ ...input, maxPages: 1 }), 'PAGE_LIMIT_REACHED');
  const empty = setup([() => response(payload([]), { link: nextLink(2) })]); failure(await empty.client.commitFiles(input), 'COMMIT_FILES_PAGINATION_INVALID');
});

test('exact3000 provider ceiling holds even with a terminal header that would otherwise imply completeness', async () => {
  const pages = Array.from({ length: 30 }, (_, page) => () => response(payload(Array.from({ length: 100 }, (_, index) => file(page * 100 + index))), page < 29 ? { link: nextLink(page + 2) } : {}));
  const { client, calls } = setup(pages); failure(await client.commitFiles(input), 'COMMIT_FILE_LIMIT_REACHED'); assert.equal(calls.length, 30);
  const below = Array.from({ length: 30 }, (_, page) => () => response(payload(Array.from({ length: page === 29 ? 99 : 100 }, (_, index) => file(page * 100 + index))), page < 29 ? { link: nextLink(page + 2) } : {}));
  const accepted = setup(below); const result = await accepted.client.commitFiles(input); assert.equal(result.ok, true); assert.equal(result.receivedItems, 2999);
});

test('shared HTTP budget and second-page rate limit cannot return successful subsets or leak response bodies', async () => {
  const budget = setup([() => response(payload(), { link: nextLink(2) })], { requestBudget: 1 }); failure(await budget.client.commitFiles(input), 'REQUEST_BUDGET_EXHAUSTED');
  const rate = setup([() => response(payload(), { link: nextLink(2) }), () => response({ message: TOKEN }, { 'x-ratelimit-remaining': '0' }, 403)]); failure(await rate.client.commitFiles(input), 'RATE_LIMITED');
});
