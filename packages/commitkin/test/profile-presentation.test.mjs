import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { buildDemo, createSnapshotEvaluator } from '../src/index.mjs';
import { buildProfileModel, validateProfileModel, renderCharacterPng, renderProfileMarkdown, PROFILE_MODEL_MAX_BYTES } from '../src/presentation/profile.mjs';
import { renderCard } from '../src/presentation/card.mjs';
import { classifyActivity } from '../src/domain/character/classification.mjs';
import { activityFacts } from '../src/domain/character/activity.mjs';
import { activityIdentity } from '../src/domain/evidence/qualify.mjs';
import { ACHIEVEMENT_NAMES } from '../src/domain/character/catalog.mjs';
import { digest } from '../../record-validator/src/domain/hash.js';

const ROOT = new globalThis.URL('../../../test/fixtures/records/v1/valid/', import.meta.url);
const SHA = 'd'.repeat(40), URL = 'https://raw.githubusercontent.com/DemoHero/commitkin/' + SHA + '/.commitkin/character.png';
const fixture = (name = 'ready-40xp') => Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, JSON.parse(readFileSync(new globalThis.URL(name + '/' + role + '.json', ROOT), 'utf8'))]));
const clone = value => structuredClone(value), hash = value => createHash('sha256').update(value).digest('hex');
const fixHash = record => { record.state.integrity.ledgerHash = digest(record.ledger); return record; };
function project(record = fixture()) { const result = buildProfileModel({ ...record, username: 'DemoHero' }); assert.equal(result.decision, record.state.growth.phase === 'pending' ? 'pending' : 'ready', result.code); return result.model; }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function demo(faction = 'bloomguard') { const result = buildDemo({ faction }); const files = new Map(result.files.map(file => [file.path, file.content])); return { result, files, model: JSON.parse(files.get('.commitkin/profile.json')) }; }
function decodedPng(png) {
  const chunks = []; let position = 8;
  while (position < png.length) { const size = png.readUInt32BE(position); if (png.toString('ascii', position + 4, position + 8) === 'IDAT') chunks.push(png.subarray(position + 8, position + 8 + size)); position += size + 12; }
  return inflateSync(Buffer.concat(chunks));
}
function qualified(kind, value, when, { pr = value, commit = 'b'.repeat(40), family = kind === 'submitted_review' ? 'guard' : 'craft' } = {}) {
  const identity = (name, sourceId) => activityIdentity({ kind: name, accountId: '1001', repositoryId: '9001', sourceId });
  const sourceId = { type: kind === 'direct_contribution' ? 'opaque' : 'numeric', value }; const fact = { eventKey: identity(kind, value), kind, repositoryId: '9001', occurredAt: when, families: [family] };
  if (kind === 'direct_contribution') fact.contributionKey = identity(kind, value);
  if (kind === 'merged_pr') { fact.prKey = identity('pull_request', pr); fact.bugEvidenced = false; }
  if (kind === 'submitted_review') { fact.prKey = identity('pull_request', pr); fact.reviewedCommitKey = identity('reviewed_commit', { pullRequestId: pr, commitOid: commit }); }
  if (kind === 'published_release') { fact.families = ['operations']; fact.releaseKey = identity('release', value); }
  return { fact, sourceId };
}
function evaluated(activities) {
  const previous = fixture('ready-empty'); const result = createSnapshotEvaluator()({ previous, expectedOwner: previous.state.owner, activities, repositoryIds: ['9001'], settings: { version: 1, repositories: { additional: [], exclude: [] } }, settingsFileUsed: true, evaluationStartedAt: '2026-10-16T00:00:00Z', evaluatedAt: '2026-10-16T01:00:00Z' });
  assert.equal(result.decision, 'proposed', result.code); assert.equal(result.recordReport.code, 'ACCEPT'); return result.candidate;
}

test('ready profile is deterministic closed JSON bound to the storage identity without changing authoritative growth', () => {
  const record = fixture(); const original = clone(record); const model = project(freeze(record));
  assert.deepEqual(model.owner, { accountId: '1001', storageRepositoryId: '9001' }); assert.equal(model.growth.totalXp, '40'); assert.equal(model.growth.level, '1'); assert.equal(model.classId, 'adventurer');
  assert.equal(model.recentActivity.mergedPrs, 1); assert.equal(model.recentActivity.activeDays, 1); assert.deepEqual(model.familyScores, { craft: 0, guard: 0, knowledge: 0, verification: 0, recovery: 0, operations: 0 });
  assert.deepEqual(project(record), model); assert.deepEqual(record, original); assert.ok(Buffer.byteLength(JSON.stringify(model)) < PROFILE_MODEL_MAX_BYTES);
  const checked = validateProfileModel(freeze(model)); assert.deepEqual(checked, model); assert.notEqual(checked, model);
  for (const field of ['sourceId', 'eventKey', 'facts', 'fileContents', 'currentLabels', 'email', 'token', 'Markdown']) assert.equal(JSON.stringify(model).includes('"' + field + '"'), false);
});

test('complete zero activity remains measured zero, distinct from pending unknown statistics', () => {
  const ready = project(fixture('ready-empty')), pending = project(fixture('first-analysis-pending'));
  assert.equal(ready.analysis.phase, 'ready'); assert.equal(ready.recentActivity.activeDays, 0); assert.equal(ready.growth.totalXp, '0');
  assert.equal(pending.analysis.phase, 'pending'); assert.equal(pending.classId, null); assert.equal(pending.familyScores, null); assert.equal(pending.recentActivity, null); assert.ok(Object.values(pending.growth).every(value => value === null));
  const markdown = renderProfileMarkdown({ model: pending, characterImageUrl: URL }); assert.match(markdown, /XP, level, class and activity statistics are not finalized/); assert.doesNotMatch(markdown, /Lv\.1|0 XP|\| Craft|Last successful analysis|Scheduled daily/);
  const ashPending = fixture('first-analysis-pending'); ashPending.state.faction.id = 'ashbound'; const ashModel = project(ashPending); assert.equal(ashModel.familyScores, null); assert.notDeepEqual(renderCharacterPng({ model: ashModel }), renderCharacterPng({ model: pending }));
});

test('both faction synthetic demos append local native Markdown and character-only images while retaining legacy artifact paths', () => {
  const images = [];
  for (const faction of ['bloomguard', 'ashbound']) {
    const { result, files, model } = demo(faction); images.push(files.get('.commitkin/character.png'));
    for (const path of ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/card.png', 'README.md', 'growth-gallery.png', 'preview-report.json', 'LICENSE.txt', '.commitkin/profile.json', '.commitkin/character.png', 'PROFILE.md']) assert.ok(files.has(path), path);
    assert.equal(result.files.length, 11); assert.equal(model.factionId, faction); assert.equal(model.classId, 'blacksmith'); assert.equal(model.growth.level, '7'); assert.equal(model.familyScores.craft, 100); assert.equal(model.recentActivity.activeDays, 25); assert.equal(model.recentActivity.mergedPrs, 25);
    assert.equal(model.character.sha256, hash(files.get('.commitkin/character.png'))); assert.match(files.get('PROFILE.md').toString(), /Fictional local data only/); assert.match(files.get('PROFILE.md').toString(), /\]\(<\.commitkin\/character\.png>\)/); assert.doesNotMatch(files.get('PROFILE.md').toString(), /raw\.githubusercontent/);
    assert.match(files.get('PROFILE.md').toString(), /previous 30 completed UTC days/); assert.match(files.get('PROFILE.md').toString(), /previous 90 completed UTC days/); assert.match(files.get('PROFILE.md').toString(), /Craft \| `██████████` \| 100\.0 \/ 100/);
    assert.equal(result.report.githubRequests, 0); assert.equal(result.report.realOwnerRecordsChanged, false);
  }
  assert.notDeepEqual(images[0], images[1]);
});

test('standalone PNG is deterministic transparent RGBA with a nonempty original pixel silhouette and exact model digest', () => {
  for (const faction of ['bloomguard', 'ashbound']) {
    const { model } = demo(faction); const png = renderCharacterPng({ model }); const raw = decodedPng(png);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal(png.readUInt32BE(16), 192); assert.equal(png.readUInt32BE(20), 216); assert.equal(png[25], 6); assert.ok(png.length < 15000); assert.equal(raw.length, 216 * (192 * 4 + 1));
    const alphas = []; for (let y = 0; y < 216; y += 1) for (let x = 0; x < 192; x += 1) alphas.push(raw[y * (192 * 4 + 1) + 1 + x * 4 + 3]);
    assert.ok(alphas.includes(0)); assert.ok(alphas.includes(255)); assert.ok(alphas.every(alpha => alpha === 0 || alpha === 255)); assert.equal(raw[4], 0);
    assert.equal(hash(png), model.character.sha256); assert.deepEqual(png, renderCharacterPng({ model }));
  }
});

test('legacy RGB card bytes remain unaffected by rendering character-only transparent alternatives', () => {
  const record = fixture(), card = renderCard({ state: record.state, username: 'DemoHero' }); renderCharacterPng({ model: project(record) });
  assert.deepEqual(renderCard({ state: record.state, username: 'DemoHero' }), card); assert.equal(card[25], 2); assert.equal(card.readUInt32BE(16), 880);
});

test('family projection calls the exact successful-scope classifier rather than creating a second scoring formula', () => {
  const { files, model } = demo(); const record = Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, JSON.parse(files.get('.commitkin/' + role + '.json'))]));
  const scope = record.ledger.scopes.find(scope => scope.id === record.state.evaluation.scopeId); const facts = activityFacts(record.ledger.facts, record.state.evaluation.activityCutoffExclusive, record.state.growth.startDate, new Set(scope.repositoryIds));
  assert.deepEqual(model.familyScores, classifyActivity({ facts, repositories: record.ledger.repositories, evaluationDate: record.state.evaluation.activityCutoffExclusive }).scores);
});

test('recent metrics deduplicate PR, reviewed PR commit, release and raw activity date identities', () => {
  const record = evaluated([
    qualified('submitted_review', '301', '2026-10-10T00:00:00Z', { pr: '17', commit: 'a'.repeat(40) }),
    qualified('submitted_review', '302', '2026-10-11T00:00:00Z', { pr: '17', commit: 'a'.repeat(40) }),
    qualified('submitted_review', '303', '2026-10-12T00:00:00Z', { pr: '17', commit: 'b'.repeat(40) }),
    qualified('merged_pr', '18', '2026-10-12T01:00:00Z'), qualified('published_release', '401', '2026-10-12T02:00:00Z'),
  ]);
  const model = project(record); assert.deepEqual(model.recentActivity, { activeDays: 2, mergedPrs: 1, reviewedPrs: 1, reviewedCommits: 2, releases: 1, directContributions: 0, triageDays: 0 });
});

test('triage summary counts repository dates, not individual issues or extra operations-family units', () => {
  const identity = (kind, sourceId) => activityIdentity({ kind, accountId: '1001', repositoryId: '9001', sourceId });
  const record = evaluated([{ sourceId: { type: 'opaque', value: '2026-10-14' }, fact: { eventKey: identity('triage_day', '2026-10-14'), kind: 'triage_day', repositoryId: '9001', occurredAt: '2026-10-14T12:00:00Z', families: ['operations'], issueKeys: ['1', '2', '3'].map(value => identity('issue', value)) } }]);
  const model = project(record); assert.equal(model.recentActivity.triageDays, 1); assert.equal(model.recentActivity.activeDays, 1); assert.equal(model.recentActivity.mergedPrs, 0);
});

test('recent display uses exactly thirty completed UTC dates and preserves the separate ninety-date classifier', () => {
  const record = evaluated([
    qualified('direct_contribution', '1'.repeat(40), '2026-07-18T00:00:00Z'), qualified('direct_contribution', '2'.repeat(40), '2026-09-15T23:59:59Z'),
    qualified('direct_contribution', '3'.repeat(40), '2026-09-16T00:00:00Z'), qualified('direct_contribution', '4'.repeat(40), '2026-10-15T23:59:59Z'),
  ]);
  const model = project(record); assert.equal(model.analysis.classWindowStart, '2026-07-18'); assert.equal(model.analysis.recentWindowStart, '2026-09-16'); assert.equal(model.analysis.cutoffExclusive, '2026-10-16'); assert.equal(model.recentActivity.directContributions, 2); assert.equal(model.recentActivity.activeDays, 2);
  const shorter = fixture(); shorter.state.growth.startDate = '2026-10-14'; const shortModel = project(shorter); assert.equal(shortModel.analysis.classWindowStart, '2026-10-14'); assert.equal(shortModel.analysis.recentWindowStart, '2026-10-14');
});

test('incomplete or mismatched successful records HOLD instead of rendering zero or using another scope', () => {
  for (const change of [
    r => { r.status.recordRevision += 1; }, r => { r.status.owner.accountId = '9999'; }, r => { r.state.evaluation.scopeId = 'v1:sha256:' + '0'.repeat(64); },
    r => { r.ledger.coverage = []; fixHash(r); }, r => { r.ledger.coverage[0].complete = false; fixHash(r); }, r => { r.ledger.facts[0].families = ['not-a-family']; fixHash(r); },
    r => { r.ledger.repositories[0].ownershipAtFirstObservation = 'unknown'; fixHash(r); }, r => { r.state.growth.totalXp = '99'; }, r => { r.ledger.days[0].xp.total = 41; fixHash(r); },
    r => { r.ledger.scopes[0].repositoryIds.push('9001'); fixHash(r); }, r => { r.state.evaluation.evaluatedAt = '2026-10-14T00:00:00Z'; },
  ]) { const record = fixture(); change(record); assert.deepEqual(buildProfileModel({ ...record, username: 'DemoHero' }), { decision: 'hold', code: 'PROFILE_PROJECTION_INVALID', model: null }); }
  assert.equal(buildProfileModel().decision, 'hold');
});

test('last successful stats and timestamp survive partial/configuration/recovery status, never relabeled up to date', () => {
  for (const dataStatus of ['partial', 'configuration_error', 'recovery_required']) {
    const record = fixture(); record.status.state = dataStatus; record.status.changedAt = '2026-10-16T01:00:00Z'; record.status.unobservedGaps = [{}];
    const model = project(record); const markdown = renderProfileMarkdown({ model, characterImageUrl: URL });
    assert.equal(model.analysis.evaluatedAt, '2026-10-15T01:00:00Z'); assert.equal(model.recentActivity.mergedPrs, 1); assert.match(markdown, /last successful snapshot retained/); assert.match(markdown, /Unobserved gaps remain unknown/); assert.doesNotMatch(markdown, /Complete for the last successful tracked scope|Scheduled daily/);
  }
});

test('strict projection validation rejects unknown fields, malformed identity, arithmetic contradictions and impossible counters', () => {
  const original = project();
  for (const change of [
    m => { m.markdown = '<script>'; }, m => { m.owner.token = 'SECRET'; }, m => { m.username = 'x](javascript:alert(1))'; }, m => { m.owner.accountId = 1001; },
    m => { m.analysis.dataStatus = 'fresh'; }, m => { m.analysis.recentWindowStart = '2026-09-14'; }, m => { m.growth.level = '01'; }, m => { m.growth.xpIntoLevel = '39'; }, m => { m.growth.xpForNextLevel = '99'; }, m => { m.growth.appearanceStage = 4; },
    m => { m.familyScores.craft = NaN; }, m => { m.familyScores.guard = 100.01; }, m => { m.familyScores.knowledge = '0'; }, m => { m.familyScores.extra = 0; },
    m => { m.recentActivity.activeDays = 31; }, m => { m.recentActivity.reviewedPrs = 2; }, m => { m.recentActivity.activeDays = 0; }, m => { m.analysis.knownRepositories = 0; },
    m => { m.character.path = '../../README.md'; }, m => { m.character.width = 880; }, m => { m.character.sha256 = 'bad'; },
    m => { m.traits.habitId = 'finisher'; }, m => { m.traits.activityId = 'focused'; }, m => { m.analysis.extra = true; },
  ]) { const model = clone(original); change(model); assert.throws(() => validateProfileModel(model), /PROFILE_MODEL_INVALID/); }
  const oversized = clone(original); oversized.extra = 'x'.repeat(PROFILE_MODEL_MAX_BYTES); assert.throws(() => validateProfileModel(oversized), /PROFILE_MODEL_INVALID/);
});

test('badge display uses approved Name · Grade, rejects duplicates or future earning times', () => {
  const model = demo().model; const markdown = renderProfileMarkdown({ model, characterImageUrl: URL }); assert.match(markdown, /Footprints · Silver|Completed Works · Silver|Class Codex · Bronze/); assert.doesNotMatch(markdown, /\(bronze\)|\(silver\)/);
  const duplicate = clone(model); duplicate.badges = [clone(model.badges[0]), clone(model.badges[0])]; assert.throws(() => validateProfileModel(duplicate), /PROFILE_MODEL_INVALID/);
  const future = clone(model); future.badges[0].earnedAt = '2027-01-01T00:00:00Z'; assert.throws(() => validateProfileModel(future), /PROFILE_MODEL_INVALID/);
});

test('pending contradictions reject invented zero growth, finalized class, measured statistics or prior traits', () => {
  for (const change of [m => { m.growth.totalXp = '0'; }, m => { m.classId = 'adventurer'; }, m => { m.familyScores = {}; }, m => { m.analysis.knownRepositories = 0; }, m => { m.traits.habitId = 'focused'; }]) { const model = project(fixture('first-analysis-pending')); change(model); assert.throws(() => validateProfileModel(model), /PROFILE_MODEL_INVALID/); }
  const record = fixture('first-analysis-pending'); record.state.traits.habit.currentId = 'focused'; assert.equal(buildProfileModel({ ...record, username: 'DemoHero' }).decision, 'hold');
});

test('Markdown accepts only the owner-controlled pinned raw character URL and never arbitrary HTML or dynamic endpoints', () => {
  const model = project(); const markdown = renderProfileMarkdown({ model, characterImageUrl: URL }); assert.match(markdown, /\| Character \| Profile \|/); assert.match(markdown, /\| !\[DemoHero:[^\n]+\| \*\*DemoHero\*\*/); assert.match(markdown, /Activity families/); assert.match(markdown, /Recent activity/); assert.doesNotMatch(markdown, /<img|<script|<iframe|Scheduled daily/);
  for (const url of [URL.replace('https:', 'http:'), URL.replace('raw.githubusercontent.com', 'evil.invalid'), URL.replace('/DemoHero/', '/OtherUser/'), URL.replace(SHA, 'main'), URL + '?token=SECRET', URL + '#x', URL.replace('/commitkin/', '/../'), URL.replace('/commitkin/', '/%2e%2e/'), URL.replace('character.png', 'card.png'), 'javascript:alert(1)']) assert.throws(() => renderProfileMarkdown({ model, characterImageUrl: url }), /PROFILE_MODEL_INVALID/);
  const altered = clone(model); altered.character.sha256 = '0'.repeat(64); assert.throws(() => renderCharacterPng({ model: altered }), /PROFILE_MODEL_INVALID/);
});

test('fixed explanatory details retain scope, trait window, help/recovery/credits and next appearance using only the closed projection', () => {
  const model = project(); const original = clone(model); const markdown = renderProfileMarkdown({ model, characterImageUrl: URL });
  assert.match(markdown, /<details>\n<summary>Character details<\/summary>/); assert.match(markdown, /automatically discovered and added repositories/);
  assert.match(markdown, /Class: previous 90 completed UTC days\. Traits: previous 30 completed UTC days/); assert.match(markdown, /not skill or seniority/); assert.match(markdown, /Adventurer stays fixed until a verified regular assignment/);
  for (const [label, anchor] of [['How it works', 'how-it-works'], ['Recovery guide', 'recovery'], ['Credits', 'credits']]) assert.ok(markdown.includes('[' + label + '](https://github.com/JEONTAK/commitkin#' + anchor + ')'));
  assert.ok(markdown.endsWith('</details>')); assert.deepEqual(model, original);
  const regular = demo().model; const regularText = renderProfileMarkdown({ model: regular, characterImageUrl: URL }); assert.match(regularText, /Next appearance: Lv\.10\./);
  const final = clone(regular); final.growth = { totalXp: '34300', level: '50', xpIntoLevel: '0', xpForNextLevel: '1325', appearanceStage: 10 };
  assert.match(renderProfileMarkdown({ model: final, characterImageUrl: URL }), /final Lv\.50 stage; numerical levels continue/);
  const pending = renderProfileMarkdown({ model: project(fixture('first-analysis-pending')), characterImageUrl: URL }); assert.match(pending, /Adventurer preview is not a finalized class or level/); assert.doesNotMatch(pending, /Next appearance:|final Lv\.50/);
});

test('closed details project all twelve highest earned series and candidate observations without arbitrary prose', () => {
  const { files } = demo(); const record = Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, JSON.parse(files.get('.commitkin/' + role + '.json'))]));
  record.state.class.id = 'runesmith'; record.state.class.pending = { targetId: 'blacksmith', count: 6, startedOn: '2026-10-09', lastCountedOn: '2026-10-14', contextScopeId: record.state.evaluation.scopeId };
  record.state.traits.habit.pending = { targetId: null, count: 2, startedOn: '2026-10-13', lastCountedOn: '2026-10-14' };
  record.state.traits.activity.pending = { targetId: 'testing', count: 1, startedOn: '2026-10-14', lastCountedOn: '2026-10-14' };
  record.state.achievements = Object.keys(ACHIEVEMENT_NAMES).map(seriesId => ({ seriesId, earned: [{ grade: 'bronze', earnedAt: '2026-10-01T00:00:00Z' }, { grade: 'silver', earnedAt: '2026-10-02T00:00:00Z' }, { grade: 'gold', earnedAt: '2026-10-03T00:00:00Z' }] }));
  const model = project(record); assert.equal(model.details.classification.reason, 'retained'); assert.deepEqual(model.details.classPending, { targetId: 'blacksmith', count: 6 });
  assert.deepEqual(model.details.traitPending, { habit: { targetId: null, count: 2 }, activity: { targetId: 'testing', count: 1 } });
  assert.equal(model.details.earnedAchievements.length, 12); assert.ok(model.details.earnedAchievements.every(row => row.grade === 'gold')); assert.equal(model.badges.length, 3);
  const markdown = renderProfileMarkdown({ model, characterImageUrl: URL });
  assert.match(markdown, /Runesmith retained while the next activity pattern is insufficient/); assert.match(markdown, /Class candidate: Blacksmith · 6\/7 observations/); assert.match(markdown, /14-date change interval/);
  assert.match(markdown, /Habit trait removal · 2\/3 observations/); assert.match(markdown, /Activity trait candidate: Testing · 1\/3 observations/);
  const earned = markdown.split('\n').find(line => line.startsWith('Earned achievements: ')); for (const name of Object.values(ACHIEVEMENT_NAMES)) assert.ok(earned.includes(name + ' · Gold'));
  assert.doesNotMatch(earned, / · Bronze| · Silver/);
  const current = demo().model; assert.equal(current.details.classification.reason, 'qualified-current'); assert.match(renderProfileMarkdown({ model: current, characterImageUrl: URL }), /Craft activity leads.*self-owned, focused/);
  assert.equal(project().details.classification.reason, 'adventurer'); assert.equal(project(fixture('first-analysis-pending')).details, null);
});

test('details validation rejects unsafe enums, observation contradictions, duplicate collection rows and badges not actually earned', () => {
  const original = demo().model;
  for (const mutate of [
    m => { delete m.details; }, m => { m.details.freeText = '<script>'; }, m => { m.details.classification.reason = 'override'; }, m => { m.details.classification.family = 'hacking'; },
    m => { m.details.classification.ownership = 'admin'; }, m => { m.details.classification.distribution = 'all'; }, m => { m.details.classification.family = 'guard'; },
    m => { m.details.classPending = { targetId: 'adventurer', count: 1 }; }, m => { m.details.classPending = { targetId: m.classId, count: 1 }; }, m => { m.details.classPending = { targetId: 'machinist', count: 8 }; },
    m => { m.details.traitPending.habit = { targetId: 'testing', count: 1 }; }, m => { m.details.traitPending.activity = { targetId: 'testing', count: 0 }; }, m => { m.details.traitPending.habit = { targetId: null, count: 4 }; },
    m => { m.details.earnedAchievements.push(clone(m.details.earnedAchievements[0])); }, m => { m.details.earnedAchievements[0].earnedAt = '2027-01-01T00:00:00Z'; }, m => { m.details.earnedAchievements = []; },
  ]) { const model = clone(original); mutate(model); assert.throws(() => validateProfileModel(model), /PROFILE_MODEL_INVALID/); }
  const pending = project(fixture('first-analysis-pending')); pending.details = clone(original.details); assert.throws(() => validateProfileModel(pending), /PROFILE_MODEL_INVALID/);
  const none = project(); none.badges = [{ seriesId: 'footprints', grade: 'bronze', earnedAt: '2026-10-14T00:00:00Z' }]; assert.throws(() => validateProfileModel(none), /PROFILE_MODEL_INVALID/);
});
