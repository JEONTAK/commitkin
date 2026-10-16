import { createHash } from 'node:crypto';
import { digest, scopeDigest } from '../../../record-validator/src/domain/hash.js';
import { FAMILIES, CLASS_NAMES, CLASS_FAMILY, HABIT_PRIORITY, ACTIVITY_PRIORITY, TRAIT_NAMES, ACHIEVEMENT_NAMES, GRADES } from '../domain/character/catalog.mjs';
import { classifyActivity } from '../domain/character/classification.mjs';
import { activityFacts, dateNumber, shiftDate, intervalObserved, compareTimestamps } from '../domain/character/activity.mjs';
import { selectAchievementBadges } from '../domain/character/achievements.mjs';
import { levelProgress, xpForLevel, appearanceForLevel } from '../domain/growth/levels.mjs';
import { drawCharacter, FACTION_NAMES } from './card.mjs';
import { canvas, encodePng } from './pixel.mjs';

export const PROFILE_MODEL_MAX_BYTES = 65536;
const WIDTH = 192, HEIGHT = 216;
const ID = /^[1-9][0-9]*$/; const INTEGER = /^(0|[1-9][0-9]*)$/; const HASH = /^v1:sha256:[0-9a-f]{64}$/;
const USERNAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const COUNTERS = ['activeDays', 'mergedPrs', 'reviewedPrs', 'reviewedCommits', 'releases', 'directContributions', 'triageDays'];
const GROWTH_FIELDS = ['totalXp', 'level', 'xpIntoLevel', 'xpForNextLevel', 'appearanceStage'];
const ANALYSIS_FIELDS = ['phase', 'dataStatus', 'growthStartDate', 'evaluatedAt', 'cutoffExclusive', 'classWindowStart', 'recentWindowStart', 'knownRepositories', 'hasUnobservedGaps'];
const PALETTES = {
  bloomguard: { dark: [27, 50, 43], skin: [237, 203, 163], body: [106, 154, 111], accent: [204, 235, 163], metal: [221, 229, 198] },
  ashbound: { dark: [21, 18, 25], skin: [216, 171, 143], body: [112, 37, 52], accent: [240, 124, 77], metal: [145, 137, 150] },
};
function need(value) { if (!value) throw new TypeError('PROFILE_MODEL_INVALID'); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value, keys) { need(plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))); }
function id(value) { need(typeof value === 'string' && ID.test(value)); }
function natural(value) { need(typeof value === 'string' && INTEGER.test(value)); return BigInt(value); }
function count(value) { need(Number.isSafeInteger(value) && value >= 0); }
function date(value) { need(typeof value === 'string'); dateNumber(value); }
function timestamp(value) { need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)); }
function bytes(value) { const encoded = JSON.stringify(value); need(typeof encoded === 'string' && Buffer.byteLength(encoded, 'utf8') <= PROFILE_MODEL_MAX_BYTES); return encoded; }
const sha256 = value => createHash('sha256').update(value).digest('hex');
const startOf = (growthStartDate, cutoff, days) => growthStartDate > shiftDate(cutoff, -days) ? growthStartDate : shiftDate(cutoff, -days);
function earnedRows(rows, maximum) {
  need(Array.isArray(rows) && rows.length <= maximum && new Set(rows.map(item => item.seriesId)).size === rows.length);
  for (const row of rows) { exact(row, ['seriesId', 'grade', 'earnedAt']); need(Object.hasOwn(ACHIEVEMENT_NAMES, row.seriesId) && GRADES.includes(row.grade)); timestamp(row.earnedAt); }
}
function pendingObservation(value, allowed, maximum, current) {
  if (value === null) return;
  exact(value, ['targetId', 'count']); need((value.targetId === null || allowed.includes(value.targetId)) && value.targetId !== current && Number.isSafeInteger(value.count) && value.count >= 1 && value.count <= maximum);
}

/** Closed safe JSON projection, not a trusted growth record or arbitrary Markdown. */
export function validateProfileModel(model) {
  try {
    bytes(model);
    exact(model, ['schemaVersion', 'recordType', 'owner', 'username', 'factionId', 'classId', 'growth', 'traits', 'badges', 'analysis', 'familyScores', 'recentActivity', 'character', 'details']);
    need(model.schemaVersion === 1 && model.recordType === 'profile');
    exact(model.owner, ['accountId', 'storageRepositoryId']); id(model.owner.accountId); id(model.owner.storageRepositoryId);
    need(typeof model.username === 'string' && USERNAME.test(model.username) && Object.hasOwn(FACTION_NAMES, model.factionId));
    exact(model.growth, GROWTH_FIELDS); exact(model.traits, ['habitId', 'activityId']); exact(model.analysis, ANALYSIS_FIELDS);
    need(model.traits.habitId === null || HABIT_PRIORITY.includes(model.traits.habitId)); need(model.traits.activityId === null || ACTIVITY_PRIORITY.includes(model.traits.activityId));
    earnedRows(model.badges, 3);
    const a = model.analysis; date(a.growthStartDate); need(typeof a.hasUnobservedGaps === 'boolean');
    need(['ready', 'pending'].includes(a.phase));
    if (a.phase === 'pending') {
      need(a.dataStatus === 'analysis_pending' && model.classId === null && GROWTH_FIELDS.every(key => model.growth[key] === null));
      need(['evaluatedAt', 'cutoffExclusive', 'classWindowStart', 'recentWindowStart', 'knownRepositories'].every(key => a[key] === null));
      need(model.familyScores === null && model.recentActivity === null && model.traits.habitId === null && model.traits.activityId === null && model.badges.length === 0);
      need(model.details === null);
    } else {
      need(['ok', 'partial', 'configuration_error', 'recovery_required'].includes(a.dataStatus) && Object.hasOwn(CLASS_NAMES, model.classId));
      timestamp(a.evaluatedAt); for (const key of ['cutoffExclusive', 'classWindowStart', 'recentWindowStart']) date(a[key]);
      need(a.growthStartDate <= a.cutoffExclusive && a.cutoffExclusive <= a.evaluatedAt.slice(0, 10));
      need(a.classWindowStart === startOf(a.growthStartDate, a.cutoffExclusive, 90) && a.recentWindowStart === startOf(a.growthStartDate, a.cutoffExclusive, 30));
      count(a.knownRepositories);
      const g = model.growth, total = natural(g.totalXp), level = natural(g.level); need(level >= 1n);
      const into = natural(g.xpIntoLevel), required = natural(g.xpForNextLevel);
      need(required === 100n + 25n * (level - 1n) && into < required && BigInt(xpForLevel(g.level)) + into === total);
      need(g.appearanceStage === appearanceForLevel({ classId: model.classId, level: g.level }).stageIndex);
      exact(model.familyScores, FAMILIES); for (const score of Object.values(model.familyScores)) need(typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 100);
      exact(model.recentActivity, COUNTERS); for (const value of Object.values(model.recentActivity)) count(value);
      const r = model.recentActivity; need(r.activeDays <= dateNumber(a.cutoffExclusive) - dateNumber(a.recentWindowStart) && r.reviewedPrs <= r.reviewedCommits);
      need(r.activeDays <= r.mergedPrs + r.reviewedCommits + r.releases + r.directContributions + r.triageDays);
      need(r.activeDays !== 0 || COUNTERS.every(key => r[key] === 0));
      need(a.knownRepositories !== 0 || Object.values(model.familyScores).every(score => score === 0) && COUNTERS.every(key => r[key] === 0));
      for (const badge of model.badges) need(compareTimestamps(badge.earnedAt, a.evaluatedAt) <= 0);
      exact(model.details, ['classification', 'classPending', 'traitPending', 'earnedAchievements']);
      const details = model.details, classification = details.classification;
      exact(classification, ['reason', 'family', 'ownership', 'distribution']);
      need(['adventurer', 'qualified-current', 'retained'].includes(classification.reason) && (classification.family === null || FAMILIES.includes(classification.family)) && [null, 'self', 'other'].includes(classification.ownership) && [null, 'focused', 'distributed'].includes(classification.distribution));
      need((classification.reason === 'adventurer') === (model.classId === 'adventurer'));
      if (classification.reason === 'qualified-current') need(classification.family === CLASS_FAMILY[model.classId] && classification.ownership !== null && classification.distribution !== null);
      if (details.classPending !== null) { need(model.classId !== 'adventurer' && details.classPending.targetId !== null); pendingObservation(details.classPending, Object.keys(CLASS_FAMILY), 7, model.classId); }
      exact(details.traitPending, ['habit', 'activity']); pendingObservation(details.traitPending.habit, HABIT_PRIORITY, 3, model.traits.habitId); pendingObservation(details.traitPending.activity, ACTIVITY_PRIORITY, 3, model.traits.activityId);
      earnedRows(details.earnedAchievements, 12);
      for (const row of details.earnedAchievements) need(compareTimestamps(row.earnedAt, a.evaluatedAt) <= 0);
      for (const badge of model.badges) need(details.earnedAchievements.some(row => row.seriesId === badge.seriesId && row.grade === badge.grade && compareTimestamps(row.earnedAt, badge.earnedAt) === 0));
    }
    exact(model.character, ['path', 'sha256', 'width', 'height']); need(model.character.path === '.commitkin/character.png' && typeof model.character.sha256 === 'string' && /^[0-9a-f]{64}$/.test(model.character.sha256) && model.character.width === WIDTH && model.character.height === HEIGHT);
    return structuredClone(model);
  } catch { throw new TypeError('PROFILE_MODEL_INVALID'); }
}

function sprite(model) {
  const out = canvas(WIDTH, HEIGHT, [0, 0, 0, 0]);
  drawCharacter(out, { classId: model.classId ?? 'adventurer', factionId: model.factionId, level: model.growth.level ?? '1', x: 0, y: 0, scale: 6, palette: PALETTES[model.factionId] });
  return encodePng(out);
}
export function renderCharacterPng({ model }) {
  const checked = validateProfileModel(model); const png = sprite(checked); need(sha256(png) === checked.character.sha256); return png;
}

function inspectFacts(facts) {
  need(Array.isArray(facts) && new Set(facts.map(fact => fact.eventKey)).size === facts.length);
  for (const fact of facts) {
    need(plain(fact) && HASH.test(fact.eventKey)); id(fact.repositoryId); timestamp(fact.occurredAt);
    need(Array.isArray(fact.families) && fact.families.length > 0 && new Set(fact.families).size === fact.families.length && fact.families.every(value => FAMILIES.includes(value)));
    const key = { merged_pr: 'prKey', submitted_review: 'reviewedCommitKey', published_release: 'releaseKey', direct_contribution: 'contributionKey', triage_day: 'issueKeys' }[fact.kind]; need(key);
    if (key === 'issueKeys') need(Array.isArray(fact.issueKeys) && fact.issueKeys.length >= 3 && fact.issueKeys.every(value => HASH.test(value)));
    else need(HASH.test(fact[key]));
    if (fact.kind === 'submitted_review') need(HASH.test(fact.prKey));
  }
}
function recentMetrics(facts) {
  const distinct = (kind, key) => new Set(facts.filter(fact => fact.kind === kind).map(fact => fact[key])).size;
  return { activeDays: new Set(facts.map(fact => fact.occurredAt.slice(0, 10))).size, mergedPrs: distinct('merged_pr', 'prKey'), reviewedPrs: distinct('submitted_review', 'prKey'), reviewedCommits: distinct('submitted_review', 'reviewedCommitKey'), releases: distinct('published_release', 'releaseKey'), directContributions: distinct('direct_contribution', 'contributionKey'), triageDays: new Set(facts.filter(fact => fact.kind === 'triage_day').map(fact => fact.repositoryId + '/' + fact.occurredAt.slice(0, 10))).size };
}

/** Project only the last validated successful scope, never current partial input. */
export function buildProfileModel({ state, ledger, status, username } = {}) {
  try {
    need(typeof username === 'string' && USERNAME.test(username));
    for (const [role, record] of Object.entries({ state, ledger, status })) need(plain(record) && record.schemaVersion === 1 && record.rulesetVersion === '1.0.0' && record.recordType === role && record.recordRevision === state.recordRevision && record.owner?.accountId === state.owner?.accountId && record.owner?.profileRepositoryId === state.owner?.profileRepositoryId);
    need(Number.isSafeInteger(state.recordRevision) && state.recordRevision >= 1 && state.integrity?.ledgerHash === digest(ledger));
    id(state.owner.accountId); id(state.owner.profileRepositoryId); date(state.growth.startDate);
    need(Array.isArray(status.collectionPending) && Array.isArray(status.unobservedGaps)); timestamp(status.changedAt);
    const pending = state.growth.phase === 'pending';
    const model = { schemaVersion: 1, recordType: 'profile', owner: { accountId: state.owner.accountId, storageRepositoryId: state.owner.profileRepositoryId }, username, factionId: state.faction.id, classId: pending ? null : state.class?.id,
      growth: Object.fromEntries(GROWTH_FIELDS.map(key => [key, null])), traits: { habitId: null, activityId: null }, badges: [],
      analysis: { phase: pending ? 'pending' : 'ready', dataStatus: status.state, growthStartDate: state.growth.startDate, evaluatedAt: null, cutoffExclusive: null, classWindowStart: null, recentWindowStart: null, knownRepositories: null, hasUnobservedGaps: status.unobservedGaps.length > 0 }, familyScores: null, recentActivity: null,
      character: { path: '.commitkin/character.png', sha256: '0'.repeat(64), width: WIDTH, height: HEIGHT }, details: null };
    if (pending) {
      need(state.growth.totalXp === null && state.class === null && state.evaluation === null && status.lastSuccessfulRevision === null && status.state === 'analysis_pending' && ledger.facts.length === 0 && ledger.days.length === 0);
      need(Array.isArray(state.achievements) && state.achievements.length === 0 && ['habit', 'activity'].every(slot => state.traits?.[slot]?.currentId === null && state.traits[slot].pending === null));
    } else {
      need(state.growth.phase === 'ready' && Object.hasOwn(CLASS_NAMES, model.classId) && status.lastSuccessfulRevision === state.evaluation?.lastSuccessfulRevision);
      const evaluation = state.evaluation; timestamp(evaluation.evaluatedAt); date(evaluation.activityCutoffExclusive);
      const cutoff = evaluation.activityCutoffExclusive, classStart = startOf(state.growth.startDate, cutoff, 90), recentStart = startOf(state.growth.startDate, cutoff, 30);
      need(Array.isArray(ledger.scopes) && Array.isArray(ledger.repositories) && Array.isArray(ledger.coverage));
      const scopes = ledger.scopes.filter(scope => scope.id === evaluation.scopeId); need(scopes.length === 1);
      const scope = scopes[0]; need(scope.rulesetVersion === '1.0.0' && Array.isArray(scope.repositoryIds) && new Set(scope.repositoryIds).size === scope.repositoryIds.length); scope.repositoryIds.forEach(id); need(scope.id === scopeDigest(scope));
      need(intervalObserved(ledger.coverage, scope.id, classStart, cutoff));
      inspectFacts(ledger.facts);
      const repositories = scope.repositoryIds.map(repositoryId => { const rows = ledger.repositories.filter(repo => repo.id === repositoryId); need(rows.length === 1 && ['self', 'other'].includes(rows[0].ownershipAtFirstObservation)); return rows[0]; });
      const scoped = activityFacts(ledger.facts, cutoff, state.growth.startDate, new Set(scope.repositoryIds));
      const selection = classifyActivity({ facts: scoped, repositories, evaluationDate: cutoff }); model.familyScores = selection.scores;
      model.recentActivity = recentMetrics(scoped.filter(fact => fact.occurredAt.slice(0, 10) >= recentStart));
      const progress = levelProgress(state.growth.totalXp); need(Array.isArray(ledger.days) && ledger.days.reduce((total, day) => { count(day.xp.total); return total + BigInt(day.xp.total); }, 0n).toString() === progress.totalXp);
      model.growth = { totalXp: progress.totalXp, level: progress.level, xpIntoLevel: progress.xpIntoLevel, xpForNextLevel: progress.xpForNextLevel, appearanceStage: appearanceForLevel({ classId: model.classId, level: progress.level }).stageIndex };
      model.traits = { habitId: state.traits.habit.currentId, activityId: state.traits.activity.currentId };
      need(Array.isArray(state.achievements) && new Set(state.achievements.map(item => item.seriesId)).size === state.achievements.length && state.achievements.every(item => Object.hasOwn(ACHIEVEMENT_NAMES, item.seriesId) && Array.isArray(item.earned) && item.earned.length > 0 && new Set(item.earned.map(row => row.grade)).size === item.earned.length && item.earned.every(row => GRADES.includes(row.grade))));
      model.badges = selectAchievementBadges(state.achievements);
      const shortPending = pending => pending ? { targetId: pending.targetId, count: pending.count } : null;
      model.details = { classification: { reason: model.classId === 'adventurer' ? 'adventurer' : selection.candidateId === model.classId ? 'qualified-current' : 'retained', family: selection.family ?? null, ownership: selection.ownership ?? null, distribution: selection.distribution ?? null }, classPending: shortPending(state.class.pending), traitPending: { habit: shortPending(state.traits.habit.pending), activity: shortPending(state.traits.activity.pending) },
        earnedAchievements: Object.keys(ACHIEVEMENT_NAMES).flatMap(seriesId => { const series = state.achievements.find(item => item.seriesId === seriesId); if (!series) return []; const earned = [...series.earned].sort((left, right) => GRADES.indexOf(right.grade) - GRADES.indexOf(left.grade))[0]; return [{ seriesId, grade: earned.grade, earnedAt: earned.earnedAt }]; }) };
      Object.assign(model.analysis, { evaluatedAt: evaluation.evaluatedAt, cutoffExclusive: cutoff, classWindowStart: classStart, recentWindowStart: recentStart, knownRepositories: scope.repositoryIds.length });
    }
    model.character.sha256 = sha256(sprite(model));
    const checked = validateProfileModel(model); return { decision: pending ? 'pending' : 'ready', code: pending ? 'PROFILE_ANALYSIS_PENDING' : 'PROFILE_MODEL_READY', model: checked };
  } catch { return { decision: 'hold', code: 'PROFILE_PROJECTION_INVALID', model: null }; }
}

export function renderProfileMarkdown({ model, characterImageUrl }) {
  const m = validateProfileModel(model);
  need(typeof characterImageUrl === 'string');
  const match = characterImageUrl.match(/^https:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]{1,100})\/([0-9a-f]{40})\/\.commitkin\/character\.png$/);
  need(match && match[1].toLowerCase() === m.username.toLowerCase() && !['.', '..'].includes(match[2]));
  const summary = m.analysis.phase === 'pending' ? `**${m.username}** · ${FACTION_NAMES[m.factionId]} · Analysis pending` : `**${m.username}** · ${FACTION_NAMES[m.factionId]} · Lv.${m.growth.level} ${CLASS_NAMES[m.classId]}`;
  const lines = ['### Commitkin', '', '| Character | Profile |', '| :---: | :--- |', `| ![${m.username}: ${FACTION_NAMES[m.factionId]} pixel character. ${m.analysis.phase === 'pending' ? 'Analysis pending; class and growth are not finalized.' : `Level ${m.growth.level} ${CLASS_NAMES[m.classId]}.`}](<${characterImageUrl}>) | ${summary} |`, '', `${FACTION_NAMES[m.factionId]} · Permanent faction · Public activity only`, ''];
  if (m.analysis.phase === 'pending') lines.push('Analysis pending. XP, level, class and activity statistics are not finalized. No successful analysis yet.');
  else {
    lines.push(`**Lv.${m.growth.level} ${CLASS_NAMES[m.classId]}** · ${m.growth.totalXp} XP`, '', `Next level: ${m.growth.xpIntoLevel} / ${m.growth.xpForNextLevel} XP`, '', `Traits: ${[m.traits.habitId, m.traits.activityId].filter(Boolean).map(id => TRAIT_NAMES[id]).join(' · ') || 'None yet'}`, '', `Achievements: ${m.badges.map(badge => `${ACHIEVEMENT_NAMES[badge.seriesId]} · ${badge.grade[0].toUpperCase() + badge.grade.slice(1)}`).join(' / ') || 'None yet'}`, '', '#### Activity families · previous 90 completed UTC days', '', `Observed range: ${m.analysis.classWindowStart} to ${m.analysis.cutoffExclusive} (UTC, end exclusive; growth-start bounded).`, '', '| Family | Pattern | Score |', '| --- | --- | ---: |');
    for (const family of FAMILIES) { const cells = Math.round(m.familyScores[family] / 10); lines.push(`| ${family[0].toUpperCase() + family.slice(1)} | \`${'█'.repeat(cells)}${'░'.repeat(10 - cells)}\` | ${m.familyScores[family].toFixed(1)} / 100 |`); }
    lines.push('', 'Activity-pattern scores describe observed public contributions, not skill or seniority.', '', '#### Recent activity · previous 30 completed UTC days', '', `Observed range: ${m.analysis.recentWindowStart} to ${m.analysis.cutoffExclusive} (UTC, end exclusive; growth-start bounded).`, '', '| Activity | Count |', '| --- | ---: |');
    const labels = ['Active UTC dates', 'Merged pull requests', 'Reviewed pull requests', 'Reviewed PR commits', 'Published releases', 'Direct contributions', 'Repository triage days'];
    COUNTERS.forEach((key, index) => lines.push(`| ${labels[index]} | ${m.recentActivity[key]} |`));
    const statusLabel = { ok: 'Complete for the last successful tracked scope', partial: 'Partial current data — last successful snapshot retained', configuration_error: 'Configuration needs attention — last successful snapshot retained', recovery_required: 'Recovery needed — last successful snapshot retained' }[m.analysis.dataStatus];
    lines.push('', `Data: ${statusLabel}.`, '', `Last successful analysis: ${m.analysis.evaluatedAt}.`, `Known repositories in that scope: ${m.analysis.knownRepositories}.`);
  }
  lines.push('', `Growth record starts ${m.analysis.growthStartDate} (UTC). Activity outside the observed public scope may be missing.`);
  if (m.analysis.hasUnobservedGaps) lines.push('Unobserved gaps remain unknown; they are not confirmed inactivity.');
  lines.push('', '<details>', '<summary>Character details</summary>', '',
    'Scope: Public activity from automatically discovered and added repositories. Other activity may be missing.', '',
    'Class: previous 90 completed UTC days. Traits: previous 30 completed UTC days. Both windows are bounded by the preserved growth start.',
    'Classification and family scores describe observed contribution style, not skill or seniority. Recent activity counts qualifying identities, not every GitHub event.');
  if (m.analysis.phase === 'pending') lines.push('Appearance: the Adventurer preview is not a finalized class or level. Required analysis remains incomplete.');
  else {
    const appearance = appearanceForLevel({ classId: m.classId, level: m.growth.level });
    const d = m.details, c = d.classification;
    lines.push(c.reason === 'adventurer' ? 'Adventurer: no verified regular-class assignment has been finalized.' : c.reason === 'qualified-current' ? `${CLASS_NAMES[m.classId]}: ${c.family[0].toUpperCase() + c.family.slice(1)} activity leads in the observed public scope, with ${c.ownership}-owned, ${c.distribution} contributions.` : `${CLASS_NAMES[m.classId]} retained while the next activity pattern is insufficient, ambiguous, or under observation.`);
    if (d.classPending) lines.push(`Class candidate: ${CLASS_NAMES[d.classPending.targetId]} · ${d.classPending.count}/7 observations. Seven observations do not waive the 14-date change interval or candidate requirements.`);
    for (const slot of ['habit', 'activity']) if (d.traitPending[slot]) { const p = d.traitPending[slot]; lines.push(`${slot[0].toUpperCase() + slot.slice(1)} trait ${p.targetId === null ? 'removal' : 'candidate: ' + TRAIT_NAMES[p.targetId]} · ${p.count}/3 observations.`); }
    lines.push(appearance.fixed ? 'Appearance: Adventurer stays fixed until a verified regular assignment.' : appearance.finalStage ? 'Appearance: final Lv.50 stage; numerical levels continue.' : `Next appearance: Lv.${appearance.nextAppearanceAt}.`);
    lines.push('', 'Earned achievements: ' + (d.earnedAchievements.map(row => `${ACHIEVEMENT_NAMES[row.seriesId]} · ${row.grade[0].toUpperCase() + row.grade.slice(1)}`).join(' / ') || 'None yet') + '.');
  }
  lines.push('', '[How it works](https://github.com/JEONTAK/commitkin#how-it-works) · [Recovery guide](https://github.com/JEONTAK/commitkin#recovery) · [Credits](https://github.com/JEONTAK/commitkin#credits)', '', '</details>');
  const markdown = lines.join('\n'); need(Buffer.byteLength(markdown, 'utf8') <= PROFILE_MODEL_MAX_BYTES); return markdown;
}
