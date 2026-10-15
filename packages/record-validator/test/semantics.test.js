import test from 'node:test';
import assert from 'node:assert/strict';
import { createValidator } from '../src/index.js';
import { checkTransition } from '../src/domain/transition-checks.js';
import { digest, scopeDigest } from '../src/domain/hash.js';
import { CONTEXT, objects, encoded, next, inputs } from './helpers.js';

const validate = createValidator();
for (const [name, mutate, code] of [
  ['repo IDs unique', b => b.ledger.repositories.push(b.ledger.repositories[0]), 'DUPLICATE_REPOSITORY_ID'],
  ['scopes unique', b => b.ledger.scopes.push(b.ledger.scopes[0]), 'DUPLICATE_SCOPE_ID'],
  ['day identity unique', b => b.ledger.days.push(b.ledger.days[0]), 'DUPLICATE_DAY'],
  ['series unique', b => b.state.achievements.push({ ...b.state.achievements[0], earned: [{ grade: 'bronze', earnedAt: '2026-10-15T00:59:00Z' }] }), 'DUPLICATE_ACHIEVEMENT_SERIES'],
  ['scope repo must exist', b => { b.ledger.scopes[0].repositoryIds.push('9876'); }, 'UNKNOWN_REPOSITORY_REFERENCE'],
  ['scope rules match', b => { b.ledger.scopes[0].rulesetVersion = '2.0.0'; }, 'SCOPE_RULESET_MISMATCH'],
  ['analysis hash', b => { b.ledger.scopes[0].analysisConfigHash = digest('wrong'); }, 'ANALYSIS_CONFIG_HASH_MISMATCH'],
  ['scope hash', b => { b.ledger.scopes[0].repositoryIds = []; }, 'SCOPE_HASH_MISMATCH'],
  ['evaluation scope exists', b => { b.state.evaluation.scopeId = digest('wrong'); }, 'UNKNOWN_SCOPE_REFERENCE'],
  ['factual date not current day', b => { b.ledger.facts[0].occurredAt = '2026-10-15T00:00:00Z'; }, 'FACT_DATE_INVALID'],
  ['fact before growth', b => { b.ledger.facts[0].occurredAt = '2026-07-16T00:00:00Z'; }, 'FACT_DATE_INVALID'],
  ['duplicate PR distinct event key', b => { b.ledger.facts.push({ ...b.ledger.facts[0], eventKey: digest('distinct') }); }, 'DUPLICATE_SOURCE_IDENTITY'],
  ['repo aggregate unique', b => b.ledger.days[0].byRepository.push(b.ledger.days[0].byRepository[0]), 'DUPLICATE_DAY_REPOSITORY'],
  ['family needs evidence', b => { b.ledger.days[0].byRepository[0].familyUnits.craft = 1; }, 'MISSING_EVIDENCE_REFERENCE'],
  ['common bonus paid first', b => { b.ledger.days[0].xp.validDay = 5; b.ledger.days[0].xp.total = 35; b.state.growth.totalXp = '35'; }, 'COMMON_BONUS_INVALID'],
  ['settlement coverage required', b => { b.ledger.coverage[0].complete = false; }, 'SETTLEMENT_COVERAGE_MISSING'],
  ['coverage begins after growth', b => { b.ledger.coverage[0].startDate = '2026-07-16'; }, 'COVERAGE_DATE_INVALID'],
  ['pending not finalized', b => { b.state.evaluation.activityCutoffExclusive = '2026-10-14'; b.ledger.coverage[0].endDateExclusive = '2026-10-14'; b.ledger.facts[0].occurredAt = '2026-10-13T00:00:00Z'; b.ledger.days[0].date = '2026-10-13'; }, 'EVALUATION_DATE_MISMATCH'],
  ['observation future', b => { b.state.observationClock.habitLastCountedOn = '2026-10-16'; }, 'OBSERVATION_CLOCK_INVALID'],
  ['future faction', b => { b.state.faction.confirmedAt = '2026-10-16T01:00:00Z'; }, 'FUTURE_TIMESTAMP'],
  ['future growth', b => { b.state.growth.startDate = '2026-10-16'; b.ledger.coverage = []; b.ledger.days = []; b.ledger.facts = []; b.state.growth.totalXp = '0'; }, 'FUTURE_DATE'],
  ['future status', b => { b.status.changedAt = '2026-10-16T01:00:00Z'; }, 'FUTURE_TIMESTAMP'],
  ['future repository metadata', b => { b.ledger.repositories[0].firstObservedAt = '2026-10-16T01:00:00Z'; }, 'FUTURE_TIMESTAMP'],
  ['future achievement', b => { b.state.achievements[0].earned[0].earnedAt = '2026-10-16T01:00:00Z'; }, 'FUTURE_TIMESTAMP'],
  ['huge XP never rounded to match', b => { b.state.growth.totalXp = '9007199254740993'; }, 'XP_TOTAL_MISMATCH'],
]) test('semantic rejection: ' + name, () => {
  const bundle = objects(); mutate(bundle);
  const report = validate(encoded(bundle), CONTEXT);
  assert.equal(report.code, code, JSON.stringify(report));
  assert.equal(report.progressionAuthorized, false);
});

test('scope identity sorts decimal IDs numerically and ignores input order', () => {
  const base = { rulesetVersion: '1.0.0', analysisConfigHash: digest({ rulesetVersion: '1.0.0', publicOnly: true }) };
  assert.equal(scopeDigest({ ...base, repositoryIds: ['10', '2', '10'] }), digest({ ...base, repositoryIds: ['2', '10'] }));
  assert.equal(scopeDigest({ ...base, repositoryIds: ['9007199254740993', '9007199254740992'] }), digest({ ...base, repositoryIds: ['9007199254740992', '9007199254740993'] }));
});
test('class/history and pending date/scope consistency', () => {
  const base = objects();
  base.state.class = { id: 'blacksmith', lastChangedOn: '2026-10-14', pending: null, history: [{ classId: 'blacksmith', assignedAt: '2026-10-14T01:00:00Z' }] };
  assert.equal(validate(encoded(base), CONTEXT).code, 'ACCEPT');
  for (const [mutate, code] of [
    [b => { b.state.class.history[0].classId = 'warden'; }, 'CLASS_HISTORY_INVALID'],
    [b => { b.state.class.history.push({ classId: 'blacksmith', assignedAt: '2026-10-15T01:00:00Z' }); }, 'CLASS_HISTORY_INVALID'],
    [b => { b.state.class.pending = { targetId: 'blacksmith', count: 1, startedOn: '2026-10-15', lastCountedOn: '2026-10-15', contextScopeId: b.state.evaluation.scopeId }; }, 'PENDING_TARGET_UNCHANGED'],
    [b => { b.state.class.pending = { targetId: 'warden', count: 1, startedOn: '2026-10-16', lastCountedOn: '2026-10-15', contextScopeId: b.state.evaluation.scopeId }; }, 'PENDING_DATES_INVALID'],
    [b => { b.state.class.pending = { targetId: 'warden', count: 1, startedOn: '2026-10-15', lastCountedOn: '2026-10-15', contextScopeId: digest('wrong') }; b.state.observationClock.classLastCountedOn = '2026-10-15'; }, 'PENDING_SCOPE_MISMATCH'],
  ]) {
    const bundle = structuredClone(base); mutate(bundle);
    assert.equal(validate(encoded(bundle), CONTEXT).code, code);
  }
});
test('correction chains are consistency checks, not authorization or a second XP payment', () => {
  const bundle = objects();
  bundle.state.growth.totalXp = '35'; bundle.ledger.days[0].xp.mergedPrs = 15; bundle.ledger.days[0].xp.total = 35;
  const correction = { id: digest('correction'), date: '2026-10-14', reasonCode: 'CALCULATION_CORRECTION', beforeXp: 40, afterXp: 35, affectedKeys: [bundle.ledger.facts[0].eventKey], correctedAt: '2026-10-15T01:30:00Z' };
  bundle.ledger.corrections.push(correction);
  const result = validate(encoded(bundle), CONTEXT);
  assert.equal(result.code, 'ACCEPT'); assert.ok(result.notChecked.includes('correction_authorization'));
  bundle.ledger.corrections.push({ ...correction, id: digest('next'), beforeXp: 36, afterXp: 35, correctedAt: '2026-10-15T01:45:00Z' });
  assert.equal(validate(encoded(bundle), CONTEXT).code, 'CORRECTION_CHAIN_INVALID');
  bundle.ledger.corrections.pop(); bundle.ledger.corrections[0].afterXp = 30;
  assert.equal(validate(encoded(bundle), CONTEXT).code, 'CORRECTION_CHAIN_INVALID');
  bundle.ledger.corrections[0].date = '2026-10-13';
  assert.equal(validate(encoded(bundle), CONTEXT).code, 'CORRECTION_INVALID');
});
test('midnight completion uses frozen evaluation-start date, not finish date', () => {
  const before = objects();
  const after = next(before, '2026-10-16');
  after.state.evaluation.evaluatedAt = '2026-10-17T00:01:00Z';
  after.status.changedAt = after.state.evaluation.evaluatedAt;
  const context = { ...CONTEXT, now: '2026-10-17T00:02:00Z', evaluationStartedAt: '2026-10-16T23:59:00Z' };
  assert.equal(validate(encoded(after), context, encoded(before)).code, 'ACCEPT');
  const changedClass = structuredClone(after);
  changedClass.state.class = { id: 'blacksmith', lastChangedOn: '2026-10-16', pending: null, history: [{ classId: 'blacksmith', assignedAt: '2026-10-17T00:01:00Z' }] };
  changedClass.state.observationClock.classLastCountedOn = '2026-10-16';
  assert.equal(validate(encoded(changedClass), context, encoded(before)).code, 'ACCEPT');
  assert.equal(validate(encoded(after), { ...CONTEXT, now: context.now }, encoded(before)).code, 'EVALUATION_CONTEXT_MISMATCH');
  assert.equal(validate(encoded(after), { ...context, evaluationStartedAt: '2026-10-18T01:00:00Z' }, encoded(before)).code, 'VALIDATION_CONTEXT_INVALID');
});
test('stale pending counts cannot survive a later normal evaluation unobserved', () => {
  const bundle = next(objects());
  bundle.state.class.pending = { targetId: 'blacksmith', count: 1, startedOn: '2026-10-15', lastCountedOn: '2026-10-15', contextScopeId: bundle.state.evaluation.scopeId };
  bundle.state.observationClock.classLastCountedOn = '2026-10-15';
  assert.equal(validate(encoded(bundle), { ...CONTEXT, now: '2026-10-16T02:00:00Z' }).code, 'PENDING_DATES_INVALID');
});
test('first normal evaluation does not invent historical observations', () => {
  const before = objects('valid/first-analysis-pending');
  const after = objects(); after.state.recordRevision = 2; after.ledger.recordRevision = 2; after.status.recordRevision = 2;
  after.state.evaluation.lastSuccessfulRevision = 2; after.status.lastSuccessfulRevision = 2;
  assert.equal(validate(encoded(after), CONTEXT, encoded(before)).code, 'ACCEPT');
  after.state.class.pending = { targetId: 'blacksmith', count: 7, startedOn: '2026-10-09', lastCountedOn: '2026-10-15', contextScopeId: after.state.evaluation.scopeId };
  after.state.observationClock.classLastCountedOn = '2026-10-15';
  assert.equal(validate(encoded(after), CONTEXT, encoded(before)).code, 'FIRST_NORMAL_OBSERVATION_INVALID');
});
test('settings ever-used flag cannot be forgotten; legitimate zero XP stays ready', () => {
  const before = objects(); const after = next(before);
  after.state.settings.filePreviouslyUsed = false;
  assert.equal(validate(encoded(after), { ...CONTEXT, now: '2026-10-16T02:00:00Z' }, encoded(before)).code, 'SETTINGS_HISTORY_LOST');
  assert.equal(validate(inputs('valid/ready-empty'), CONTEXT).code, 'ACCEPT');
});
test('guard internals reject reductions, missing history and rollback independently', () => {
  const before = objects();
  for (const [mutate, code] of [
    [b => { b.state.recordRevision = 0; }, 'REVISION_ROLLBACK'],
    [b => { b.ledger.coverage = []; }, 'COVERAGE_HISTORY_LOST'],
    [b => { b.ledger.days[0].byRepository[0].familyUnits.knowledge = 0; }, 'SETTLEMENT_EVIDENCE_LOST'],
    [b => { b.state.growth.totalXp = '30'; }, 'XP_ROLLBACK'],
    [b => { b.state.growth.phase = 'pending'; }, 'READY_STATE_REQUIRED'],
  ]) {
    const after = next(before); mutate(after);
    assert.throws(() => checkTransition(before, after, { ...CONTEXT, now: '2026-10-16T02:00:00Z' }), { code });
  }
});
