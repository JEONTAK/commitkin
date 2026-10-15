import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGithubClient, createObservedReadonlyRefresh } from '../src/index.mjs';
import { classifyActivity } from '../src/domain/character/classification.mjs';
import { acquireInstallation } from '../src/infrastructure/github/installation.mjs';
import { createValidator } from '../../record-validator/src/index.js';
import { digest } from '../../record-validator/src/domain/hash.js';

const OWNER = '1001'; const REPO = '9001'; const NAME = 'Owner/Owner'; const HEAD = 'a'.repeat(40); const FIRST = 'c'.repeat(40);
const paths = ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json'];
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const treeId = sha => createHash('sha1').update('mock-tree-' + sha).digest('hex');
const workflow = (sha, at) => ({ serverUrl: 'https://github.com', apiUrl: 'https://api.github.com', eventName: 'workflow_dispatch', repository: NAME, repositoryId: REPO,
  ownerAccountId: OWNER, actorAccountId: OWNER, ref: 'refs/heads/main', sha, startedAt: at });
const metadata = { id: REPO, owner: { id: OWNER, login: 'Owner', type: 'User' }, name: 'Owner', full_name: NAME, visibility: 'public', private: false, fork: false, archived: false, default_branch: 'main' };

// In-memory provider history only: never writes a local or actual GitHub record.
function fixture() {
  const initial = new Map([['README.md', Buffer.from('# User profile\n<!-- COMMITKIN:START -->\n<!-- COMMITKIN:END -->\nPreserve me.\n')],
    ['.github/commitkin.yml', Buffer.from('version: 1\nrepositories:\n  additional: []\n  exclude: []\n')]]);
  const versions = new Map([[HEAD, initial]]); const histories = new Map(); const requests = [];
  const control = { head: HEAD, releases: [], now: '2026-10-15T01:01:00Z', historyComplete: true };
  const client = createGithubClient({ token: 'synthetic-first-class-token', maxRetries: 0, requestBudget: 500, fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); const parsed = new URL(url); assert.equal(parsed.origin, 'https://api.github.com'); requests.push(parsed.pathname + parsed.search);
    const original = parsed.pathname; const path = original.toLowerCase(); let data;
    if (path === '/repos/owner/owner' || path === '/repositories/9001') data = metadata;
    else if (path === '/repos/owner/owner/git/ref/heads/main') data = { ref: 'refs/heads/main', object: { type: 'commit', sha: control.head } };
    else if (path.startsWith('/repos/owner/owner/git/commits/')) {
      const sha = path.split('/').at(-1); assert.ok(versions.has(sha)); data = { sha, tree: { sha: treeId(sha) }, parents: [] };
    } else if (path.startsWith('/repos/owner/owner/git/trees/')) {
      const sha = path.split('/').at(-1); const files = [...versions].find(([commit]) => treeId(commit) === sha)?.[1]; assert.ok(files);
      data = { sha, truncated: false, tree: [
        { path: '.github', type: 'tree', mode: '040000', sha: treeId(HEAD) }, ...(files.has(paths[0]) ? [{ path: '.commitkin', type: 'tree', mode: '040000', sha: treeId(HEAD) }] : []),
        ...[...files].map(([path, value]) => ({ path, type: 'blob', mode: '100644', sha: blob(value), size: value.length })),
      ] };
    } else if (path.startsWith('/repos/owner/owner/contents/')) {
      const relative = original.slice('/repos/Owner/Owner/contents/'.length); const sha = parsed.searchParams.get('ref'); assert.match(sha, /^[a-f0-9]{40}$/);
      const bytes = versions.get(sha)?.get(relative); if (!bytes) return new Response('{}', { status: 404 });
      data = { type: 'file', path: relative, encoding: 'base64', sha: blob(bytes), size: bytes.length, content: bytes.toString('base64') };
    } else if (path === '/repos/owner/owner/commits' && parsed.searchParams.has('path')) {
      assert.equal(parsed.searchParams.get('sha'), control.head); data = histories.get(parsed.searchParams.get('path')) ?? [];
    } else if (path === '/users/owner/repos') data = [metadata];
    else if (path === '/users/owner/events/public' || path === '/repos/owner/owner/pulls' || path === '/repos/owner/owner/issues/events') data = [];
    else if (path === '/repos/owner/owner/releases') data = control.releases;
    else if (path === '/repos/owner/owner/commits') {
      assert.equal(parsed.searchParams.get('sha'), control.head);
      data = [...versions.keys()].reverse().map(sha => ({ sha, author: { id: '41898282', type: 'Bot' }, commit: { committer: { date: '2026-07-01T00:00:00Z' } } }));
    } else throw new TypeError('UNEXPECTED_LOCAL_PROVIDER_REQUEST');
    return new Response(JSON.stringify(data), { status: 200 });
  } });
  let refresh;
  const run = input => (refresh ??= createObservedReadonlyRefresh({ client, clock: () => control.now }))(input);
  function persist(result, sha = FIRST) {
    const files = new Map(versions.get(control.head)); for (const file of result.files) files.set(file.path, Buffer.from(file.content)); versions.set(sha, files);
    for (const path of paths) histories.set(path, [{ sha }, ...(histories.get(path) ?? [])]); control.head = sha;
  }
  return { client, run, control, persist, requests, versions, histories };
}
const validateRecords = createValidator();
let initialReady;
async function readyMock() {
  if (!initialReady) {
    const first = fixture(); initialReady = await first.run({ workflowContext: workflow(HEAD, '2026-10-15T01:00:00Z'), initialSelection: { accountId: OWNER, factionId: 'bloomguard', confirmation: 'CONFIRM_PERMANENT_FACTION' } });
    assert.equal(initialReady.decision, 'prepared');
  }
  const mock = fixture(); mock.persist(initialReady); return mock;
}
function acquire(mock, changes = {}) { return acquireInstallation({ client: mock.client, workflowContext: workflow(mock.control.head, '2026-10-19T01:00:00Z'), validateRecords, ...changes }); }
function bundle(files) { return Object.fromEntries(paths.map(path => [path.split('/').at(-1).split('.')[0], JSON.parse(files.get(path).toString('utf8'))])); }
function records(snapshot, base) {
  const result = new Map(base); for (const role of ['state', 'ledger', 'status']) result.set(`.commitkin/${role}.json`, Buffer.from(JSON.stringify(snapshot[role]))); return result;
}
function revision(snapshot, value) {
  for (const role of ['state', 'ledger', 'status']) snapshot[role].recordRevision = value;
  if (snapshot.state.growth.phase === 'ready') { snapshot.state.evaluation.lastSuccessfulRevision = value; snapshot.status.lastSuccessfulRevision = value; }
  snapshot.state.integrity.ledgerHash = digest(snapshot.ledger); return snapshot;
}
function pending(snapshot) {
  snapshot = structuredClone(snapshot); revision(snapshot, 1);
  Object.assign(snapshot.state, { growth: { ...snapshot.state.growth, phase: 'pending', totalXp: null }, class: null, traits: { habit: { currentId: null, pending: null }, activity: { currentId: null, pending: null } },
    observationClock: { lastNormalEvaluationOn: null, classLastCountedOn: null, habitLastCountedOn: null, activityLastCountedOn: null }, achievements: [], evaluation: null });
  Object.assign(snapshot.ledger, { coverage: [], facts: [], days: [], corrections: [] }); snapshot.state.integrity.ledgerHash = digest(snapshot.ledger);
  Object.assign(snapshot.status, { state: 'analysis_pending', reasonCode: 'INITIAL_ANALYSIS_PENDING', lastSuccessfulRevision: null, collectionPending: [{ startDate: snapshot.state.growth.startDate, endDateExclusive: '2026-10-15', scopeId: snapshot.ledger.scopes[0].id }] });
  return snapshot;
}
function addOlder(mock, old, sha = 'd'.repeat(40)) {
  mock.versions.set(sha, records(old, mock.versions.get(FIRST))); mock.histories.set(paths[0], [{ sha: FIRST }, { sha }]); return sha;
}

test('composition: an empty first ready Adventurer can receive its first qualified regular class later using verified persisted origin', async () => {
  const mock = fixture(); const first = await mock.run({ workflowContext: workflow(HEAD, '2026-10-15T01:00:00Z'), initialSelection: { accountId: OWNER, factionId: 'bloomguard', confirmation: 'CONFIRM_PERMANENT_FACTION' } });
  assert.equal(first.decision, 'prepared', JSON.stringify(first)); assert.equal(first.candidate.state.recordRevision, 2); assert.equal(first.candidate.state.class.id, 'adventurer'); assert.equal(first.candidate.state.growth.totalXp, '0');
  mock.persist(first);
  mock.control.releases = [16, 17, 18].map(day => ({ id: String(100 + day), author: { id: OWNER, type: 'User' }, draft: false, prerelease: false, published_at: `2026-10-${day}T10:00:00Z` }));
  mock.control.now = '2026-10-19T01:01:00Z';
  const next = await mock.run({ workflowContext: workflow(FIRST, '2026-10-19T01:00:00Z') });
  assert.equal(next.decision, 'prepared', JSON.stringify(next));
  const selection = classifyActivity({ facts: next.candidate.ledger.facts, repositories: next.candidate.ledger.repositories, evaluationDate: '2026-10-19' });
  assert.equal(selection.candidateId, 'herald');
  assert.equal(next.candidate.state.class.id, 'herald');
  assert.equal(next.candidate.state.class.history.length, 1); assert.equal(next.candidate.state.class.lastChangedOn, '2026-10-19');
  assert.equal(next.candidate.state.growth.totalXp, '105'); assert.deepEqual(next.candidate.state.faction, first.candidate.state.faction);
  assert.equal(next.candidate.state.growth.startDate, first.candidate.state.growth.startDate); assert.equal(next.candidate.state.observationClock.lastNormalEvaluationOn, '2026-10-19');
  assert.equal(next.candidate.state.traits.activity.currentId, null); assert.equal(next.candidate.state.traits.activity.pending.targetId, 'shipping'); assert.equal(next.candidate.state.traits.activity.pending.count, 1);
  assert.equal(next.verification.decision, 'accept_relative_to_capture'); assert.equal(next.published, false); assert.equal(next.progressionAuthorized, false);
  assert.equal(mock.requests.some(path => path.includes('path=.commitkin%2Fstate.json')), true);
});

test('verified directly persisted ready revision two grants only first-class provenance and reuses matched immutable HEAD bytes', async () => {
  const mock = await readyMock(); const before = [...mock.versions.get(FIRST)].map(([path, value]) => [path, Buffer.from(value)]);
  const result = await acquire(mock);
  assert.equal(result.decision, 'acquired'); assert.equal(result.initialAssignmentVerified, true); assert.equal(result.firstInstallVerified, false); assert.equal(result.initialSelection, null);
  assert.equal(result.provenance.initialAssignmentSource, 'reachable-adventurer-state-chain'); assert.equal(result.provenance.historicalAuthenticity, 'not_checked'); assert.equal(result.provenance.perfectPriorInstallationDetection, false);
  assert.equal(mock.requests.filter(path => path.includes('/git/commits/')).length, 1); assert.equal(mock.requests.filter(path => path.includes('/git/trees/')).length, 1);
  assert.equal(mock.requests.filter(path => path.includes('/contents/')).length, 5); assert.equal(mock.requests.filter(path => path.includes('path=.commitkin%2Fstate.json')).length, 1);
  assert.deepEqual([...mock.versions.get(FIRST)], before); assert.equal(result.progressionAuthorized, false);
});

test('explicit deferred acquisition grants no first-class authority and does not require history until an actual class candidate exists', async () => {
  const mock = await readyMock(); mock.histories.set(paths[0], []);
  const result = await acquire(mock, { deferReadyClassOrigin: true });
  assert.equal(result.decision, 'acquired'); assert.equal(result.initialClassOriginDeferred, true); assert.equal(result.initialAssignmentVerified, false); assert.equal(result.firstInstallVerified, false);
  assert.equal(result.provenance.initialAssignmentSource, null); assert.equal(mock.requests.some(path => path.includes('?path=')), false);
  const verified = await acquire(mock); assert.equal(verified.code, 'RECOVERY_REQUIRED'); assert.equal(verified.initialAssignmentVerified, false);
});

test('deferred origin intent is boolean-only and cannot be enabled by a string option', async () => {
  const mock = await readyMock(); const result = await acquire(mock, { deferReadyClassOrigin: 'true' });
  assert.equal(result.code, 'INSTALLATION_CONTEXT_INVALID'); assert.deepEqual(mock.requests, []);
});

test('a persisted pending revision-one origin plus complete ready history remains supported', async () => {
  const mock = await readyMock(); addOlder(mock, pending(bundle(mock.versions.get(FIRST))));
  const result = await acquire(mock); assert.equal(result.initialAssignmentVerified, true, result.code);
  for (const path of paths) assert.equal(mock.requests.some(request => request.includes('/contents/' + path + '?ref=' + 'd'.repeat(40))), true);
});

for (const [label, change] of [
  ['old regular class', old => { old.state.class = { id: 'blacksmith', lastChangedOn: '2026-10-15', pending: null, history: [{ classId: 'blacksmith', assignedAt: old.state.evaluation.evaluatedAt }] }; old.state.observationClock.classLastCountedOn = '2026-10-15'; }],
  ['erased first-class clock', old => { old.state.observationClock.classLastCountedOn = '2026-10-15'; }],
  ['different faction', old => { old.state.faction.id = 'ashbound'; }],
  ['changed confirmation time', old => { old.state.faction.confirmedAt = '2026-10-15T00:59:00Z'; }],
  ['different growth start', old => { old.state.growth.startDate = '2026-07-16'; }],
  ['different owner', old => { for (const role of ['state', 'ledger', 'status']) old[role].owner.accountId = '999'; }],
  ['different profile ID', old => { for (const role of ['state', 'ledger', 'status']) old[role].owner.profileRepositoryId = '999'; }],
  ['unsupported schema', old => { old.state.schemaVersion = 2; }],
  ['unsupported ruleset', old => { for (const role of ['state', 'ledger', 'status']) old[role].rulesetVersion = '2.0.0'; }],
  ['malformed historical status', old => { old.status.state = 'untrusted'; }],
  ['wrong historical ledger hash', old => { old.state.integrity.ledgerHash = 'v1:sha256:' + 'f'.repeat(64); }],
]) {
  test(`a current empty Adventurer cannot hide ${label}`, async () => {
    const mock = await readyMock(); const current = revision(bundle(mock.versions.get(FIRST)), 3); mock.versions.set(FIRST, records(current, mock.versions.get(FIRST)));
    const old = revision(structuredClone(current), 2); change(old); addOlder(mock, old);
    const result = await acquire(mock); assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(result.initialAssignmentVerified, false); assert.equal(Object.hasOwn(result, 'records'), false);
  });
}

test('ready revision one or a truncated later ready origin is never accepted as direct first-install provenance', async () => {
  for (const value of [1, 3]) {
    const mock = await readyMock(); const current = revision(bundle(mock.versions.get(FIRST)), value); mock.versions.set(FIRST, records(current, mock.versions.get(FIRST)));
    assert.equal((await acquire(mock)).code, 'RECOVERY_REQUIRED');
  }
});

test('a direct ready revision-two origin must be the normal analysis on its original confirmation UTC date', async () => {
  const mock = await readyMock(); const current = bundle(mock.versions.get(FIRST)); current.state.faction.confirmedAt = '2026-10-14T01:00:00Z';
  mock.versions.set(FIRST, records(current, mock.versions.get(FIRST))); assert.equal((await acquire(mock)).code, 'RECOVERY_REQUIRED');
});

test('all three historical records must exist as matched valid blobs; missing/corrupt siblings are recovery, not absence', async () => {
  for (const path of paths) for (const mode of ['missing', 'corrupt']) {
    const mock = await readyMock(); const sha = addOlder(mock, pending(bundle(mock.versions.get(FIRST))));
    if (mode === 'missing') mock.versions.get(sha).delete(path); else mock.versions.get(sha).set(path, Buffer.from('{ broken historical record'));
    assert.equal((await acquire(mock)).code, 'RECOVERY_REQUIRED', path + ':' + mode);
  }
});

test('semantic rollback, late normal-to-pending rollback and mismatched latest state history cannot prove a first class', async () => {
  const semantic = await readyMock(); const sameRevision = bundle(semantic.versions.get(FIRST)); sameRevision.state.settings.filePreviouslyUsed = false; addOlder(semantic, sameRevision);
  assert.equal((await acquire(semantic)).code, 'RECOVERY_REQUIRED');
  const mixed = await readyMock(); const origin = bundle(mixed.versions.get(FIRST)); const middle = addOlder(mixed, pending(origin));
  const oldReady = 'e'.repeat(40); mixed.versions.set(oldReady, records(origin, mixed.versions.get(FIRST))); mixed.histories.set(paths[0], [{ sha: FIRST }, { sha: middle }, { sha: oldReady }]);
  assert.equal((await acquire(mixed)).code, 'RECOVERY_REQUIRED');
  const mismatch = await readyMock(); const sha = addOlder(mismatch, pending(bundle(mismatch.versions.get(FIRST)))); mismatch.histories.set(paths[0], [{ sha }]);
  assert.equal((await acquire(mismatch)).code, 'RECOVERY_REQUIRED');
});

test('complete history cap remains exactly one hundred with safe verified-blob reuse', async () => {
  const mock = await readyMock(); const current = mock.versions.get(FIRST); const items = [{ sha: FIRST }];
  for (let index = 1; index < 100; index += 1) {
    const sha = createHash('sha1').update('format-only-ready-' + index).digest('hex'); mock.versions.set(sha, new Map(current)); items.push({ sha });
  }
  mock.histories.set(paths[0], items); assert.equal((await acquire(mock)).initialAssignmentVerified, true);
  assert.ok(mock.client.budget().used < 250); assert.equal(mock.requests.filter(path => path.includes('/contents/')).length, 5);
  const over = await readyMock(); over.histories.set(paths[0], [...items, { sha: 'f'.repeat(40) }]);
  assert.equal((await acquire(over)).code, 'INSTALLATION_HISTORY_INCOMPLETE');
});

test('absent, incomplete, failed or repeated provider history is an explicit no-assignment hold', async () => {
  const absent = await readyMock(); absent.histories.set(paths[0], []); assert.equal((await acquire(absent)).code, 'RECOVERY_REQUIRED');
  const duplicate = await readyMock(); duplicate.histories.set(paths[0], [{ sha: FIRST }, { sha: FIRST }]); assert.equal((await acquire(duplicate)).code, 'RECOVERY_REQUIRED');
  for (const history of [{ ok: false, complete: false, items: [] }, { ok: true, complete: false, items: [{ sha: FIRST }] }, { ok: true, items: [{ sha: FIRST }] }]) {
    const mock = await readyMock(); const client = { ...mock.client, paginate: async (path, options) => {
      assert.equal(options.repositoryId, REPO); assert.ok(path.includes('sha=' + FIRST)); return history;
    } };
    const result = await acquire(mock, { client }); assert.equal(result.code, 'INSTALLATION_HISTORY_INCOMPLETE'); assert.equal(result.initialAssignmentVerified, false);
  }
});

test('history-proven first class never reopens permanent faction selection', async () => {
  const mock = await readyMock(); const result = await acquire(mock, { initialSelection: { accountId: OWNER, factionId: 'ashbound', confirmation: 'CONFIRM_PERMANENT_FACTION' } });
  assert.equal(result.code, 'FACTION_ALREADY_CONFIRMED'); assert.equal(result.initialAssignmentVerified, false); assert.equal(mock.requests.some(path => path.includes('?path=')), false);
});

test('lazy composition keeps earning ordinary XP without any history request when no first-class candidate exists', async () => {
  const mock = await readyMock(); mock.histories.set(paths[0], []);
  mock.control.releases = [{ id: '118', author: { id: OWNER, type: 'User' }, draft: false, prerelease: false, published_at: '2026-10-18T10:00:00Z' }];
  mock.control.now = '2026-10-19T01:01:00Z';
  const result = await mock.run({ workflowContext: workflow(FIRST, '2026-10-19T01:00:00Z') });
  assert.equal(result.decision, 'prepared', JSON.stringify(result)); assert.equal(result.candidate.state.class.id, 'adventurer'); assert.equal(result.candidate.state.growth.totalXp, '35');
  assert.equal(result.candidate.state.observationClock.lastNormalEvaluationOn, '2026-10-19');
  assert.equal(mock.requests.some(path => path.includes('?path=')), false); assert.equal(result.verification.decision, 'accept_relative_to_capture');
});

test('lazy composition with an actual first-class candidate holds explicitly if immutable first-origin history cannot be proven', async () => {
  const mock = await readyMock(); mock.histories.set(paths[0], []);
  const before = [...mock.versions.get(FIRST)].map(([path, value]) => [path, Buffer.from(value)]);
  mock.control.releases = [16, 17, 18].map(day => ({ id: String(100 + day), author: { id: OWNER, type: 'User' }, draft: false, prerelease: false, published_at: `2026-10-${day}T10:00:00Z` }));
  mock.control.now = '2026-10-19T01:01:00Z';
  const result = await mock.run({ workflowContext: workflow(FIRST, '2026-10-19T01:00:00Z') });
  assert.equal(result.decision, 'hold', JSON.stringify(result)); assert.equal(result.stage, 'class_origin'); assert.equal(result.code, 'RECOVERY_REQUIRED');
  assert.equal(result.files, null); assert.equal(result.progressionAuthorized, false); assert.equal(result.published, false);
  assert.equal(mock.requests.filter(path => path.includes('?path=')).length, 1); assert.deepEqual([...mock.versions.get(FIRST)], before);
});

test('first-class provenance preserves preexisting nonzero XP, original facts and already earned traits', async () => {
  const mock = fixture(); mock.control.releases = [13, 14].map(day => ({ id: String(100 + day), author: { id: OWNER, type: 'User' }, draft: false, prerelease: false, published_at: `2026-10-${day}T10:00:00Z` }));
  const first = await mock.run({ workflowContext: workflow(HEAD, '2026-10-15T01:00:00Z'), initialSelection: { accountId: OWNER, factionId: 'ashbound', confirmation: 'CONFIRM_PERMANENT_FACTION' } });
  assert.equal(first.decision, 'prepared'); assert.equal(first.candidate.state.class.id, 'adventurer'); assert.equal(first.candidate.state.growth.totalXp, '70'); assert.equal(first.candidate.state.traits.activity.currentId, 'shipping');
  mock.persist(first); mock.control.releases.push({ id: '118', author: { id: OWNER, type: 'User' }, draft: false, prerelease: false, published_at: '2026-10-18T10:00:00Z' }); mock.control.now = '2026-10-19T01:01:00Z';
  const next = await mock.run({ workflowContext: workflow(FIRST, '2026-10-19T01:00:00Z') });
  assert.equal(next.decision, 'prepared', JSON.stringify(next)); assert.equal(next.candidate.state.class.id, 'herald'); assert.equal(next.candidate.state.growth.totalXp, '105'); assert.equal(next.summary.deltaXp, '35');
  assert.deepEqual(next.candidate.state.faction, first.candidate.state.faction); assert.equal(next.candidate.state.growth.startDate, first.candidate.state.growth.startDate);
  for (const fact of first.candidate.ledger.facts) assert.deepEqual(next.candidate.ledger.facts.find(row => row.eventKey === fact.eventKey), fact);
  assert.equal(next.candidate.state.traits.activity.currentId, 'shipping'); assert.equal(next.candidate.state.observationClock.activityLastCountedOn, first.candidate.state.observationClock.activityLastCountedOn);
});
