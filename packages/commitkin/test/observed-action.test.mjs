import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCommitkinAction, createGithubClient, createGithubPublisher, createObservedReadonlyRefresh } from '../src/index.mjs';
import { createValidator } from '../../record-validator/src/index.js';

// Every HTTP capability in this file is injected below. No global fetch, file
// writes, GitHub token, real repository mutation or network access is used.
const TOKEN = 'synthetic-observed-action-token';
const NAME = 'HeroA/HeroA'; const OWNER = '1001'; const REPOSITORY = '9001';
const HEAD = 'a'.repeat(40); const TREE = 'b'.repeat(40); const NODE = 'R_kgDOObservedActionFixture';
const PATHS = ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/card.png', 'README.md'];
const hash = content => createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
const objectId = value => createHash('sha1').update(JSON.stringify(value)).digest('hex');
const workflow = (sha = HEAD, startedAt = '2026-10-15T01:00:00Z') => ({ serverUrl: 'https://github.com', apiUrl: 'https://api.github.com', eventName: 'workflow_dispatch', repository: NAME,
  repositoryId: REPOSITORY, ownerAccountId: OWNER, actorAccountId: OWNER, ref: 'refs/heads/main', sha, startedAt });
const selection = factionId => ({ accountId: OWNER, factionId, confirmation: 'CONFIRM_PERMANENT_FACTION' });
const metadata = () => ({ id: 9001, node_id: NODE, owner: { id: 1001, login: 'HeroA', type: 'User' }, name: 'HeroA', full_name: NAME,
  visibility: 'public', private: false, fork: false, archived: false, default_branch: 'main' });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

function profileHttp({ excludeSelf = true, failCollection = false, prior = null, publisherOwnerId = OWNER, publisherRepositoryId = REPOSITORY, failCas = false } = {}) {
  const initialFiles = new Map([
    ['README.md', Buffer.from('\ufeff# My public profile\r\n\r\n<!-- COMMITKIN:START -->\r\n<!-- COMMITKIN:END -->\r\n\r\nKeep this exact text. 한글\r\n')],
    ['.github/commitkin.yml', Buffer.from('version: 1\nrepositories:\n  additional: []\n  exclude:' + (excludeSelf ? '\n    - heroa/heroa\n' : ' []\n'))],
    ['src/untouched.js', Buffer.from('export const untouched = true;\n')],
    ['.github/workflows/keep.yml', Buffer.from('name: Keep this user workflow\n')],
  ]);
  if (prior) for (const role of ['state', 'ledger', 'status']) initialFiles.set(`.commitkin/${role}.json`, Buffer.from(JSON.stringify(prior[role])));
  const snapshots = new Map([[TREE, new Map(initialFiles)]]);
  const commits = new Map([[HEAD, { sha: HEAD, tree: { sha: TREE }, parents: [] }]]);
  const blobs = new Map([...initialFiles.values()].map(content => [hash(content), Buffer.from(content)]));
  const histories = new Map(); const requests = []; const controls = { head: HEAD, failCollection, publisherOwnerId, publisherRepositoryId, failCas };
  const stored = () => snapshots.get(commits.get(controls.head).tree.sha);
  const contentAt = (sha, path) => snapshots.get(commits.get(sha)?.tree.sha)?.get(path);
  const filesBefore = () => [...stored()].map(([path, content]) => [path, Buffer.from(content)]);
  async function http(layer, url, init) {
    const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.github.com'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + TOKEN);
    const path = parsed.pathname; const lower = path.toLowerCase(); const method = init.method;
    const body = init.body === undefined ? null : JSON.parse(init.body);
    requests.push({ layer, method, path, search: parsed.search, body });
    if (layer === 'read') assert.equal(method, 'GET', 'this zero-scope/failure fixture has no read GraphQL requests');
    if (method === 'GET') {
      if (lower === '/repos/heroa/heroa' || lower === '/repositories/9001') {
        const data = metadata();
        if (layer === 'write') { data.id = controls.publisherRepositoryId; data.owner.id = controls.publisherOwnerId; }
        return response(data);
      }
      if (lower === '/repos/heroa/heroa/git/ref/heads/main') return response({ ref: 'refs/heads/main', object: { type: 'commit', sha: controls.head } });
      if (lower.startsWith('/repos/heroa/heroa/git/commits/')) return response(commits.get(path.split('/').at(-1)) ?? {}, commits.has(path.split('/').at(-1)) ? 200 : 404);
      if (lower.startsWith('/repos/heroa/heroa/git/trees/')) {
        const sha = path.split('/').at(-1); const files = snapshots.get(sha);
        if (!files) return response({}, 404);
        const directories = [...new Set([...files.keys()].flatMap(file => file.split('/').slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join('/'))))];
        return response({ sha, truncated: false, tree: [
          ...directories.map(path => ({ path, type: 'tree', mode: '040000', sha: objectId(path) })),
          ...[...files].map(([path, content]) => ({ path, type: 'blob', mode: '100644', sha: hash(content), size: content.length })),
        ] });
      }
      if (lower.startsWith('/repos/heroa/heroa/contents/')) {
        const relative = path.slice('/repos/HeroA/HeroA/contents/'.length); const sha = parsed.searchParams.get('ref');
        assert.match(sha, /^[a-f0-9]{40}$/); const content = contentAt(sha, relative);
        return content ? response({ type: 'file', path: relative, encoding: 'base64', sha: hash(content), size: content.length, content: content.toString('base64') }) : response({}, 404);
      }
      if (lower.startsWith('/repos/heroa/heroa/git/blobs/')) {
        const sha = path.split('/').at(-1); const content = blobs.get(sha);
        return content ? response({ sha, size: content.length, encoding: 'base64', content: content.toString('base64') }) : response({}, 404);
      }
      if (lower === '/repos/heroa/heroa/commits' && parsed.searchParams.has('path')) {
        assert.match(parsed.searchParams.get('sha'), /^[a-f0-9]{40}$/);
        return response(histories.get(parsed.searchParams.get('path')) ?? []);
      }
      if (lower === '/users/heroa/repos') return response([metadata()]);
      if (lower === '/users/heroa/events/public') return response([]);
      if (lower === '/repos/heroa/heroa/pulls' && controls.failCollection) return response({ message: 'synthetic source denied' }, 403);
      throw new TypeError('UNEXPECTED_MOCK_GET');
    }
    assert.equal(layer, 'write'); assert.equal(method, 'POST');
    if (lower === '/repos/heroa/heroa/git/blobs') {
      assert.equal(body.encoding, 'base64'); const content = Buffer.from(body.content, 'base64'); const sha = hash(content); blobs.set(sha, content);
      return response({ sha }, 201);
    }
    if (lower === '/repos/heroa/heroa/git/trees') {
      const base = snapshots.get(body.base_tree); assert.ok(base); const next = new Map(base);
      for (const item of body.tree) { assert.equal(item.mode, '100644'); assert.equal(item.type, 'blob'); assert.ok(blobs.has(item.sha)); next.set(item.path, blobs.get(item.sha)); }
      const sha = objectId(body); snapshots.set(sha, next); return response({ sha }, 201);
    }
    if (lower === '/repos/heroa/heroa/git/commits') {
      assert.ok(snapshots.has(body.tree)); assert.deepEqual(body.parents, [controls.head]);
      const sha = objectId(body); commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents.map(sha => ({ sha })) });
      return response({ sha }, 201);
    }
    if (lower === '/graphql') {
      assert.match(body.query, /^mutation CommitkinUpdateRefs/); const input = body.variables.input;
      assert.equal(input.repositoryId, NODE); assert.equal(input.refUpdates.length, 1);
      const update = input.refUpdates[0]; assert.equal(update.name, 'refs/heads/main'); assert.equal(update.force, false); assert.equal(update.beforeOid, controls.head); assert.ok(commits.has(update.afterOid));
      if (controls.failCas) return response({ message: 'synthetic ref conflict' }, 422);
      controls.head = update.afterOid;
      for (const path of PATHS) histories.set(path, [{ sha: update.afterOid }, ...(histories.get(path) ?? [])]);
      return response({ data: { updateRefs: { clientMutationId: input.clientMutationId } } });
    }
    throw new TypeError('UNEXPECTED_MOCK_WRITE');
  }
  const options = layer => ({ token: TOKEN, maxRetries: 0, fetchImpl: (url, init) => http(layer, url, init) });
  const client = createGithubClient(options('read')); const publisher = createGithubPublisher(options('write'));
  return { client, publisher, requests, controls, stored, filesBefore, initialFiles };
}

function assertFiveFiles(files) {
  assert.deepEqual(files.map(file => file.path).sort(), [...PATHS].sort());
  for (const file of files) assert.ok(file.content instanceof Uint8Array && file.content.length > 0);
  assert.deepEqual([...files.find(file => file.path === '.commitkin/card.png').content.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}
function snapshot(files) { return Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, JSON.parse(Buffer.from(files.find(file => file.path === `.commitkin/${role}.json`).content).toString('utf8'))])); }
function assertUnmanagedReadme(original, generated) {
  const start = Buffer.from('<!-- COMMITKIN:START -->'); const end = Buffer.from('<!-- COMMITKIN:END -->');
  assert.deepEqual(generated.subarray(0, generated.indexOf(start) + start.length), original.subarray(0, original.indexOf(start) + start.length));
  assert.deepEqual(generated.subarray(generated.indexOf(end)), original.subarray(original.indexOf(end)));
}

test('real observed acquisition→empty capture→qualification→records→render composition prepares exactly five files', async () => {
  const mock = profileHttp(); const before = mock.filesBefore();
  const result = await createObservedReadonlyRefresh({ client: mock.client, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('ashbound') });
  assert.equal(result.decision, 'prepared', JSON.stringify(result)); assert.equal(result.sourceModel, 'observed-api-v1');
  assert.equal(result.verification.decision, 'accept_relative_to_capture'); assert.equal(result.verification.recordReport.code, 'ACCEPT'); assertFiveFiles(result.files);
  assert.equal(result.candidate.state.growth.totalXp, '0'); assert.equal(result.candidate.state.class.id, 'adventurer'); assert.equal(result.candidate.state.faction.id, 'ashbound');
  assert.deepEqual(result.candidate.ledger.repositories, []); assert.deepEqual(result.candidate.ledger.facts, []);
  assert.equal(result.summary.knownRepositories, 0); assert.equal(result.published, false); assert.equal(result.progressionAuthorized, false);
  assert.deepEqual(snapshot(result.files), result.candidate);
  assert.doesNotMatch(Buffer.from(result.files.find(file => file.path === 'README.md').content).toString('utf8'), /Synthetic development preview|not a live GitHub character/);
  assertUnmanagedReadme(mock.initialFiles.get('README.md'), Buffer.from(result.files.find(file => file.path === 'README.md').content));
  assert.deepEqual(mock.filesBefore(), before); assert.equal(mock.requests.every(call => call.layer === 'read' && call.method === 'GET'), true);
});

test('Action defaults to dry run and never invokes the separately constructed real publisher', async () => {
  const mock = profileHttp(); const before = mock.filesBefore();
  const result = await createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('bloomguard') });
  assert.equal(result.decision, 'prepared', JSON.stringify(result)); assert.equal(result.dryRun, true); assert.equal(result.filesPrepared, 5);
  assert.equal(result.published, false); assert.equal(result.actualRecordsChanged, false); assert.equal(result.progressionAuthorized, false);
  assert.equal(mock.publisher.budget().used, 0); assert.equal(mock.requests.some(call => call.method !== 'GET'), false); assert.deepEqual(mock.filesBefore(), before);
});

test('explicit mocked publication uses one five-file base-tree commit and one expected-head CAS with authoritative ref readback', async () => {
  const mock = profileHttp(); const result = await createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('ashbound'), dryRun: false });
  assert.equal(result.decision, 'published', JSON.stringify(result)); assert.equal(result.published, true); assert.equal(result.actualRecordsChanged, true); assert.equal(result.progressionAuthorized, true);
  assert.equal(result.commitSha, mock.controls.head); assert.notEqual(result.commitSha, HEAD);
  const posts = mock.requests.filter(call => call.method === 'POST'); assert.equal(posts.length, 8);
  assert.equal(posts.filter(call => call.path.endsWith('/git/blobs')).length, 5);
  const tree = posts.find(call => call.path.endsWith('/git/trees')).body; assert.equal(tree.base_tree, TREE); assert.deepEqual(tree.tree.map(item => item.path).sort(), [...PATHS].sort());
  const commit = posts.find(call => call.path.endsWith('/git/commits')).body; assert.deepEqual(commit.parents, [HEAD]);
  const cas = posts.filter(call => call.path === '/graphql'); assert.equal(cas.length, 1); assert.equal(cas[0].body.variables.input.repositoryId, NODE);
  assert.deepEqual(cas[0].body.variables.input.refUpdates, [{ name: 'refs/heads/main', beforeOid: HEAD, afterOid: result.commitSha, force: false }]);
  assert.equal(mock.requests.at(-1).method, 'GET'); assert.match(mock.requests.at(-1).path, /\/git\/ref\/heads\/main$/);
  for (const path of ['src/untouched.js', '.github/workflows/keep.yml', '.github/commitkin.yml']) assert.deepEqual(mock.stored().get(path), mock.initialFiles.get(path));
  assertUnmanagedReadme(mock.initialFiles.get('README.md'), mock.stored().get('README.md'));
  assert.doesNotMatch(mock.stored().get('README.md').toString('utf8'), /Synthetic development preview|not a live GitHub character/);
  const bundle = Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, mock.stored().get(`.commitkin/${role}.json`)]));
  assert.equal(createValidator()(bundle, { expectedOwner: { accountId: OWNER, profileRepositoryId: REPOSITORY }, now: '2026-10-15T01:01:00Z' }).code, 'ACCEPT');
});

test('same-UTC-date observed repeat is a no-op and performs no additional publication or record rewrite', async () => {
  const mock = profileHttp(); let completedAt = '2026-10-15T01:01:00Z';
  const run = createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => completedAt });
  const first = await run({ workflowContext: workflow(), initialSelection: selection('bloomguard'), dryRun: false }); assert.equal(first.decision, 'published');
  const before = mock.filesBefore(); const writes = mock.publisher.budget().used; completedAt = '2026-10-15T02:01:00Z';
  const result = await run({ workflowContext: workflow(mock.controls.head, '2026-10-15T02:00:00Z'), dryRun: false });
  assert.equal(result.decision, 'unchanged', JSON.stringify(result)); assert.equal(result.published, false); assert.equal(result.filesPrepared, 0); assert.equal(result.actualRecordsChanged, false);
  assert.equal(mock.publisher.budget().used, writes); assert.deepEqual(mock.filesBefore(), before);
});

for (const [field, change] of [['owner', { publisherOwnerId: '9999' }], ['repository', { publisherRepositoryId: '9999' }]]) {
  test(`publication ${field} ID replacement halts before creating any blob/tree/commit`, async () => {
    const mock = profileHttp(change); const before = mock.filesBefore();
    const result = await createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('bloomguard'), dryRun: false });
    assert.equal(result.decision, 'hold', JSON.stringify(result)); assert.equal(result.code, 'PUBLICATION_OWNER_BINDING_MISMATCH');
    assert.equal(result.published, false); assert.equal(result.actualRecordsChanged, false); assert.equal(mock.requests.some(call => call.method === 'POST'), false);
    assert.equal(mock.controls.head, HEAD); assert.deepEqual(mock.filesBefore(), before);
  });
}

test('mock CAS conflict never rewrites the branch or falls back to a weaker ref update', async () => {
  const mock = profileHttp({ failCas: true }); const before = mock.filesBefore();
  const result = await createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('bloomguard'), dryRun: false });
  assert.equal(result.decision, 'hold', JSON.stringify(result)); assert.equal(result.code, 'REMOTE_CHANGED'); assert.equal(result.published, false);
  assert.equal(mock.controls.head, HEAD); assert.deepEqual(mock.filesBefore(), before); assert.equal(mock.requests.filter(call => call.path === '/graphql').length, 1);
  assert.equal(mock.requests.some(call => call.method === 'PATCH'), false);
});

test('first collection failure reserves only confirmed faction with null XP/class/evaluation and explicit pending presentation', async () => {
  const mock = profileHttp({ excludeSelf: false, failCollection: true }); const before = mock.filesBefore();
  const result = await createObservedReadonlyRefresh({ client: mock.client, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('ashbound') });
  assert.equal(result.decision, 'pending', JSON.stringify(result)); assert.equal(result.causeCode, 'ACCESS_DENIED'); assertFiveFiles(result.files);
  assert.equal(result.verification.decision, 'initial_pending_reservation'); assert.equal(result.verification.growthAnalysis, 'not_checked');
  const state = result.candidate.state; assert.equal(state.faction.id, 'ashbound'); assert.equal(state.growth.phase, 'pending'); assert.equal(state.growth.totalXp, null); assert.equal(state.class, null); assert.equal(state.evaluation, null);
  assert.equal(result.summary.totalXp, null); assert.equal(result.summary.classId, null); assert.equal(result.progressionAuthorized, false); assert.equal(result.published, false);
  const readme = Buffer.from(result.files.find(file => file.path === 'README.md').content).toString('utf8');
  assert.match(readme, /Analysis pending/); assert.match(readme, /confirmed permanently/); assert.match(readme, /No successful analysis yet/); assert.doesNotMatch(readme, /Lv\.1|Character:|0 \/ 100|Up to date/);
  assertUnmanagedReadme(mock.initialFiles.get('README.md'), Buffer.from(readme));
  const bundle = Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, result.files.find(file => file.path === `.commitkin/${role}.json`).content]));
  assert.equal(createValidator()(bundle, { expectedOwner: { accountId: OWNER, profileRepositoryId: REPOSITORY }, now: '2026-10-15T01:01:00Z' }).code, 'ANALYSIS_PENDING');
  assert.deepEqual(mock.filesBefore(), before);
});

test('initial pending reservation remains read-only under default Action dry run', async () => {
  const mock = profileHttp({ excludeSelf: false, failCollection: true }); const before = mock.filesBefore();
  const result = await createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('bloomguard') });
  assert.equal(result.decision, 'pending', JSON.stringify(result)); assert.equal(result.dryRun, true); assert.equal(result.published, false); assert.equal(result.progressionAuthorized, false);
  assert.equal(result.summary.totalXp, null); assert.equal(mock.publisher.budget().used, 0); assert.deepEqual(mock.filesBefore(), before);
});

test('explicit mocked pending reservation publishes the faction without claiming a successful growth analysis', async () => {
  const mock = profileHttp({ excludeSelf: false, failCollection: true });
  const result = await createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('ashbound'), dryRun: false });
  assert.equal(result.decision, 'published', JSON.stringify(result)); assert.equal(result.published, true); assert.equal(result.actualRecordsChanged, true); assert.equal(result.progressionAuthorized, false);
  assert.equal(result.summary.totalXp, null); assert.equal(result.summary.classId, null); assert.equal(mock.requests.filter(call => call.path === '/graphql').length, 1);
  const state = JSON.parse(mock.stored().get('.commitkin/state.json').toString('utf8'));
  assert.equal(state.faction.id, 'ashbound'); assert.equal(state.growth.totalXp, null); assert.equal(state.class, null); assert.equal(state.evaluation, null);
  assert.match(mock.stored().get('README.md').toString('utf8'), /No successful analysis yet/);
});

test('collection failure after a previous success never resets a retained character to the initial pending reservation', async () => {
  const first = profileHttp(); const initial = await createObservedReadonlyRefresh({ client: first.client, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext: workflow(), initialSelection: selection('ashbound') });
  assert.equal(initial.decision, 'prepared');
  const mock = profileHttp({ prior: initial.candidate, excludeSelf: false, failCollection: true }); const before = mock.filesBefore();
  const result = await createCommitkinAction({ client: mock.client, publisher: mock.publisher, clock: () => '2026-10-15T02:01:00Z' })({ workflowContext: workflow(HEAD, '2026-10-15T02:00:00Z'), dryRun: false });
  assert.equal(result.decision, 'hold', JSON.stringify(result)); assert.equal(result.code, 'ACCESS_DENIED'); assert.equal(result.actualRecordsChanged, false); assert.equal(mock.publisher.budget().used, 0);
  assert.deepEqual(mock.filesBefore(), before);
});
