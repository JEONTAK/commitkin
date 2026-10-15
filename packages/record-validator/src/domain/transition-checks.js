import { requireValid } from './failure.js';
import { equivalent } from './hash.js';
import { calendarDifference } from './bundle-checks.js';

function check(condition, code) { requireValid(condition, code, 'transition'); }
const preservedStateFields = ['schemaVersion', 'rulesetVersion', 'owner', 'faction', 'growth', 'class', 'traits', 'observationClock', 'achievements', 'evaluation'];

function checkAppendOnly(previous, candidate, identity, code) {
  const indexed = new Map(candidate.map(item => [item[identity], item]));
  for (const item of previous) check(indexed.has(item[identity]) && equivalent(item, indexed.get(item[identity])), code);
}

function checkObservation(before, after, previousClock, nextClock, options) {
  const { date, previousNormalDate, limit, scopeChanged } = options;
  const sameDate = previousNormalDate === date;
  check(nextClock === previousClock || (!sameDate && nextClock === date), 'OBSERVATION_CLOCK_CHANGED');
  if (!after) return; // Ambiguity/candidate loss is allowed to clear a pending observation.
  if (sameDate) {
    check(!scopeChanged && before !== null && equivalent(before, after), 'SAME_DATE_OBSERVATION');
    return;
  }
  check(after.lastCountedOn === date && nextClock === date, 'OBSERVATION_DATE_INVALID');
  const reset = scopeChanged || before === null || before.targetId !== after.targetId ||
    calendarDifference(date, previousNormalDate) >= 3;
  if (reset) check(after.count === 1 && after.startedOn === date, 'OBSERVATION_RESET_REQUIRED');
  else check(after.startedOn === before.startedOn && after.count === Math.min(limit, before.count + 1), 'OBSERVATION_INCREMENT_INVALID');
}

function canApplyObservation(before, target, previousClock, options) {
  const { date, previousNormalDate, limit, scopeChanged } = options;
  if (!before || before.targetId !== target || scopeChanged || calendarDifference(date, previousNormalDate) >= 3) return false;
  return previousNormalDate !== date && previousClock !== date && before.count >= limit - 1;
}

function checkCharacterTransition(previous, candidate, date) {
  const previousNormalDate = previous.observationClock.lastNormalEvaluationOn;
  const scopeChanged = previous.evaluation?.scopeId !== candidate.evaluation?.scopeId;
  const common = { date, previousNormalDate, limit: 7, scopeChanged };
  const beforeClass = previous.class;
  const afterClass = candidate.class;
  checkAppendOnly(beforeClass.history, afterClass.history, 'assignedAt', 'CLASS_HISTORY_LOST');
  if (beforeClass.id === afterClass.id) {
    check(equivalent(beforeClass.history, afterClass.history) && beforeClass.lastChangedOn === afterClass.lastChangedOn, 'CLASS_HISTORY_CHANGED');
    checkObservation(beforeClass.pending, afterClass.pending, previous.observationClock.classLastCountedOn, candidate.observationClock.classLastCountedOn, common);
  } else {
    check(afterClass.id !== 'adventurer' && afterClass.pending === null && afterClass.lastChangedOn === date, 'CLASS_CHANGE_INVALID');
    check(afterClass.history.length === beforeClass.history.length + 1 && equivalent(beforeClass.history, afterClass.history.slice(0, -1)), 'CLASS_HISTORY_CHANGED');
    check(afterClass.history.at(-1).classId === afterClass.id && afterClass.history.at(-1).assignedAt.slice(0, 10) >= date, 'CLASS_HISTORY_CHANGED');
    if (beforeClass.id !== 'adventurer') {
      check(calendarDifference(date, beforeClass.lastChangedOn) >= 14, 'CLASS_COOLDOWN');
      check(canApplyObservation(beforeClass.pending, afterClass.id, previous.observationClock.classLastCountedOn, common), 'CLASS_OBSERVATIONS_REQUIRED');
    }
    check(candidate.observationClock.classLastCountedOn === date, 'OBSERVATION_DATE_INVALID');
  }
  for (const slot of ['habit', 'activity']) {
    const before = previous.traits[slot];
    const after = candidate.traits[slot];
    const clockKey = slot + 'LastCountedOn';
    const options = { date, previousNormalDate, limit: 3, scopeChanged: false };
    if (before.currentId === after.currentId) {
      checkObservation(before.pending, after.pending, previous.observationClock[clockKey], candidate.observationClock[clockKey], options);
      check(after.pending === null || after.pending.count < 3, 'TRAIT_CHANGE_NOT_APPLIED');
    } else {
      // A null used slot is not proof of never-used; only a genuinely never-counted
      // empty slot can use the initial exception. Source eligibility still not checked.
      const initial = before.currentId === null && previous.observationClock[clockKey] === null && before.pending === null;
      check(initial || canApplyObservation(before.pending, after.currentId, previous.observationClock[clockKey], options), 'TRAIT_OBSERVATIONS_REQUIRED');
      check(after.pending === null && candidate.observationClock[clockKey] === date, 'TRAIT_CHANGE_INVALID');
    }
  }
}

function checkRetention(previous, candidate) {
  const repositories = new Map(candidate.repositories.map(repo => [repo.id, repo]));
  for (const repo of previous.repositories) {
    const after = repositories.get(repo.id);
    check(after && after.firstObservedAt === repo.firstObservedAt && after.ownershipAtFirstObservation === repo.ownershipAtFirstObservation && repo.discoveredVia.every(source => after.discoveredVia.includes(source)), 'TRACKING_HISTORY_LOST');
  }
  checkAppendOnly(previous.scopes, candidate.scopes, 'id', 'SCOPE_HISTORY_LOST');
  checkAppendOnly(previous.facts, candidate.facts, 'eventKey', 'EVIDENCE_LOST');
  check(equivalent(previous.corrections, candidate.corrections), 'CORRECTION_REVIEW_REQUIRED');
  const days = new Map(candidate.days.map(day => [day.date, day]));
  for (const day of previous.days) {
    const after = days.get(day.date);
    check(after && after.xp.total >= day.xp.total, 'SETTLEMENT_REDUCED');
    for (const row of day.byRepository) {
      const next = after.byRepository.find(item => item.repositoryId === row.repositoryId);
      check(next && Object.entries(row.familyUnits).every(([family, units]) => next.familyUnits[family] >= units), 'SETTLEMENT_EVIDENCE_LOST');
    }
  }
  for (const range of previous.coverage.filter(item => item.complete)) {
    let end = range.startDate;
    const intervals = candidate.coverage.filter(item => item.complete && item.scopeId === range.scopeId).sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (const item of intervals) if (item.startDate <= end && item.endDateExclusive > end) end = item.endDateExclusive;
    check(end >= range.endDateExclusive, 'COVERAGE_HISTORY_LOST');
  }
}

export function checkTransition(previous, candidate, context) {
  const before = previous.state;
  const after = candidate.state;
  check(equivalent(before.owner, after.owner), 'OWNER_IMMUTABLE');
  check(equivalent(before.faction, after.faction), 'FACTION_IMMUTABLE');
  check(before.growth.startDate === after.growth.startDate, 'GROWTH_START_IMMUTABLE');
  check(!before.settings.filePreviouslyUsed || after.settings.filePreviouslyUsed, 'SETTINGS_HISTORY_LOST');
  const sameRecords = equivalent(before, after) && equivalent(previous.ledger, candidate.ledger);
  check(after.recordRevision >= before.recordRevision, 'REVISION_ROLLBACK');
  if (!sameRecords) check(after.recordRevision === before.recordRevision + 1, 'REVISION_STEP_INVALID');
  if (context.operation === 'status-only') {
    check(sameRecords, 'STATUS_ONLY_CHANGED_GROWTH');
    return 'STATUS_ONLY_UNCHANGED';
  }
  if (context.operation === 'failed-collection' || context.operation === 'metadata-only') {
    check(candidate.status && candidate.status.state !== 'ok', 'FAILURE_STATUS_REQUIRED');
    for (const field of preservedStateFields) check(equivalent(before[field], after[field]), 'FAILURE_CHANGED_GROWTH');
    if (context.operation === 'failed-collection') check(sameRecords, 'FAILURE_CHANGED_RECORDS');
    else {
      for (const field of ['schemaVersion', 'rulesetVersion', 'owner', 'scopes', 'coverage', 'facts', 'days', 'corrections']) check(equivalent(previous.ledger[field], candidate.ledger[field]), 'METADATA_CHANGED_EVIDENCE');
      check(equivalent(before.settings, after.settings), 'METADATA_CHANGED_SETTINGS');
      checkRetention(previous.ledger, candidate.ledger);
    }
    return 'SUCCESS_PRESERVED';
  }
  check(candidate.status?.state === 'ok', 'NORMAL_STATUS_REQUIRED');
  if (sameRecords) return 'REPLAY_UNCHANGED';
  check(after.growth.phase === 'ready', 'READY_STATE_REQUIRED');
  check(after.evaluation.lastSuccessfulRevision === after.recordRevision, 'SUCCESS_REVISION_NOT_CURRENT');
  const date = (context.evaluationStartedAt ?? context.now).slice(0, 10);
  check(after.evaluation.activityCutoffExclusive === date && after.observationClock.lastNormalEvaluationOn === date, 'EVALUATION_CONTEXT_MISMATCH');
  if (context.evaluationStartedAt) check(Date.parse(after.evaluation.evaluatedAt) >= Date.parse(context.evaluationStartedAt), 'EVALUATION_CONTEXT_MISMATCH');
  if (before.evaluation) check(Date.parse(after.evaluation.evaluatedAt) >= Date.parse(before.evaluation.evaluatedAt), 'EVALUATION_ROLLBACK');
  if (before.observationClock.lastNormalEvaluationOn) check(date >= before.observationClock.lastNormalEvaluationOn, 'EVALUATION_ROLLBACK');
  checkRetention(previous.ledger, candidate.ledger);
  const tiers = new Map(after.achievements.map(series => [series.seriesId, series.earned]));
  for (const series of before.achievements) {
    check(tiers.has(series.seriesId), 'ACHIEVEMENT_LOST');
    checkAppendOnly(series.earned, tiers.get(series.seriesId), 'grade', 'ACHIEVEMENT_LOST');
  }
  if (before.growth.phase === 'ready') {
    check(BigInt(after.growth.totalXp) >= BigInt(before.growth.totalXp), 'XP_ROLLBACK');
    checkCharacterTransition(before, after, date);
  } else {
    for (const clock of Object.values(after.observationClock)) check(clock === null || clock === date, 'FIRST_NORMAL_OBSERVATION_INVALID');
    for (const pending of [after.class.pending, after.traits.habit.pending, after.traits.activity.pending]) {
      if (pending) check(pending.count === 1 && pending.startedOn === date && pending.lastCountedOn === date, 'FIRST_NORMAL_OBSERVATION_INVALID');
    }
    check(after.class.history.length <= 1 && after.class.history.every(entry => entry.assignedAt.slice(0, 10) >= date), 'CLASS_HISTORY_INVENTED');
  }
  return 'TRANSITION_GUARDS_PASSED';
}
