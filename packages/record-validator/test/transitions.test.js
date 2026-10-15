import test from 'node:test';
import assert from 'node:assert/strict';
import { createValidator } from '../src/index.js';
import { checkTransition } from '../src/domain/transition-checks.js';
import { CONTEXT, inputs, objects, encoded, next } from './helpers.js';
import { digest } from '../src/domain/hash.js';

const validate = createValidator();
function verify(before, after, date = '2026-10-16', operation = 'normal') {
  return validate(encoded(after), { ...CONTEXT, now: date + 'T02:00:00Z', operation }, encoded(before));
}
function pendingClass(bundle, count = 1, startedOn = '2026-10-15', targetId = 'blacksmith') {
  bundle.state.class.pending = { targetId, count, startedOn, lastCountedOn: bundle.state.observationClock.lastNormalEvaluationOn, contextScopeId: bundle.state.evaluation.scopeId };
  bundle.state.observationClock.classLastCountedOn = bundle.state.observationClock.lastNormalEvaluationOn;
  return bundle;
}
function regular(bundle, date = '2026-10-01', id = 'blacksmith') {
  bundle.state.class = { id, lastChangedOn: date, pending: null, history: [{ classId: id, assignedAt: date + 'T01:00:00Z' }] };
  return bundle;
}
function trait(bundle, count, target = null, startedOn = '2026-10-14', slot = 'habit') {
  bundle.state.traits[slot] = { currentId: slot === 'habit' ? 'steadfast' : 'documenting', pending: { targetId: target, count, startedOn, lastCountedOn: bundle.state.observationClock.lastNormalEvaluationOn } };
  bundle.state.observationClock[slot + 'LastCountedOn'] = bundle.state.observationClock.lastNormalEvaluationOn;
  return bundle;
}

test('same date replay and old valid record never expire', () => {
  for (const now of [CONTEXT.now, '2027-10-15T02:00:00Z']) {
    const report = validate(inputs(), { ...CONTEXT, now }, inputs());
    assert.equal(report.transitionCode, 'REPLAY_UNCHANGED');
    assert.equal(report.progressionAuthorized, false);
  }
});
test('failure and metadata-only preserve a successful character', () => {
  for (const [fixture, operation] of [['partial-retain-success', 'failed-collection'], ['metadata-only-revision', 'metadata-only']]) {
    const report = validate(inputs('valid/' + fixture), { ...CONTEXT, operation }, inputs());
    assert.equal(report.transitionCode, 'SUCCESS_PRESERVED', JSON.stringify(report));
    assert.equal(report.decision, 'preserve');
  }
});
test('status-only is strictly a primary-record no-op', () => {
  assert.equal(validate(inputs(), { ...CONTEXT, operation: 'status-only' }, inputs()).transitionCode, 'STATUS_ONLY_UNCHANGED');
  assert.equal(verify(objects(), next(), '2026-10-16', 'status-only').code, 'STATUS_ONLY_CHANGED_GROWTH');
});
for (const [name, mutate, code] of [
  ['faction id', after => { after.state.faction.id = 'ashbound'; }, 'FACTION_IMMUTABLE'],
  ['faction confirmation', after => { after.state.faction.confirmedAt = '2026-10-14T00:00:00Z'; }, 'FACTION_IMMUTABLE'],
  ['growth start', after => { after.state.growth.startDate = '2026-07-16'; }, 'GROWTH_START_IMMUTABLE'],
  ['achievements retained', after => { after.state.achievements = []; }, 'ACHIEVEMENT_LOST'],
  ['fact retention', after => { after.ledger.facts.push({ ...after.ledger.facts[0], eventKey: digest('extra'), prKey: digest('extra-pr') }); }, null],
  ['revision step', after => { after.state.recordRevision++; after.ledger.recordRevision++; after.status.recordRevision++; }, 'REVISION_STEP_INVALID'],
  ['successful revision', after => { after.state.evaluation.lastSuccessfulRevision = 1; after.status.lastSuccessfulRevision = 1; }, 'SUCCESS_REVISION_NOT_CURRENT'],
]) test('normal guard: ' + name, () => {
  const before = objects(); const after = next(before); mutate(after);
  const report = verify(before, after);
  assert.equal(report.code, code ?? 'ACCEPT', JSON.stringify(report));
});
test('failure does not count observations or issue new awards', () => {
  const before = objects(); const after = objects('valid/metadata-only-revision');
  after.state.achievements = [];
  assert.equal(verify(before, after, '2026-10-15', 'metadata-only').code, 'FAILURE_CHANGED_GROWTH');
  assert.equal(verify(before, objects(), '2026-10-15', 'failed-collection').code, 'FAILURE_STATUS_REQUIRED');
  const changed = objects('valid/metadata-only-revision');
  changed.ledger.repositories[0].ownershipAtFirstObservation = 'other';
  assert.equal(verify(before, changed, '2026-10-15', 'metadata-only').code, 'TRACKING_HISTORY_LOST');
});
test('same-date pending observation cannot be incremented or restarted', () => {
  const before = pendingClass(objects()); const after = next(before, '2026-10-15');
  after.state.class.pending.count = 2;
  // Independent snapshot bound catches this even before the prior/candidate guard.
  assert.equal(verify(before, after, '2026-10-15').code, 'OBSERVATION_CLOCK_INVALID');
  after.state.class.pending.count = 1; after.state.class.pending.targetId = 'warden';
  assert.equal(verify(before, after, '2026-10-15').code, 'SAME_DATE_OBSERVATION');
  after.state.class.pending = null;
  assert.equal(verify(before, after, '2026-10-15').code, 'ACCEPT');
});
test('new class candidate after gap two increments once, gap three resets', () => {
  const before = pendingClass(objects(), 2, '2026-10-13');
  for (const [date, count, start, expected] of [
    ['2026-10-17', 3, '2026-10-13', 'ACCEPT'],
    ['2026-10-18', 3, '2026-10-13', 'OBSERVATION_RESET_REQUIRED'],
    ['2026-10-18', 1, '2026-10-18', 'ACCEPT'],
    ['2026-10-16', 4, '2026-10-13', 'OBSERVATION_INCREMENT_INVALID'],
  ]) {
    const after = pendingClass(next(before, date), count, start);
    assert.equal(verify(before, after, date).code, expected);
  }
});
test('saturated class seven remains seven on another qualifying date', () => {
  const before = pendingClass(regular(objects(), '2026-10-14'), 7, '2026-10-09', 'warden');
  const after = pendingClass(next(before), 7, '2026-10-09', 'warden');
  assert.equal(verify(before, after).code, 'ACCEPT');
  after.state.class.pending.startedOn = '2026-10-08';
  assert.equal(verify(before, after).code, 'OBSERVATION_INCREMENT_INVALID');
});
test('material scope resets class only, retaining trait observation progress', () => {
  const before = trait(pendingClass(objects(), 2, '2026-10-14'), 1, null, '2026-10-15');
  const after = next(before);
  const scope = { rulesetVersion: '1.0.0', analysisConfigHash: before.ledger.scopes[0].analysisConfigHash, repositoryIds: [] };
  const scopeId = digest(scope);
  after.ledger.scopes.push({ id: scopeId, ...scope });
  after.state.evaluation.scopeId = scopeId;
  pendingClass(after, 1, '2026-10-16');
  trait(after, 2, null, '2026-10-15');
  assert.equal(verify(before, after).code, 'ACCEPT');
  after.state.class.pending.count = 3; after.state.class.pending.startedOn = '2026-10-14';
  assert.equal(verify(before, after).code, 'OBSERVATION_RESET_REQUIRED');
});
test('class switch requires seven actual observations and fourteen calendar dates', () => {
  for (const [changedOn, count, expected] of [
    ['2026-10-03', 6, 'CLASS_COOLDOWN'],
    ['2026-10-02', 5, 'CLASS_OBSERVATIONS_REQUIRED'],
    ['2026-10-02', 6, 'ACCEPT'],
  ]) {
    const before = pendingClass(regular(objects(), changedOn), count, '2026-10-10', 'warden');
    const after = next(before);
    after.state.class.id = 'warden'; after.state.class.lastChangedOn = '2026-10-16'; after.state.class.pending = null;
    after.state.class.history.push({ classId: 'warden', assignedAt: '2026-10-16T01:00:00Z' });
    after.state.observationClock.classLastCountedOn = '2026-10-16';
    assert.equal(verify(before, after).code, expected, JSON.stringify(verify(before, after)));
  }
});
test('trait null removal is applied only on third distinct normal date', () => {
  for (const count of [1, 2]) {
    const before = trait(objects(), count);
    const after = next(before);
    after.state.traits.habit = { currentId: null, pending: null };
    after.state.observationClock.habitLastCountedOn = '2026-10-16';
    assert.equal(verify(before, after).code, count === 2 ? 'ACCEPT' : 'TRAIT_OBSERVATIONS_REQUIRED');
  }
  const before = trait(objects(), 2);
  const after = trait(next(before), 3);
  assert.equal(verify(before, after).code, 'TRAIT_CHANGE_NOT_APPLIED');
});
test('empty used trait slot cannot use the immediate initial exception', () => {
  const before = objects(); before.state.observationClock.habitLastCountedOn = '2026-10-14';
  const after = next(before); after.state.traits.habit.currentId = 'steadfast'; after.state.observationClock.habitLastCountedOn = '2026-10-16';
  assert.equal(verify(before, after).code, 'TRAIT_OBSERVATIONS_REQUIRED');
  before.state.observationClock.habitLastCountedOn = null;
  assert.equal(verify(before, after).code, 'ACCEPT');
});
test('late evidence adds only net original-date delta and preserves capped facts', () => {
  for (const [prior, later, delta] of [
    ['ready-95xp-before-late-release', 'ready-100xp-after-late-release', 5],
    ['ready-100xp-capped', 'ready-100xp-reallocated', 0],
  ]) {
    const before = objects('valid/' + prior);
    const after = objects('valid/' + later);
    // Existing samples describe stand-alone revision 1; create an explicit revision-2 candidate in memory.
    after.state.recordRevision = 2; after.ledger.recordRevision = 2; after.status.recordRevision = 2;
    after.state.evaluation.lastSuccessfulRevision = 2; after.status.lastSuccessfulRevision = 2;
    assert.equal(BigInt(after.state.growth.totalXp) - BigInt(before.state.growth.totalXp), BigInt(delta));
    assert.equal(verify(before, after, '2026-10-15').code, 'ACCEPT');
  }
  const before = objects('valid/ready-100xp-capped');
  const after = next(before); after.ledger.facts.splice(6, 1);
  assert.equal(verify(before, after).code, 'EVIDENCE_LOST');
  const reduced = next(before); reduced.ledger.days[0].xp.releases = 10; reduced.ledger.days[0].xp.total = 95; reduced.state.growth.totalXp = '95';
  assert.equal(verify(before, reduced).code, 'SETTLEMENT_REDUCED');
});
test('loss, pending reset, correction authorization and bad previous snapshots fail closed', () => {
  const before = objects();
  const pending = objects('valid/first-analysis-pending');
  pending.state.recordRevision = 2; pending.ledger.recordRevision = 2; pending.status.recordRevision = 2;
  assert.equal(verify(before, pending).code, 'NORMAL_STATUS_REQUIRED');
  const broken = inputs(); broken.ledger = null;
  assert.equal(validate(inputs(), CONTEXT, broken).code, 'RECORD_MISSING');
  const brokenStatus = inputs(); brokenStatus.status = Buffer.from('{');
  assert.equal(validate(inputs(), CONTEXT, brokenStatus).code, 'PREVIOUS_RECORD_INVALID');
  // Pure safety rules also reject changes that do not satisfy a complete schema;
  // the composed public validator always performs schema checks first.
  const after = next(before); after.ledger.corrections.push({ id: 'fictional' });
  assert.throws(() => checkTransition(before, after, { ...CONTEXT, now: '2026-10-16T02:00:00Z' }), { code: 'CORRECTION_REVIEW_REQUIRED' });
});
