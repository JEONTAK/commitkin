import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubPublisher } from '../src/infrastructure/github/publication.mjs';
import { createActionRunUseCase } from '../src/application/run-action.mjs';

const TOKEN = 'synthetic-outcome-review-token';
const BEFORE = 'a'.repeat(40); const TREE = 'b'.repeat(40); const AFTER = 'c'.repeat(40);
const OWNER = { accountId: '1001', profileRepositoryId: '9001' };
const response = (data, status = 200) => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status });
const files = () => ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/card.png', 'README.md'].map(path => ({ path, content: Buffer.from('{}') }));
function prepared() { return { decision: 'prepared', code: 'DRY_RUN_READY', sourceModel: 'observed-api-v1', repository: 'owner/owner', owner: OWNER,
  defaultBranch: 'main', expectedHead: BEFORE, verification: { decision: 'accept_relative_to_capture' }, files: files(), summary: { totalXp: '0' } }; }
function mockedPublisher({ mutation = 'success', apply = true, readback = 'actual', blobFailure = false, metadata = 'valid', requestBudget = 30 } = {}) {
  const calls = []; let changed = false; let submitted = false;
  const publisher = createGithubPublisher({ token: TOKEN, requestBudget, maxRetries: 0, fetchImpl: async (url, init) => {
    const path = new URL(url).pathname; calls.push({ path, method: init.method });
    if (path === '/repos/owner/owner') return response(metadata === 'null' ? 'null' : { id: 9001, name: 'owner', full_name: 'owner/owner', owner: { id: metadata === 'wrong_owner' ? 9999 : 1001, login: 'owner', type: 'User' }, node_id: 'R_synthetic', default_branch: 'main', private: false, visibility: 'public' });
    if (path.endsWith('/git/ref/heads/main')) {
      if (submitted && readback === 'unavailable') return response({ message: TOKEN }, 503);
      if (submitted && readback === 'malformed') return response({ unexpected: TOKEN });
      return response({ object: { sha: submitted && readback === 'before' ? BEFORE : changed ? AFTER : BEFORE } });
    }
    if (path.endsWith('/git/commits/' + BEFORE)) return response({ tree: { sha: TREE } });
    if (path.endsWith('/git/blobs')) { if (blobFailure) throw new Error(TOKEN); return response({ sha: TREE }); }
    if (path.endsWith('/git/trees')) return response({ sha: TREE });
    if (path.endsWith('/git/commits')) return response({ sha: AFTER });
    if (path === '/graphql') {
      submitted = true;
      const input = JSON.parse(init.body).variables.input; assert.equal(input.refUpdates[0].beforeOid, BEFORE); assert.equal(input.refUpdates[0].force, false);
      if (mutation === 'conflict') return response({ message: TOKEN }, 422);
      if (mutation === 'denied') return response({ message: TOKEN }, 403);
      changed = apply;
      if (mutation === 'lost') throw new Error(TOKEN);
      if (mutation === 'server_error') return response({ message: TOKEN }, 503);
      if (mutation === 'invalid_json') return response('{ broken ' + TOKEN);
      if (mutation === 'invalid_receipt') return response({ data: { updateRefs: { clientMutationId: 'unrelated' } } });
      if (mutation === 'errors') return response({ data: { updateRefs: null }, errors: [{ type: 'UNKNOWN', message: TOKEN }] });
      return response({ data: { updateRefs: { clientMutationId: input.clientMutationId } } });
    }
    throw new Error(TOKEN);
  } });
  return { publisher, calls, changed: () => changed };
}
async function run(mock, { dryRun = false, input = prepared() } = {}) {
  return createActionRunUseCase({ prepare: async () => input, publish: mock.publisher.publish })({ workflowContext: { ownerAccountId: OWNER.accountId, repositoryId: OWNER.profileRepositoryId }, dryRun });
}
function assertUnknown(report) {
  assert.equal(report.decision, 'hold'); assert.equal(report.published, false); assert.equal(report.actualRecordsChanged, null);
  assert.equal(report.publicationOutcome, 'outcome_unknown'); assert.equal(report.progressionAuthorized, false);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN));
}

test('regression: CAS applied but its response and readback failed must not claim unchanged records', async () => {
  const mock = mockedPublisher({ mutation: 'lost', readback: 'unavailable' });
  const report = await run(mock);
  assert.equal(mock.changed(), true); assertUnknown(report); assert.equal(report.code, 'WRITE_OUTCOME_UNKNOWN');
  assert.equal(mock.calls.filter(call => call.path === '/graphql').length, 1); assert.equal(mock.calls.some(call => call.method === 'PATCH'), false);
});

for (const [mutation, code] of [['success', 'PUBLICATION_RESULT_UNCONFIRMED'], ['server_error', 'HTTP_UNAVAILABLE'], ['invalid_json', 'RESPONSE_JSON_INVALID'],
  ['invalid_receipt', 'GRAPHQL_RESULT_INVALID'], ['errors', 'GRAPHQL_MUTATION_REJECTED']]) {
  test(`unconfirmed post-CAS ${mutation} remains explicit unknown`, async () => {
    const mock = mockedPublisher({ mutation, readback: 'unavailable' }); const report = await run(mock);
    assert.equal(mock.changed(), true); assertUnknown(report); assert.equal(report.code, code); assert.equal(mock.calls.filter(call => call.path === '/graphql').length, 1);
  });
}

test('a malformed successful ref readback is unknown, never unchanged or confirmed publication', async () => {
  const report = await run(mockedPublisher({ readback: 'malformed' })); assertUnknown(report); assert.equal(report.code, 'PUBLICATION_RESULT_UNCONFIRMED');
});

test('nominal success with the old ref does not prove that a submitted mutation never happened', async () => {
  const report = await run(mockedPublisher({ readback: 'before' })); assertUnknown(report); assert.equal(report.code, 'PUBLICATION_RESULT_UNCONFIRMED');
});

for (const mutation of ['lost', 'server_error', 'invalid_json', 'invalid_receipt', 'errors']) {
  test(`exact authoritative ref readback confirms publication after ${mutation}`, async () => {
    const mock = mockedPublisher({ mutation }); const report = await run(mock);
    assert.equal(mock.changed(), true); assert.equal(report.decision, 'published'); assert.equal(report.published, true);
    assert.equal(report.code, 'PUBLISHED_READBACK_CONFIRMED'); assert.equal(report.actualRecordsChanged, true); assert.equal(report.publicationOutcome, 'published'); assert.equal(report.commitSha, AFTER);
    assert.equal(mock.calls.filter(call => call.path === '/graphql').length, 1);
  });
}

test('ordinary fully confirmed publication reports changed true', async () => {
  const report = await run(mockedPublisher()); assert.equal(report.code, 'PUBLISHED'); assert.equal(report.published, true); assert.equal(report.actualRecordsChanged, true); assert.equal(report.publicationOutcome, 'published');
});

test('uncertain object creation before CAS does not claim that profile growth files changed', async () => {
  const mock = mockedPublisher({ blobFailure: true }); const report = await run(mock);
  assert.equal(report.code, 'WRITE_OUTCOME_UNKNOWN'); assert.equal(report.actualRecordsChanged, false); assert.equal(report.publicationOutcome, 'not_published');
  assert.equal(mock.changed(), false); assert.equal(mock.calls.some(call => call.path === '/graphql'), false);
});

test('owner mismatch before object preparation remains definitively unchanged', async () => {
  const mock = mockedPublisher({ metadata: 'wrong_owner' }); const report = await run(mock);
  assert.equal(report.code, 'PUBLICATION_OWNER_BINDING_MISMATCH'); assert.equal(report.actualRecordsChanged, false); assert.equal(report.publicationOutcome, 'not_published'); assert.equal(mock.calls.some(call => call.method === 'POST'), false);
});

for (const mutation of ['conflict', 'denied']) {
  test(`definitive HTTP ${mutation} rejection cannot be mislabeled as a committed profile`, async () => {
    const mock = mockedPublisher({ mutation, readback: 'unavailable' }); const report = await run(mock);
    assert.equal(mock.changed(), false); assert.equal(report.published, false); assert.equal(report.actualRecordsChanged, false); assert.equal(report.publicationOutcome, 'not_published');
  });
}

test('CAS request blocked by budget is unchanged but budget-exhausted post-CAS readback is unknown', async () => {
  const beforeCas = mockedPublisher({ requestBudget: 11 }); const rejected = await run(beforeCas);
  assert.equal(rejected.actualRecordsChanged, false); assert.equal(rejected.publicationOutcome, 'not_published'); assert.equal(beforeCas.changed(), false); assert.equal(beforeCas.calls.some(call => call.path === '/graphql'), false);
  const afterCas = mockedPublisher({ requestBudget: 12 }); const unknown = await run(afterCas);
  assert.equal(afterCas.changed(), true); assertUnknown(unknown); assert.equal(unknown.code, 'PUBLICATION_RESULT_UNCONFIRMED');
});

test('default dry run never creates publication uncertainty or invokes publisher', async () => {
  const mock = mockedPublisher({ mutation: 'lost' }); const report = await run(mock, { dryRun: true });
  assert.equal(report.actualRecordsChanged, false); assert.equal(report.publicationOutcome, 'not_published'); assert.deepEqual(mock.calls, []);
});

test('an exception after publication capability invocation is sanitized as unknown', async () => {
  let changed = false;
  const report = await createActionRunUseCase({ prepare: async () => prepared(), publish: async () => { changed = true; throw new Error(TOKEN); } })({ workflowContext: { ownerAccountId: OWNER.accountId, repositoryId: OWNER.profileRepositoryId }, dryRun: false });
  assert.equal(changed, true); assertUnknown(report); assert.equal(report.code, 'ACTION_RUN_UNAVAILABLE'); assert.equal(report.stage, 'publication');
});

test('preparation exceptions before publication remain definitively unchanged', async () => {
  let invoked = false;
  const report = await createActionRunUseCase({ prepare: async () => { throw new Error(TOKEN); }, publish: async () => { invoked = true; } })({ workflowContext: {}, dryRun: false });
  assert.equal(invoked, false); assert.equal(report.actualRecordsChanged, false); assert.equal(report.publicationOutcome, 'not_published'); assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN));
});

test('a legacy or malformed publisher response cannot silently become an unchanged guarantee', async () => {
  for (const output of [undefined, null, { published: false, code: 'WRITE_OUTCOME_UNKNOWN' }, { published: false, code: 'UNKNOWN', actualRecordsChanged: false, publicationOutcome: 'outcome_unknown' }]) {
    const report = await createActionRunUseCase({ prepare: async () => prepared(), publish: async () => output })({ workflowContext: { ownerAccountId: OWNER.accountId, repositoryId: OWNER.profileRepositoryId }, dryRun: false });
    assertUnknown(report);
  }
});

test('unexpected internal publisher failure before CAS remains a sanitized no-record-change result', async () => {
  const mock = mockedPublisher({ metadata: 'null' });
  const result = await mock.publisher.publish({ repository: 'owner/owner', defaultBranch: 'main', expectedHead: BEFORE, files: files() });
  assert.equal(result.code, 'PUBLICATION_UNAVAILABLE'); assert.equal(result.actualRecordsChanged, false); assert.equal(result.publicationOutcome, 'not_published'); assert.equal(mock.calls.some(call => call.method === 'POST'), false);
});
