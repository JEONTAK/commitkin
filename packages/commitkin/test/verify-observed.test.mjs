import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createValidator } from '../../record-validator/src/index.js';
import { digest } from '../../record-validator/src/domain/hash.js';
import { createSnapshotEvaluationUseCase } from '../src/application/evaluate.mjs';
import { createObservedCandidateVerifier } from '../src/application/verify-observed.mjs';
import { activityIdentity } from '../src/domain/evidence/qualify.mjs';

const RECORDS = new URL('../../../test/fixtures/records/v1/valid/ready-empty/', import.meta.url);
const ACCOUNT = '1001'; const REPO = '9001'; const STARTED = '2026-10-16T00:00:00Z'; const COMPLETED = '2026-10-16T01:00:00Z';
const WHEN = '2026-10-15T12:00:00Z'; const clone = value => structuredClone(value);
const validateRecords = createValidator();
const evaluate = createSnapshotEvaluationUseCase({ validateRecords });
const verify = createObservedCandidateVerifier({ validateRecords });
const previousEmpty = () => Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, JSON.parse(readFileSync(new URL(role + '.json', RECORDS), 'utf8'))]));
const previousPending = () => Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, JSON.parse(readFileSync(new URL('../first-analysis-pending/' + role + '.json', RECORDS), 'utf8'))]));
const identity = (kind, sourceId) => activityIdentity({ kind, accountId: ACCOUNT, repositoryId: REPO, sourceId });
function mergedPr(value = '17', when = WHEN, families = ['craft']) {
  return { sourceId: { type: 'numeric', value }, fact: { eventKey: identity('merged_pr', value), kind: 'merged_pr', repositoryId: REPO, occurredAt: when, families, prKey: identity('pull_request', value), bugEvidenced: families.includes('recovery') } };
}
function review(value = '300', when = WHEN, prId = '18', commitOid = 'b'.repeat(40)) {
  return { sourceId: { type: 'numeric', value }, fact: { eventKey: identity('submitted_review', value), kind: 'submitted_review', repositoryId: REPO, occurredAt: when, families: ['guard'], prKey: identity('pull_request', prId), reviewedCommitKey: identity('reviewed_commit', { pullRequestId: prId, commitOid }) } };
}
function release(value = '600', when = WHEN) {
  return { sourceId: { type: 'numeric', value }, fact: { eventKey: identity('published_release', value), kind: 'published_release', repositoryId: REPO, occurredAt: when, families: ['operations'], releaseKey: identity('release', value) } };
}
function sourceQualification(activities, reviewHistoryFacts = []) {
  return { sourceModel: 'observed-api-v1', decision: 'qualified', code: 'QUALIFIED_OBSERVED_API_CAPTURE', activities, reviewHistoryFacts, sourceAuthenticity: 'not_checked', progressionAuthorized: false };
}
function context() {
  return { expected: { subject: { accountId: ACCOUNT, profileRepositoryId: REPO } }, evaluation: { startedAt: STARTED, inspectedAt: COMPLETED } };
}
function proposal({ previous = previousEmpty(), activities = [mergedPr()], priorActivities = [], reviewHistoryFacts = [] } = {}) {
  const result = evaluate({ previous, expectedOwner: previous.state.owner, activities, priorActivities, reviewHistoryFacts, repositoryIds: [REPO], settings: { version: 1, repositories: { additional: [], exclude: [] } }, settingsFileUsed: true, evaluationStartedAt: STARTED, evaluatedAt: COMPLETED });
  assert.equal(result.decision, 'proposed', result.code); assert.equal(result.recordReport.code, 'ACCEPT');
  return { context: context(), previous, candidate: result.candidate, qualification: sourceQualification(activities, reviewHistoryFacts) };
}
function assertHold(input, code, verifier = verify) {
  const result = verifier(input); assert.equal(result.decision, 'hold'); assert.equal(result.code, code); assert.equal(result.sourceModel, 'observed-api-v1'); assert.equal(result.progressionAuthorized, false); assert.equal(result.sourceAuthenticity, 'not_checked'); return result;
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('independent verifier accepts real validated meaningful activity and approves no publication or source authentication', () => {
  const input = proposal({ activities: [mergedPr(), review(), release()] }); const before = clone(input);
  const result = verify(freeze(input));
  assert.equal(result.decision, 'accept_relative_to_capture'); assert.equal(result.code, 'OBSERVED_CANDIDATE_MATCH');
  assert.equal(input.candidate.state.growth.totalXp, '80'); assert.equal(input.candidate.ledger.facts.length, 3);
  assert.equal(result.sourceEligibility, 'passed_relative_to_capture'); assert.equal(result.rewardOrder, 'passed'); assert.equal(result.rewardAllocation, 'passed');
  assert.equal(result.recordReport.code, 'ACCEPT'); assert.equal(result.recordReport.transitionGuards, 'passed');
  assert.equal(result.progressionAuthorized, false); assert.equal(result.sourceAuthenticity, 'not_checked'); assert.deepEqual(input, before);
});

test('first-install-style empty known complete candidate is checked without inventing activity', () => {
  const input = proposal({ activities: [] }); const result = verify(input);
  assert.equal(result.decision, 'accept_relative_to_capture'); assert.equal(input.candidate.state.growth.totalXp, '0'); assert.deepEqual(input.candidate.ledger.facts, []);
});

test('first successful meaningful analysis after a real pending fixture independently settles from no prior growth', () => {
  const input = proposal({ previous: previousPending() }); assert.equal(input.previous.state.growth.phase, 'pending');
  assert.equal(verify(input).decision, 'accept_relative_to_capture'); assert.equal(input.candidate.state.growth.totalXp, '40');
});

test('capped meaningful-day settlement independently matches original-ID ordering despite activity input permutation', () => {
  const activities = [mergedPr('19'), mergedPr('17'), mergedPr('18'), review('302', WHEN, '32'), review('300', WHEN, '30'), review('301', WHEN, '31'), release()];
  const input = proposal({ activities }); assert.equal(input.candidate.state.growth.totalXp, '100');
  input.qualification.activities.reverse(); assert.equal(verify(input).decision, 'accept_relative_to_capture');
  const day = input.candidate.ledger.days[0]; assert.equal(day.xp.total, 100); assert.ok(day.xp.releases < 25 || day.xp.reviews < 45);
});

test('wrong/missing source model or nonqualified source fails before candidate safety is invoked', () => {
  let calls = 0; const guarded = createObservedCandidateVerifier({ validateRecords: () => { calls += 1; throw new Error('MUST_NOT_RUN'); } });
  for (const qualification of [undefined, null, { ...sourceQualification([]), sourceModel: 'legacy-v1' }, { ...sourceQualification([]), decision: 'hold' }, { ...sourceQualification([]), sourceModel: 'github-public-observed-v1' }]) assertHold({ qualification }, 'SOURCE_MODEL_MISMATCH', guarded);
  assert.equal(calls, 0);
});

test('real candidate safety rejects changed ledger bytes without matching integrity hash', () => {
  const input = proposal(); input.candidate.ledger.facts[0].families = ['knowledge'];
  assertHold(input, 'OBSERVED_CANDIDATE_SAFETY_FAILED');
});

test('real candidate safety rejects owner mismatch and faction rewriting before independent settlement', () => {
  const wrongOwner = proposal(); wrongOwner.context.expected.subject.accountId = '9999'; assertHold(wrongOwner, 'OBSERVED_CANDIDATE_SAFETY_FAILED');
  const wrongFaction = proposal(); wrongFaction.candidate.state.faction.id = 'ashbound'; assertHold(wrongFaction, 'OBSERVED_CANDIDATE_SAFETY_FAILED');
});

test('a separately record-valid candidate with the wrong fact classification fails independent fact equality', () => {
  const input = proposal({ activities: [mergedPr('17', WHEN, ['knowledge'])] });
  input.qualification = sourceQualification([mergedPr('17', WHEN, ['craft'])]);
  assertHold(input, 'OBSERVED_FACTS_MISMATCH');
});

test('record-valid candidate reward amounts still fail when actual earliest-review history changes settlement', () => {
  const current = review(); const input = proposal({ activities: [current] }); assert.equal(input.candidate.state.growth.totalXp, '25');
  const historical = review('299', '2026-07-16T00:00:00Z', '18', 'c'.repeat(40));
  input.qualification.reviewHistoryFacts = [historical.fact, current.fact];
  assertHold(input, 'OBSERVED_REWARDS_MISMATCH');
});

test('same capped total is insufficient when independent original ordering changes per-kind reward allocation', () => {
  const activities = [mergedPr('17'), mergedPr('18'), mergedPr('19'), review('300', WHEN, '30'), review('301', WHEN, '31'), review('302', WHEN, '32'), release()];
  // Adversarial candidate construction: the proposal builder assumes its ordering
  // metadata was bound by qualification. Here deliberately give it another order.
  const changedOrder = clone(activities); changedOrder.at(-1).sourceId.value = '1';
  const input = proposal({ activities: changedOrder }); assert.equal(input.candidate.state.growth.totalXp, '100');
  input.qualification = sourceQualification(activities);
  assertHold(input, 'OBSERVED_REWARDS_MISMATCH');
});

test('missing original ordering context on an affected settled date holds instead of repricing from hashes', () => {
  const old = mergedPr('17'); const earlier = proposal({ activities: [old] }); const previous = earlier.candidate; const added = release();
  const input = proposal({ previous, activities: [old, added], priorActivities: [old] });
  input.qualification = sourceQualification([added]);
  assertHold(input, 'MISSING_PRIOR_ORDERING_EVIDENCE');
});

test('known retained original ordering context permits additional same-day reward without mutating retained fact', () => {
  const old = mergedPr('17'); const previous = proposal({ activities: [old] }).candidate; const added = release();
  const input = proposal({ previous, activities: [old, added], priorActivities: [old] }); const before = clone(input);
  assert.equal(verify(freeze(input)).decision, 'accept_relative_to_capture'); assert.equal(input.candidate.state.growth.totalXp, '65'); assert.deepEqual(input, before);
});

test('settlement refuses malformed trusted activity metadata even when public candidate records are safe', () => {
  const input = proposal(); input.qualification.activities[0].sourceId.value = 'not-numeric'; assertHold(input, 'INVALID_QUALIFIED_INPUT');
});

test('reordered candidate fact arrays compare semantically after real canonical integrity is recomputed', () => {
  const input = proposal({ activities: [mergedPr(), review(), release()] }); input.candidate.ledger.facts.reverse(); input.candidate.state.integrity.ledgerHash = digest(input.candidate.ledger);
  assert.equal(verify(input).decision, 'accept_relative_to_capture');
});

test('several day rows compare by their original date rather than input array order', () => {
  const input = proposal({ activities: [mergedPr('17', '2026-10-14T12:00:00Z'), release('600', WHEN)] });
  assert.equal(input.candidate.ledger.days.length, 2); input.candidate.ledger.days.reverse(); input.candidate.state.integrity.ledgerHash = digest(input.candidate.ledger);
  assert.equal(verify(input).decision, 'accept_relative_to_capture');
});

test('unexpected validator errors and malformed context return one sanitized safe hold code', () => {
  const input = proposal(); const thrown = createObservedCandidateVerifier({ validateRecords: () => { throw new Error('PRIVATE_TOKEN_IN_RAW_STACK'); } });
  const report = assertHold(input, 'OBSERVED_VERIFICATION_UNAVAILABLE', thrown); assert.equal(JSON.stringify(report).includes('PRIVATE_TOKEN'), false);
  input.context = null; assertHold(input, 'OBSERVED_VERIFICATION_UNAVAILABLE');
});
