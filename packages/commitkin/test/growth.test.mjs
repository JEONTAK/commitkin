import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { settleQualifiedActivities, compareOriginalActivities } from '../src/domain/growth/settlement.mjs';
import { xpForLevel, levelForXp, levelProgress, appearanceForLevel } from '../src/domain/growth/levels.mjs';

function hash(value) { return 'v1:sha256:' + createHash('sha256').update(String(value)).digest('hex'); }
function activity(kind, id, hour = '09', date = '2026-10-14', options = {}) {
  const repositoryId = options.repositoryId ?? '9001';
  const occurredAt = options.occurredAt ?? `${date}T${hour}:00:00Z`;
  const eventKey = hash(`${kind}/${repositoryId}/${id}`);
  const families = options.families ?? (kind === 'submitted_review' ? ['guard'] : ['published_release', 'triage_day'].includes(kind) ? ['operations'] : ['craft']);
  const fact = { eventKey, kind, repositoryId, occurredAt, families };
  if (kind === 'merged_pr') Object.assign(fact, { prKey: hash('pr/' + id), bugEvidenced: false });
  if (kind === 'submitted_review') Object.assign(fact, { prKey: hash('pr/' + (options.prId ?? id)), reviewedCommitKey: hash('reviewed/' + (options.prId ?? id) + '/' + (options.commit ?? id)) });
  if (kind === 'published_release') fact.releaseKey = hash('release/' + id);
  if (kind === 'direct_contribution') fact.contributionKey = hash('direct/' + id);
  if (kind === 'triage_day') fact.issueKeys = ['51', '52', '53'].map(hash);
  return { fact, sourceId: { type: options.sourceType ?? 'numeric', value: String(id) } };
}
const pr = (id, hour, options) => activity('merged_pr', id, hour, '2026-10-14', options);
const review = (id, hour, options) => activity('submitted_review', id, hour, '2026-10-14', options);
const release = (id, hour) => activity('published_release', id, hour);
function capActivities() {
  return [pr('17', '09'), pr('18', '10'), review('21', '11'), release('41', '12'), pr('19', '13'), review('22', '14'), review('23', '15'), activity('triage_day', '99', '16')];
}
function previousOf(result) { return { facts: structuredClone(result.facts), days: structuredClone(result.days), totalXp: result.totalXp }; }
function settle(activities, options = {}) {
  const result = settleQualifiedActivities({ activities, ...options });
  assert.equal(result.decision, 'settled', result.code);
  return result;
}

for (const [name, values, expected] of [
  ['empty', [], 0],
  ['one merged PR', [pr('17', '09')], 40],
  ['direct source contribution', [activity('direct_contribution', '90', '09')], 20],
  ['first other-PR review', [review('21', '11')], 25],
  ['first release', [release('41', '12')], 35],
  ['valid triage', [activity('triage_day', '99', '16')], 20],
  ['merged PR plus review', [pr('17', '09'), review('21', '11')], 55],
  ['mixed code/docs/test PR', [pr('17', '09', { families: ['craft', 'knowledge', 'verification'] })], 40],
]) test(`approved base XP: ${name}`, () => {
  const result = settle(values);
  assert.equal(result.totalXp, String(expected));
  assert.equal(result.deltaXp, String(expected));
  assert.equal(result.progressionAuthorized, false);
  assert.equal(result.qualificationVerified, false);
  assert.equal(result.sourceAuthenticity, 'not_checked');
});

test('independent 160 -> 100 oracle pays common bonuses first and partial release', () => {
  const inputs = capActivities();
  const result = settle(inputs);
  assert.deepEqual(result.days[0].xp, { validDay: 10, authoredContributionDay: 10, mergedPrs: 40, reviews: 15, releases: 15, triage: 10, total: 100 });
  assert.deepEqual(result.days[0].creditedKeys, { mergedPrs: [inputs[0].fact.prKey, inputs[1].fact.prKey], reviews: [inputs[2].fact.prKey], releases: [inputs[3].fact.releaseKey] });
  assert.deepEqual(result.allocations[0].items.map(item => item.paid), [20, 20, 15, 15, 0, 0, 0]);
  assert.equal(result.facts.length, 8);
});

test('earliest item limits precede common-cap allocation and retain unpaid facts', () => {
  const inputs = [pr('5', '13'), pr('2', '10'), pr('4', '12'), pr('3', '11'), pr('1', '09')];
  const result = settle(inputs);
  assert.equal(result.totalXp, '80');
  assert.deepEqual(result.days[0].creditedKeys.mergedPrs, [hash('pr/1'), hash('pr/2'), hash('pr/3')]);
  assert.equal(result.allocations[0].items.filter(item => item.selected).length, 3);
  assert.equal(result.facts.length, 5);
});

test('first reviews on five PRs pay at most three, but preserve five eligible facts', () => {
  const result = settle(['1', '2', '3', '4', '5'].map(id => review(id, '09')));
  assert.equal(result.totalXp, '55');
  assert.equal(result.days[0].creditedKeys.reviews.length, 3);
  assert.equal(result.facts.length, 5);
});

test('no blanket kind priority: earlier release consumes capacity before later PRs', () => {
  const inputs = [release('41', '08'), pr('17', '09'), pr('18', '10'), pr('19', '11'), review('21', '12')];
  const result = settle(inputs);
  assert.deepEqual(result.days[0].xp, { validDay: 10, authoredContributionDay: 10, mergedPrs: 55, reviews: 0, releases: 25, triage: 0, total: 100 });
  assert.deepEqual(result.allocations[0].items.map(item => item.paid), [25, 20, 20, 15, 0]);
});

test('late evidence reallocation 95 -> 100 grants only +5', () => {
  const inputs95 = [pr('17', '09'), pr('18', '10'), pr('19', '13'), review('21', '11')];
  const settled95 = settle(inputs95);
  assert.equal(settled95.totalXp, '95');
  const after = settle([release('40', '08')], { previous: previousOf(settled95), priorActivities: inputs95 });
  assert.equal(after.totalXp, '100'); assert.equal(after.deltaXp, '5');
  assert.equal(after.facts.length, inputs95.length + 1);
});

test('already capped 100 -> 100 redistributes keys without payment and retains displaced facts', () => {
  const inputs = capActivities(); const before = settle(inputs);
  const after = settle([release('40', '08')], { previous: previousOf(before), priorActivities: inputs });
  assert.equal(after.totalXp, '100'); assert.equal(after.deltaXp, '0');
  assert.deepEqual(after.days[0].creditedKeys.releases, [hash('release/40')]);
  assert.equal(after.facts.length, 9);
  assert.ok(after.facts.some(fact => fact.releaseKey === hash('release/41')));
  assert.deepEqual(after.days[0].xp, { validDay: 10, authoredContributionDay: 10, mergedPrs: 40, reviews: 5, releases: 25, triage: 10, total: 100 });
});

test('replay and arbitrary input permutations do not change allocations or add XP', () => {
  const inputs = capActivities(); const baseline = settle(inputs);
  assert.deepEqual(settle([...inputs].reverse()), baseline);
  assert.deepEqual(settle([...inputs.slice(3), ...inputs.slice(0, 3)]), baseline);
  const replay = settle(inputs, { previous: previousOf(baseline) });
  assert.equal(replay.deltaXp, '0');
  assert.deepEqual(replay.facts, baseline.facts); assert.deepEqual(replay.days, baseline.days);
});

test('same original event is idempotent even with duplicate captures', () => {
  const input = pr('17', '09');
  assert.deepEqual(settle([input, structuredClone(input)]), settle([input]));
});

test('unpaid initial review is lifetime history, not another first-review bonus', () => {
  const inputs = capActivities(); const before = settle(inputs);
  const unpaid = inputs.find(item => item.fact.kind === 'submitted_review' && item.sourceId.value === '22');
  assert.ok(!before.days[0].creditedKeys.reviews.includes(unpaid.fact.prKey));
  const later = activity('submitted_review', '100', '09', '2026-10-15', { prId: '22', commit: 'new' });
  const after = settle([later], { previous: previousOf(before) });
  assert.equal(after.deltaXp, '10');
  assert.equal(after.days[1].xp.reviews, 0);
  assert.equal(after.facts.length, 9);
});

test('repeated same PR/commit adds no day; different reviewed commit adds valid day only', () => {
  const first = review('21', '09', { prId: '31', commit: 'a' });
  const before = settle([first]);
  const repeat = activity('submitted_review', '22', '09', '2026-10-15', { prId: '31', commit: 'a' });
  const repeated = settle([repeat], { previous: previousOf(before) });
  assert.equal(repeated.deltaXp, '0'); assert.equal(repeated.days.length, 1);
  const newCommit = activity('submitted_review', '23', '09', '2026-10-15', { prId: '31', commit: 'b' });
  const changed = settle([newCommit], { previous: previousOf(before) });
  assert.equal(changed.deltaXp, '10'); assert.equal(changed.days[1].xp.reviews, 0);
});

test('pre-growth review history suppresses first-review reward without old-day growth or raw history persistence', () => {
  const historical = activity('submitted_review', '1', '09', '2026-01-01', { prId: '31', commit: 'a' });
  const newCommit = review('21', '09', { prId: '31', commit: 'b' });
  const result = settle([newCommit], { reviewHistoryFacts: [historical.fact] });
  assert.equal(result.totalXp, '10'); assert.equal(result.days.length, 1);
  assert.equal(result.days[0].date, '2026-10-14'); assert.equal(result.facts.length, 1);
  assert.equal(result.days[0].xp.reviews, 0);
  const repeat = review('22', '09', { prId: '31', commit: 'a' });
  const repeated = settle([repeat], { reviewHistoryFacts: [historical.fact] });
  assert.equal(repeated.totalXp, '0'); assert.equal(repeated.days.length, 0);
});

test('multiple same-day review commits still receive one PR reward', () => {
  const result = settle([review('21', '09', { prId: '31', commit: 'a' }), review('22', '10', { prId: '31', commit: 'b' })]);
  assert.equal(result.totalXp, '25'); assert.equal(result.days[0].creditedKeys.reviews.length, 1);
});

test('review event original scalar ID determines per-kind cap, not reviewed-commit hash', () => {
  const inputs = ['100', '9', '10', '2'].map(id => review(id, '09'));
  const result = settle(inputs);
  assert.deepEqual(result.days[0].creditedKeys.reviews, ['2', '9', '10'].map(id => hash('pr/' + id)));
});

test('numeric ordering is integer/lossless; numeric IDs precede opaque IDs at a tied timestamp', () => {
  const values = [pr('9007199254740993', '09'), pr('9007199254740992', '09'), pr('100', '09'), pr('000', '09', { sourceType: 'opaque' })];
  assert.deepEqual([...values].sort(compareOriginalActivities).map(item => item.sourceId.value), ['100', '9007199254740992', '9007199254740993', '000']);
});

test('opaque ordering uses exact UTF-8 byte order, never locale/case-folding', () => {
  const values = ['é', 'z', 'a', 'Z', 'α'].map(id => pr(id, '09', { sourceType: 'opaque' }));
  assert.deepEqual(values.sort(compareOriginalActivities).map(item => item.sourceId.value), ['Z', 'a', 'z', 'é', 'α']);
});

test('kind and numeric repository resolve remaining original-ID/time ties', () => {
  const values = [release('2', '09'), review('2', '09'), pr('2', '09', { repositoryId: '10' }), pr('2', '09', { repositoryId: '2' })];
  assert.deepEqual(values.sort(compareOriginalActivities).map(item => [item.fact.kind, item.fact.repositoryId]), [['merged_pr', '2'], ['merged_pr', '10'], ['submitted_review', '9001'], ['published_release', '9001']]);
});

test('sub-millisecond source timestamps preserve original order', () => {
  const a = pr('9', '09', { occurredAt: '2026-10-14T09:00:00.000001Z' });
  const b = pr('1', '09', { occurredAt: '2026-10-14T09:00:00.000002Z' });
  assert.ok(compareOriginalActivities(a, b) < 0);
});

test('untouched old public settlement requires no original-ID cache', () => {
  const oldActivity = activity('direct_contribution', '90', '09', '2026-07-01');
  const before = settle([oldActivity]);
  const after = settle([pr('17', '09')], { previous: previousOf(before) });
  assert.equal(after.totalXp, '60'); assert.equal(after.deltaXp, '40');
  assert.deepEqual(after.days[0], before.days[0]);
  assert.deepEqual(after.facts[0], before.facts[0]);
});

test('affected settled date requires every retained fact original-ID context', () => {
  const before = settle([pr('17', '09')]);
  const result = settleQualifiedActivities({ activities: [release('41', '12')], previous: previousOf(before) });
  assert.deepEqual({ decision: result.decision, code: result.code, preservePrevious: result.preservePrevious, candidate: result.candidate }, { decision: 'hold', code: 'MISSING_PRIOR_ORDERING_EVIDENCE', preservePrevious: true, candidate: null });
});

test('earlier review crossing a settled first-review date holds rather than chargebacks', () => {
  const first = activity('submitted_review', '21', '09', '2026-10-14', { prId: '31', commit: 'b' });
  const before = settle([first]);
  const earlier = activity('submitted_review', '20', '09', '2026-10-13', { prId: '31', commit: 'a' });
  const result = settleQualifiedActivities({ activities: [earlier], previous: previousOf(before) });
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'PRIOR_FIRST_REVIEW_CONFLICT');
});

test('settled-day reduction is held, never negative-delta clamped and saved', () => {
  const before = settle([pr('17', '09')]);
  const inconsistent = previousOf(before);
  inconsistent.days[0].xp.mergedPrs = 60; inconsistent.days[0].xp.total = 80; inconsistent.totalXp = '80';
  const result = settleQualifiedActivities({ activities: [release('41', '12')], previous: inconsistent, priorActivities: [pr('17', '09')] });
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'SETTLED_DAY_REDUCTION');
});

test('retained source time/qualification facts cannot be overwritten', () => {
  const input = pr('17', '09'); const before = settle([input]); const changed = structuredClone(input);
  changed.fact.occurredAt = '2026-10-14T10:00:00Z';
  const result = settleQualifiedActivities({ activities: [changed], previous: previousOf(before) });
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'CONFLICTING_RETAINED_FACT');
});

test('source identities cannot be recreated with a different event hash', () => {
  const first = pr('17', '09'); const spoof = structuredClone(first); spoof.fact.eventKey = hash('spoof');
  const result = settleQualifiedActivities({ activities: [first, spoof] });
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'SOURCE_IDENTITY_CONFLICT');
});

test('no external eligible flag or firstReview flag is a qualification shortcut', () => {
  for (const key of ['eligible', 'firstReview']) {
    const input = pr('17', '09'); input[key] = true;
    const result = settleQualifiedActivities({ activities: [input] });
    assert.equal(result.decision, 'hold'); assert.equal(result.code, 'INVALID_QUALIFIED_INPUT');
  }
});

test('no input mutation, including arrays and prior snapshots', () => {
  const inputs = capActivities(); const before = settle(inputs);
  const request = { activities: [release('40', '08')], previous: previousOf(before), priorActivities: inputs };
  const original = structuredClone(request);
  function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
  settleQualifiedActivities(freeze(request));
  assert.deepEqual(request, original);
});

test('public facts and days contain no raw ordering IDs', () => {
  const result = settle(capActivities());
  assert.equal(JSON.stringify({ facts: result.facts, days: result.days }).includes('sourceId'), false);
  assert.equal(Object.hasOwn(result, 'activities'), false);
});

test('original fixed ledger fixtures independently match capped and late-delta projections', () => {
  const root = new URL('../../../test/fixtures/records/v1/', import.meta.url);
  const policy = JSON.parse(readFileSync(new URL('policy-cases.json', root), 'utf8'));
  const identities = new Map(policy.hashConstruction.identityInputs.map(item => [item.expectedHash, item.input]));
  const load = name => JSON.parse(readFileSync(new URL(`valid/${name}/ledger.json`, root), 'utf8'));
  const context = ledger => ledger.facts.map(fact => ({ fact, sourceId: { type: fact.kind === 'triage_day' ? 'opaque' : 'numeric', value: identities.get(fact.eventKey).sourceId } }));
  const capped = load('ready-100xp-capped');
  const computed = settle(context(capped));
  const { scopeId, ...expectedDay } = capped.days[0];
  assert.deepEqual(computed.days[0], expectedDay);
  assert.deepEqual(new Map(computed.facts.map(fact => [fact.eventKey, fact])), new Map(capped.facts.map(fact => [fact.eventKey, fact])));
  for (const [beforeName, afterName, delta] of [
    ['ready-95xp-before-late-release', 'ready-100xp-after-late-release', '5'],
    ['ready-100xp-capped', 'ready-100xp-reallocated', '0'],
  ]) {
    const before = load(beforeName); const after = load(afterName);
    const oldKeys = new Set(before.facts.map(fact => fact.eventKey));
    const incoming = context(after).filter(item => !oldKeys.has(item.fact.eventKey));
    const previous = { facts: before.facts, days: before.days, totalXp: String(before.days.reduce((sum, day) => sum + day.xp.total, 0)) };
    const actual = settle(incoming, { previous, priorActivities: context(before) });
    const { scopeId: ignored, ...expected } = after.days[0];
    assert.equal(actual.deltaXp, delta);
    assert.deepEqual(actual.days[0], expected);
    assert.deepEqual(new Map(actual.facts.map(fact => [fact.eventKey, fact])), new Map(after.facts.map(fact => [fact.eventKey, fact])));
  }
});

for (const [level, expected] of [[1, '0'], [2, '100'], [5, '550'], [10, '1800'], [20, '6175'], [35, '17425'], [50, '34300']]) test(`approved level ${level} threshold ${expected}`, () => {
  assert.equal(xpForLevel(level), expected); assert.equal(levelForXp(expected), String(level));
  if (level > 1) assert.equal(levelForXp((BigInt(expected) - 1n).toString()), String(level - 1));
});

test('90 capped completed dates give 9000 XP and level24', () => { assert.equal(levelForXp('9000'), '24'); });
test('uncapped BigInt-safe numerical levels and actual next-level progress', () => {
  const level = '9007199254740993'; const threshold = xpForLevel(level);
  assert.equal(levelForXp(threshold), level);
  const progress = levelProgress((BigInt(threshold) + 25n).toString());
  assert.equal(progress.level, level); assert.equal(progress.xpIntoLevel, '25');
  assert.equal(BigInt(progress.xpForNextLevel), 100n + 25n * (BigInt(level) - 1n));
  assert.equal(BigInt(progress.xpIntoLevel) + BigInt(progress.xpRemaining), BigInt(progress.xpForNextLevel));
});
test('regular stages: Lv1 base, upgrades5..50 and post50 final reuse', () => {
  for (let level = 1; level <= 100; level += 1) {
    const appearance = appearanceForLevel({ classId: 'blacksmith', level });
    assert.equal(appearance.stageIndex, Math.min(10, Math.floor(level / 5)));
    assert.equal(appearance.unlockedAt, level < 5 ? 1 : Math.min(50, Math.floor(level / 5) * 5));
    assert.equal(appearance.nextAppearanceAt, level >= 50 ? null : Math.floor(level / 5) * 5 + 5);
  }
});
test('Adventurer is fixed through all numerical growth, not eleven stages', () => {
  assert.deepEqual(appearanceForLevel({ classId: 'adventurer', level: 1 }), appearanceForLevel({ classId: 'adventurer', level: '9007199254740993' }));
  assert.equal(appearanceForLevel({ classId: 'adventurer', level: 50 }).nextAppearanceAt, null);
});
test('all24 regular classes and two fixed starters preserve530 variant plan', () => {
  const classes = ['blacksmith', 'machinist', 'runesmith', 'golemancer', 'warden', 'shield-knight', 'paladin', 'wardkeeper', 'scribe', 'librarian', 'chronicler', 'lorekeeper', 'sentinel', 'wardweaver', 'rune-examiner', 'sealbinder', 'healer', 'alchemist', 'purifier', 'restorer', 'herald', 'quartermaster', 'guild-steward', 'guild-commander'];
  assert.equal(classes.length * 2 * 11 + 2, 530);
  for (const classId of classes) assert.equal(appearanceForLevel({ classId, level: 73 }).unlockedAt, 50);
});
test('invalid/unsafe numeric inputs and unknown classes fail explicitly', () => {
  for (const invalid of ['-1', '01', '1e3', '1.5', Number.MAX_SAFE_INTEGER + 1, null]) assert.throws(() => levelForXp(invalid), /INVALID_GROWTH_INTEGER/);
  assert.throws(() => xpForLevel(0), /INVALID_GROWTH_INTEGER/);
  assert.throws(() => appearanceForLevel({ classId: 'invented', level: 5 }), /INVALID_CLASS_ID/);
});
