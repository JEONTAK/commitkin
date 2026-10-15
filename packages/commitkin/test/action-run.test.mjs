import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionRunUseCase } from '../src/application/run-action.mjs';
const context = { ownerAccountId: '1001', repositoryId: '9001' };
const result = () => ({ decision: 'prepared', code: 'DRY_RUN_READY', sourceModel: 'observed-api-v1', repository: 'a/a', owner: { accountId: '1001', profileRepositoryId: '9001' }, defaultBranch: 'main', expectedHead: 'a'.repeat(40), files: ['state','ledger','status','card','readme'], summary: { totalXp: '40' }, verification: { decision: 'accept_relative_to_capture' } });
test('Action defaults to dry run and never constructs publication authority from ready bytes alone', async () => {
  const calls = [], run = createActionRunUseCase({ prepare: async () => result(), publish: async value => { calls.push(value); } });
  const report = await run({ workflowContext: context });
  assert.equal(report.decision, 'prepared'); assert.equal(report.dryRun, true); assert.equal(report.actualRecordsChanged, false); assert.deepEqual(calls, []);
});
test('explicit publication uses a verified observed candidate and durable owner/repository bindings exactly once', async () => {
  const calls = [], run = createActionRunUseCase({ prepare: async () => result(), publish: async value => { calls.push(value); return { published: true, code: 'PUBLISHED', commitSha: 'b'.repeat(40) }; } });
  const report = await run({ workflowContext: context, dryRun: false });
  assert.equal(report.published, true); assert.equal(report.actualRecordsChanged, true); assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedRepositoryId, '9001'); assert.equal(calls[0].expectedOwnerAccountId, '1001');
});
test('same-date no-op never calls publisher, even with explicit publication intent', async () => {
  const unchanged = { ...result(), decision: 'unchanged', files: [] }, calls = [];
  const report = await createActionRunUseCase({ prepare: async () => unchanged, publish: async value => calls.push(value) })({ workflowContext: context, dryRun: false });
  assert.equal(report.decision, 'unchanged'); assert.deepEqual(calls, []);
});
for (const [label, change, code] of [
  ['legacy source', value => { value.sourceModel = 'github-public-historical-v1'; }, 'ACTION_SOURCE_VERIFICATION_REQUIRED'],
  ['unchecked source', value => { value.verification = {}; }, 'ACTION_SOURCE_VERIFICATION_REQUIRED'],
  ['wrong owner', value => { value.owner.accountId = '1002'; }, 'ACTION_PUBLICATION_BINDING_INVALID'],
  ['wrong profile', value => { value.owner.profileRepositoryId = '9002'; }, 'ACTION_PUBLICATION_BINDING_INVALID'],
]) test(`publication refuses ${label}`, async () => {
  const value = result(); change(value);
  const report = await createActionRunUseCase({ prepare: async () => value, publish: async () => { throw new TypeError('MUST_NOT_WRITE'); } })({ workflowContext: context, dryRun: false });
  assert.equal(report.code, code); assert.equal(report.actualRecordsChanged, false);
});
test('held collection, malformed intent, missing writer and uncertain publication never become successful growth', async () => {
  const failure = await createActionRunUseCase({ prepare: async () => ({ decision: 'hold', code: 'SOURCE_UNAVAILABLE', stage: 'collection' }) })({ workflowContext: context });
  assert.equal(failure.code, 'SOURCE_UNAVAILABLE');
  const run = createActionRunUseCase({ prepare: async () => result() });
  assert.equal((await run({ workflowContext: context, dryRun: 'false' })).code, 'ACTION_INPUT_INVALID');
  assert.equal((await run({ workflowContext: context, dryRun: false })).code, 'ACTION_PUBLICATION_BINDING_INVALID');
  const unknown = await createActionRunUseCase({ prepare: async () => result(), publish: async () => ({ published: false, code: 'WRITE_OUTCOME_UNKNOWN' }) })({ workflowContext: context, dryRun: false });
  assert.equal(unknown.code, 'WRITE_OUTCOME_UNKNOWN'); assert.equal(unknown.published, false);
});
test('exceptions remain sanitized and no prepared record bytes enter output reports', async () => {
  const failed = await createActionRunUseCase({ prepare: async () => { throw new Error('private-token-marker'); } })({ workflowContext: context });
  assert.doesNotMatch(JSON.stringify(failed), /private-token-marker/);
  const success = await createActionRunUseCase({ prepare: async () => result() })({ workflowContext: context });
  assert.equal(Object.hasOwn(success, 'files'), false); assert.equal(Object.hasOwn(success, 'candidate'), false);
});
