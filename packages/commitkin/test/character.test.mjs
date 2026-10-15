import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCharacter, classifyActivity, selectTraits, achievementMeasures, awardAchievements, selectAchievementBadges, CLASS_ROWS } from '../src/domain/character/index.mjs';
import { transitionClass } from '../src/domain/character/classification.mjs';
import { transitionTrait } from '../src/domain/character/traits.mjs';
import { activityFacts, compareTimestamps, dateFromNumber, dateNumber, shiftDate, unitsFromFacts } from '../src/domain/character/activity.mjs';

const D = '2026-10-15';
const AT = D + 'T01:00:00Z';
const SCOPE = 'v1:sha256:' + 'a'.repeat(64);
const OTHER_SCOPE = 'v1:sha256:' + 'b'.repeat(64);
let serial = 0;
function hash(value) { return 'v1:sha256:' + value.toString(16).padStart(64, '0'); }
function fact({ kind = 'direct_contribution', family = 'craft', families = [family], repositoryId = '1', date = '2026-10-14', time = '12:00:00', prKey, reviewedCommitKey, bugEvidenced = false } = {}) {
  serial += 1;
  const result = { eventKey: hash(serial), kind, repositoryId, occurredAt: date + 'T' + time + 'Z', families };
  if (kind === 'direct_contribution') result.contributionKey = hash(10000 + serial);
  if (kind === 'merged_pr') { result.prKey = prKey ?? hash(20000 + serial); result.bugEvidenced = bugEvidenced; }
  if (kind === 'submitted_review') { result.prKey = prKey ?? hash(30000 + serial); result.reviewedCommitKey = reviewedCommitKey ?? hash(40000 + serial); }
  if (kind === 'published_release') result.releaseKey = hash(50000 + serial);
  if (kind === 'triage_day') result.issueKeys = [hash(60000 + serial * 3), hash(60001 + serial * 3), hash(60002 + serial * 3)];
  return result;
}
function sequence(count, options = {}) { return Array.from({ length: count }, (_, index) => fact({ date: shiftDate(D, -index - 1), ...options })); }
function repositories(ids = ['1'], ownership = 'self') { return ids.map(id => ({ id, ownershipAtFirstObservation: ownership })); }
function classify(facts, repos = repositories()) { return classifyActivity({ facts, repositories: repos, evaluationDate: D }); }
function classState(id = 'blacksmith', lastChangedOn = '2026-10-01', pending = null) { return { id, lastChangedOn, pending, history: id === 'adventurer' ? [] : [{ classId: id, assignedAt: lastChangedOn + 'T00:00:00Z' }] }; }
function selection(id = 'machinist', scores = {}) { return { candidateId: id, scores: { craft: 80, guard: 0, knowledge: 0, verification: 0, recovery: 0, operations: 0, ...scores } }; }
function pending(targetId = 'machinist', count = 6, lastCountedOn = '2026-10-14', contextScopeId = SCOPE) { return { targetId, count, startedOn: '2026-10-09', lastCountedOn, contextScopeId }; }
function change(overrides = {}) { return transitionClass({ previousClass: classState('blacksmith', '2026-10-01', pending()), selection: selection(), evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE, clock: '2026-10-14', previousNormalDate: '2026-10-14', initialAssignmentVerified: false, ...overrides }); }
function traitChange(overrides = {}) { return transitionTrait({ previousSlot: { currentId: 'steadfast', pending: { targetId: 'focused', count: 2, startedOn: '2026-10-13', lastCountedOn: '2026-10-14' } }, targetId: 'focused', evaluationDate: D, clock: '2026-10-14', previousNormalDate: '2026-10-14', initialAssignmentVerified: false, ...overrides }); }
function traitCandidates(facts, overrides = {}) { return selectTraits({ facts, classId: 'adventurer', coverage: [{ startDate: '2026-07-01', endDateExclusive: D, scopeId: SCOPE, complete: true }], scopeId: SCOPE, evaluationDate: D, ...overrides }); }
function measures(facts, overrides = {}) { return achievementMeasures({ facts, classHistory: [], startDate: '2026-07-01', evaluationDate: D, ...overrides }); }
function previous() {
  return { faction: { id: 'bloomguard' }, growth: { phase: 'ready', startDate: '2026-07-17', totalXp: '0' },
    class: classState('adventurer', null), traits: { habit: { currentId: null, pending: null }, activity: { currentId: null, pending: null } },
    observationClock: { lastNormalEvaluationOn: null, classLastCountedOn: null, habitLastCountedOn: null, activityLastCountedOn: null }, achievements: [] };
}
function ledger(facts = []) {
  return { repositories: repositories(), scopes: [{ id: SCOPE, repositoryIds: ['1'] }], coverage: [{ startDate: '2026-07-17', endDateExclusive: D, scopeId: SCOPE, complete: true }], facts, days: [{ date: '2026-10-14', xp: { total: 40 } }] };
}

test('all 24 regular class mappings match the approved family/ownership/distribution table', () => {
  for (const [family, classes] of Object.entries(CLASS_ROWS)) {
    for (let index = 0; index < 4; index += 1) {
      const distributed = index % 2 === 1;
      const owner = index >= 2 ? 'other' : 'self';
      const ids = distributed ? ['1', '2'] : ['1'];
      const facts = ids.flatMap(repositoryId => sequence(6, { family, repositoryId, kind: family === 'guard' ? 'submitted_review' : 'direct_contribution' }));
      assert.equal(classify(facts, repositories(ids, owner)).candidateId, classes[index]);
    }
  }
});
test('class-only two-date repository filter precedes raw minima and scoring', () => {
  const facts = Array.from({ length: 20 }, (_, index) => fact({ repositoryId: String(index + 1) }));
  assert.equal(classify(facts, repositories(facts.map(item => item.repositoryId))).candidateId, null);
});
test('family minimum dates and recent dates apply before class assignment', () => {
  assert.equal(classify(sequence(5)).candidateId, null);
  assert.equal(classify(sequence(6)).candidateId, 'blacksmith');
  assert.equal(classify(sequence(6, { date: '2026-08-01' })).candidateId, null);
  const old = sequence(5).map((item, index) => ({ ...item, occurredAt: shiftDate(D, -31 - index) + 'T12:00:00Z' }));
  assert.equal(classify([...old, fact()]).candidateId, null);
});
test('age weights include exact 30/60/90 day boundaries and exclude day91/current date', () => {
  const facts = [1, 2, 3, 30, 31, 60, 61, 90, 91, 0].map(age => fact({ date: shiftDate(D, -age) }));
  const result = classify(facts);
  // A = 4*1 + 2*.6 + 2*.3 = 5.8; total share=1, normalizer20.
  assert.ok(Math.abs(result.scores.craft - (70 + 30 * 5.8 / 20)) < 1e-9);
});
test('equal eligible family scores never receive a roster-order tie win', () => {
  const facts = [...sequence(20), ...sequence(20, { family: 'guard', kind: 'submitted_review' })];
  assert.equal(classify(facts).candidateId, null);
});
test('latest submitted review per PR is used for class units, not every reviewed day', () => {
  const facts = sequence(8, { family: 'guard', kind: 'submitted_review', prKey: hash(777) });
  assert.equal(classify(facts).candidateId, null);
  assert.equal(classify(sequence(4, { family: 'guard', kind: 'submitted_review' })).candidateId, 'warden');
});
test('ownership mixed interval and conditional focused/distributed ratios are respected', () => {
  const equal = [...sequence(6), ...sequence(6, { repositoryId: '2' })];
  assert.equal(classify(equal, [...repositories(), ...repositories(['2'], 'other')]).reason, 'mixed-ownership');
  const sixty = [...sequence(9), ...sequence(6, { repositoryId: '2' })];
  assert.equal(classify(sixty, [...repositories(), ...repositories(['2'], 'other')]).candidateId, 'blacksmith');
  assert.equal(classify(sixty, repositories(['1', '2'])).reason, 'unclear-distribution');
});
test('first regular assignment requires separately verified provenance', () => {
  const input = { previousClass: classState('adventurer', null), selection: selection('blacksmith') };
  assert.equal(change(input).value.id, 'adventurer');
  const assigned = change({ ...input, initialAssignmentVerified: true }).value;
  assert.equal(assigned.id, 'blacksmith');
  assert.equal(assigned.history.length, 1);
  assert.equal(change({ ...input, initialAssignmentVerified: true }).countedOn, D);
});
test('seventh class observation changes at14day cooldown, not13', () => {
  const early = change({ previousClass: classState('blacksmith', '2026-10-02', pending()) }).value;
  assert.equal(early.id, 'blacksmith');
  assert.equal(early.pending.count, 7);
  assert.equal(change().value.id, 'machinist');
});
test('saturated class observation retains startedOn until eligible change', () => {
  const result = change({ previousClass: classState('blacksmith', '2026-10-10', pending('machinist', 7)) }).value;
  assert.equal(result.pending.count, 7);
  assert.equal(result.pending.startedOn, '2026-10-09');
  assert.equal(result.pending.lastCountedOn, D);
});
test('cross-family candidate needs12point current-family lead, same-family doesnot', () => {
  const cross = classState('blacksmith', '2026-10-01', pending('paladin'));
  assert.equal(change({ previousClass: cross, selection: selection('paladin', { craft: 50, guard: 61.99 }) }).value.pending, null);
  assert.equal(change({ previousClass: cross, selection: selection('paladin', { craft: 50, guard: 62 }) }).value.id, 'paladin');
  assert.equal(change({ selection: selection('machinist', { craft: 45 }) }).value.id, 'machinist');
});
test('gap2continues, gap3resets; ambiguity doesnot demote existing class', () => {
  assert.equal(change({ previousNormalDate: '2026-10-13' }).value.id, 'machinist');
  const afterGap = change({ previousNormalDate: '2026-10-12' }).value;
  assert.equal(afterGap.id, 'blacksmith');
  assert.equal(afterGap.pending.count, 1);
  assert.equal(change({ selection: selection(null) }).value.pending, null);
});
test('same-date candidate/scope changes clear pending without another count', () => {
  const result = change({ evaluationDate: '2026-10-14', previousNormalDate: '2026-10-14', scopeId: OTHER_SCOPE });
  assert.equal(result.value.pending, null);
  assert.equal(result.countedOn, '2026-10-14');
  const next = change({ previousClass: classState('blacksmith', '2026-10-01', pending('paladin')), selection: selection('machinist'), evaluationDate: '2026-10-14' });
  assert.equal(next.value.pending, null);
  assert.equal(change({ previousClass: classState('blacksmith', '2026-10-01', pending('machinist', 7, D)), clock: D, previousNormalDate: D }).value.id, 'blacksmith');
});
test('new same-day candidate cannot use a previously null counterclock', () => {
  assert.equal(change({ previousClass: classState('blacksmith', '2026-10-01'), clock: null, previousNormalDate: D }).value.pending, null);
  assert.equal(traitChange({ previousSlot: { currentId: null, pending: null }, clock: null, previousNormalDate: D }).value.pending, null);
});
test('third trait observation applies change/removal and clears pending', () => {
  assert.deepEqual(traitChange().value, { currentId: 'focused', pending: null });
  assert.deepEqual(traitChange({ previousSlot: { currentId: 'steadfast', pending: { targetId: null, count: 2, startedOn: '2026-10-13', lastCountedOn: '2026-10-14' } }, targetId: null }).value, { currentId: null, pending: null });
});
test('empty used trait slot waits3observations while initialverified slot assigns now', () => {
  const slot = { currentId: null, pending: null };
  assert.equal(traitChange({ previousSlot: slot }).value.pending.count, 1);
  assert.deepEqual(traitChange({ previousSlot: slot, initialAssignmentVerified: true, previousNormalDate: null }).value, { currentId: 'focused', pending: null });
  assert.equal(traitChange({ previousSlot: slot, initialAssignmentVerified: true, previousNormalDate: null }).countedOn, D);
  assert.equal(traitChange({ previousSlot: slot, initialAssignmentVerified: true }).value.pending.count, 1);
});
test('trait gap3resets but scope change alone is not a trait reset', () => {
  assert.equal(traitChange({ previousNormalDate: '2026-10-12' }).value.pending.count, 1);
  assert.equal(traitChange({ previousNormalDate: '2026-10-13' }).value.currentId, 'focused');
});
test('habit selection uses raw30day units and approved priority', () => {
  assert.equal(traitCandidates(sequence(12)).habit, 'focused');
  const diverse = sequence(5, { families: ['craft', 'knowledge', 'verification'] });
  assert.equal(traitCandidates(diverse).habit, 'versatile');
  const roaming = ['1', '2', '3'].flatMap(repositoryId => sequence(5, { repositoryId }));
  assert.equal(traitCandidates(roaming).habit, 'roaming');
  const scattered = sequence(12).map((item, index) => ({ ...item, repositoryId: String(index) }));
  assert.equal(traitCandidates(scattered).habit, 'steadfast');
});
test('one-date repositories do not dilute Focused or count toward Roaming ratios', () => {
  const primary = sequence(8);
  const once = Array.from({ length: 20 }, (_, index) => fact({ repositoryId: String(index + 2) }));
  assert.equal(traitCandidates([...primary, ...once]).habit, 'focused');
});
test('class family preference outranks latest activity; operations prefersShipping', () => {
  const docs = sequence(5, { family: 'knowledge', date: undefined }).map((item, index) => ({ ...item, occurredAt: shiftDate(D, -index - 4) + 'T12:00:00Z' }));
  const merged = sequence(5, { kind: 'merged_pr' });
  assert.equal(traitCandidates([...docs, ...merged], { classId: 'scribe' }).activity, 'documenting');
  assert.equal(traitCandidates([...docs, ...merged]).activity, 'finisher');
  const shipping = [fact({ kind: 'published_release', family: 'operations', date: '2026-10-01' }), fact({ kind: 'published_release', family: 'operations', date: '2026-10-02' })];
  const organizing = sequence(3, { kind: 'triage_day', family: 'operations' });
  assert.equal(traitCandidates([...shipping, ...organizing], { classId: 'herald' }).activity, 'shipping');
});
test('activity traits obey distinctPR/date/release/triage thresholds and tie priority', () => {
  assert.equal(traitCandidates(sequence(5, { kind: 'submitted_review', family: 'guard' })).activity, 'collaborative');
  assert.equal(traitCandidates(sequence(5, { kind: 'submitted_review', family: 'guard', prKey: hash(777) })).activity, null);
  assert.equal(traitCandidates(sequence(5, { family: 'verification' })).activity, 'testing');
  assert.equal(traitCandidates(sequence(3, { kind: 'merged_pr', family: 'recovery', bugEvidenced: true })).activity, 'mending');
  assert.equal(traitCandidates(sequence(5, { families: ['knowledge', 'verification'] })).activity, 'documenting');
});
test('Rekindled requires14strictlybetween observed inactive dates and secondreturnwithin7', () => {
  const facts = ['2026-09-20', '2026-10-05', '2026-10-11'].map(date => fact({ date }));
  assert.equal(traitCandidates(facts).habit, 'rekindled');
  assert.equal(traitCandidates(facts, { coverage: [] }).habit, null);
  assert.equal(traitCandidates([fact({ date: '2026-09-21' }), ...facts.slice(1)]).habit, null);
  assert.equal(traitCandidates([facts[0], facts[1], fact({ date: '2026-10-12' })]).habit, null);
  assert.equal(traitCandidates(facts, { evaluationDate: '2026-10-19' }).habit, null);
});
test('repeated review of same reviewedcommit cannot create extra rawdate or achievementPR', () => {
  const facts = sequence(5, { kind: 'submitted_review', family: 'guard', prKey: hash(888), reviewedCommitKey: hash(999) });
  const normalized = activityFacts(facts, D);
  assert.equal(normalized.length, 1);
  assert.equal(measures(normalized).footprints, 1);
  assert.equal(measures(normalized)['allys-shield'], 1);
});
test('all achievement measure families preserve separate rawunits and identities', () => {
  const facts = [fact({ kind: 'merged_pr', families: ['knowledge', 'verification', 'recovery'], bugEvidenced: true }), fact({ kind: 'submitted_review', family: 'guard' }), fact({ kind: 'published_release', family: 'operations' }), fact({ kind: 'triage_day', family: 'operations' })];
  const result = measures(facts, { classHistory: [{ classId: 'blacksmith' }, { classId: 'blacksmith' }, { classId: 'scribe' }] });
  assert.equal(result.footprints, 1);
  for (const id of ['completed-works', 'allys-shield', 'knowledge-vault', 'raised-wards', 'healing-hands', 'launch-bell', 'orderly-guild']) assert.equal(result[id], 1, id);
  assert.equal(result['class-codex'], 2);
});
test('weekly achievements exclude partialfirst/currentweek and use completedMondaySunday', () => {
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-07', '2026-09-08', '2026-09-09', '2026-10-12', '2026-10-13', '2026-10-14'];
  const facts = dates.map(date => fact({ date }));
  const result = measures(facts, { startDate: '2026-09-01' });
  assert.equal(result['enduring-flame'], 1);
  assert.equal(result['old-hearth'], 1);
});
test('OldHearth counts maximumcompletedweeks inone repository, notsum', () => {
  const facts = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'].map((date, index) => fact({ date, repositoryId: index < 2 ? '1' : '2' }));
  assert.equal(measures(facts)['old-hearth'], 2);
  assert.equal(measures(facts)['far-horizons'], 2);
});
test('award allcrossedgrades, preserveearnedtimes and tiers despite reducedcurrentmeasure', () => {
  const counts = Object.fromEntries(['footprints', 'completed-works'].map(id => [id, 100]));
  const first = awardAchievements({ previousAchievements: [], measures: counts, evaluatedAt: AT });
  assert.equal(first[0].earned.length, 3);
  const later = awardAchievements({ previousAchievements: first, measures: {}, evaluatedAt: '2026-11-01T00:00:00Z' });
  assert.deepEqual(later, first);
});
test('display badges choosehighestgrade thentime thenseries, maximum3', () => {
  const list = [
    { seriesId: 'footprints', earned: [{ grade: 'bronze', earnedAt: AT }, { grade: 'silver', earnedAt: AT }] },
    { seriesId: 'completed-works', earned: [{ grade: 'gold', earnedAt: '2026-10-01T00:00:00Z' }] },
    { seriesId: 'allys-shield', earned: [{ grade: 'gold', earnedAt: AT }] },
    { seriesId: 'knowledge-vault', earned: [{ grade: 'gold', earnedAt: AT }] },
  ];
  assert.deepEqual(selectAchievementBadges(list).map(item => item.seriesId), ['allys-shield', 'knowledge-vault', 'completed-works']);
});
test('evaluateCharacter composes immutable output and actuallevel appearance withoutassigningunverifiedclass', () => {
  const state = previous(); const record = ledger(sequence(6));
  const before = structuredClone({ state, record });
  const result = evaluateCharacter({ previousState: state, ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE });
  assert.equal(result.class.id, 'adventurer');
  assert.equal(result.level.level, '1');
  assert.equal(result.appearance.fixed, true);
  assert.deepEqual({ state, record }, before);
  const assigned = evaluateCharacter({ previousState: state, ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE, initialAssignmentVerified: true });
  assert.equal(assigned.class.id, 'blacksmith');
  assert.equal(assigned.achievements.find(item => item.seriesId === 'class-codex').earned[0].grade, 'bronze');
});
test('verified never-assigned ready Adventurer receives its first regular class while later empty trait slots still need three normal observations', () => {
  const initial = previous(); const firstDate = shiftDate(D, -14); const emptyRecord = ledger(); emptyRecord.days = []; emptyRecord.coverage[0].endDateExclusive = firstDate;
  const first = evaluateCharacter({ previousState: initial, ledger: emptyRecord, evaluationDate: firstDate, evaluatedAt: firstDate + 'T01:00:00Z', scopeId: SCOPE, initialAssignmentVerified: true });
  assert.equal(first.class.id, 'adventurer'); assert.deepEqual(first.class.history, []); assert.equal(first.observationClock.lastNormalEvaluationOn, firstDate);
  const state = { ...initial, class: first.class, traits: first.traits, observationClock: first.observationClock, achievements: first.achievements };
  const record = ledger(sequence(12, { kind: 'merged_pr' })); const before = structuredClone({ state, record });
  const held = evaluateCharacter({ previousState: state, ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE });
  assert.equal(held.class.id, 'adventurer');
  let result = evaluateCharacter({ previousState: state, ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE, initialAssignmentVerified: true });
  assert.equal(result.class.id, 'blacksmith'); assert.deepEqual(result.class.history, [{ classId: 'blacksmith', assignedAt: AT }]); assert.equal(result.class.lastChangedOn, D);
  assert.equal(result.observationClock.classLastCountedOn, D);
  for (const [slot, targetId] of [['habit', 'focused'], ['activity', 'finisher']]) {
    assert.equal(result.traits[slot].currentId, null); assert.equal(result.traits[slot].pending.targetId, targetId); assert.equal(result.traits[slot].pending.count, 1);
  }
  assert.deepEqual({ state, record }, before);
  const advanced = prior => ({ ...state, class: prior.class, traits: prior.traits, observationClock: prior.observationClock, achievements: prior.achievements });
  const sameDay = evaluateCharacter({ previousState: advanced(result), ledger: record, evaluationDate: D, evaluatedAt: D + 'T02:00:00Z', scopeId: SCOPE, initialAssignmentVerified: true });
  assert.deepEqual(sameDay.traits, result.traits); assert.deepEqual(sameDay.class.history, result.class.history);
  for (let day = 1; day <= 2; day += 1) {
    const date = shiftDate(D, day); const nextRecord = structuredClone(record); nextRecord.coverage[0].endDateExclusive = date;
    result = evaluateCharacter({ previousState: advanced(result), ledger: nextRecord, evaluationDate: date, evaluatedAt: date + 'T01:00:00Z', scopeId: SCOPE, initialAssignmentVerified: true });
    for (const [slot, targetId] of [['habit', 'focused'], ['activity', 'finisher']]) {
      if (day === 1) { assert.equal(result.traits[slot].currentId, null); assert.equal(result.traits[slot].pending.count, 2); }
      else assert.deepEqual(result.traits[slot], { currentId: targetId, pending: null });
    }
    assert.equal(result.class.history.length, 1);
  }
});
test('verified first-class provenance never bypasses regular-class cooldown or turns a later normal analysis into first-normal trait assignment', () => {
  const stillCoolingDown = change({ previousClass: classState('blacksmith', '2026-10-02', pending()), initialAssignmentVerified: true }).value;
  assert.equal(stillCoolingDown.id, 'blacksmith'); assert.equal(stillCoolingDown.pending.count, 7);
  const record = ledger(sequence(12, { kind: 'merged_pr' })); const pristine = previous();
  const genuinelyFirst = evaluateCharacter({ previousState: pristine, ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE, initialAssignmentVerified: true });
  assert.deepEqual(genuinelyFirst.traits.habit, { currentId: 'focused', pending: null }); assert.deepEqual(genuinelyFirst.traits.activity, { currentId: 'finisher', pending: null });
  pristine.observationClock.lastNormalEvaluationOn = shiftDate(D, -1);
  const later = evaluateCharacter({ previousState: pristine, ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE, initialAssignmentVerified: true });
  assert.equal(later.class.id, 'blacksmith'); assert.equal(later.traits.habit.currentId, null); assert.equal(later.traits.habit.pending.count, 1); assert.equal(later.traits.activity.currentId, null); assert.equal(later.traits.activity.pending.count, 1);
});
test('scope excludesrecentclass/traits but preservescumulativeachievements', () => {
  const record = ledger(sequence(10, { repositoryId: '2', kind: 'merged_pr', family: 'knowledge' }));
  const result = evaluateCharacter({ previousState: previous(), ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE, initialAssignmentVerified: true });
  assert.equal(result.class.id, 'adventurer');
  assert.equal(result.traits.activity.currentId, null);
  assert.equal(result.achievements.find(item => item.seriesId === 'completed-works').earned.at(-1).grade, 'silver');
});
test('incompleteknowncoverage/reverseddate/missingscopefailclosed beforeobservations', () => {
  const record = ledger(); record.coverage = [];
  const input = { previousState: previous(), ledger: record, evaluationDate: D, evaluatedAt: AT, scopeId: SCOPE };
  assert.throws(() => evaluateCharacter(input), /COVERAGE_INCOMPLETE/);
  assert.throws(() => evaluateCharacter({ ...input, ledger: ledger(), scopeId: OTHER_SCOPE }), /SCOPE_MISSING/);
  assert.throws(() => evaluateCharacter({ ...input, ledger: ledger(), evaluationDate: '2026-02-30' }), /DATE_INVALID/);
});
test('datehelpers handleUTCMondayyears and raw mixedunits collapse independently', () => {
  assert.equal(dateFromNumber(dateNumber('2024-02-29')), '2024-02-29');
  const facts = [fact({ families: ['craft', 'knowledge'] }), fact({ families: ['knowledge', 'verification'] })];
  assert.equal(unitsFromFacts(facts).length, 3);
});
test('fractional second recency is chronological, not lexical or millisecond-rounded', () => {
  assert.equal(compareTimestamps('2026-10-14T12:00:00Z', '2026-10-14T12:00:00.0000001Z'), -1);
  assert.equal(compareTimestamps('2026-10-14T12:00:00.1Z', '2026-10-14T12:00:00.10000Z'), 0);
  const badges = [{ seriesId: 'footprints', earned: [{ grade: 'gold', earnedAt: '2026-10-14T12:00:00Z' }] }, { seriesId: 'completed-works', earned: [{ grade: 'gold', earnedAt: '2026-10-14T12:00:00.0000001Z' }] }];
  assert.equal(selectAchievementBadges(badges)[0].seriesId, 'completed-works');
});
