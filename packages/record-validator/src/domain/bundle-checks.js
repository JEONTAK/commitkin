import { requireValid as check } from './failure.js';
import { digest, equivalent, scopeDigest } from './hash.js';

export function uniqueMap(items, key, code) {
  const result = new Map();
  for (const item of items) {
    check(!result.has(item[key]), code);
    result.set(item[key], item);
  }
  return result;
}

export function calendarDifference(later, earlier) {
  return (Date.parse(later + 'T00:00:00Z') - Date.parse(earlier + 'T00:00:00Z')) / 86400000;
}

function checkRange(range) {
  check(range.startDate < range.endDateExclusive, 'INVALID_DATE_RANGE');
}

function checkCharacter(state, now) {
  const normalDate = state.observationClock.lastNormalEvaluationOn;
  check(state.growth.startDate <= now.slice(0, 10), 'FUTURE_DATE');
  check(Date.parse(state.faction.confirmedAt) <= Date.parse(now), 'FUTURE_TIMESTAMP');
  for (const date of Object.values(state.observationClock)) {
    if (date !== null) check(date >= state.growth.startDate && date <= normalDate, 'OBSERVATION_CLOCK_INVALID');
  }
  if (state.growth.phase === 'pending') return;
  const evaluation = state.evaluation;
  check(Date.parse(evaluation.evaluatedAt) <= Date.parse(now), 'FUTURE_TIMESTAMP');
  check(normalDate === evaluation.activityCutoffExclusive && normalDate <= evaluation.evaluatedAt.slice(0, 10), 'EVALUATION_DATE_MISMATCH');
  check(normalDate >= state.growth.startDate, 'EVALUATION_DATE_MISMATCH');
  const history = state.class.history;
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    check(entry.assignedAt.slice(0, 10) >= state.growth.startDate && Date.parse(entry.assignedAt) <= Date.parse(evaluation.evaluatedAt), 'CLASS_HISTORY_INVALID');
    if (i > 0) check(Date.parse(entry.assignedAt) > Date.parse(history[i - 1].assignedAt) && entry.classId !== history[i - 1].classId, 'CLASS_HISTORY_INVALID');
  }
  if (state.class.id !== 'adventurer') {
    check(history.at(-1).classId === state.class.id && state.class.lastChangedOn <= normalDate && history.at(-1).assignedAt.slice(0, 10) >= state.class.lastChangedOn, 'CLASS_HISTORY_INVALID');
  }
  const slots = [
    [state.class.pending, state.class.id, state.observationClock.classLastCountedOn],
    [state.traits.habit.pending, state.traits.habit.currentId, state.observationClock.habitLastCountedOn],
    [state.traits.activity.pending, state.traits.activity.currentId, state.observationClock.activityLastCountedOn],
  ];
  for (const [pending, current, clock] of slots) {
    if (!pending) continue;
    check(pending.targetId !== current, 'PENDING_TARGET_UNCHANGED');
    check(pending.startedOn >= state.growth.startDate && pending.startedOn <= pending.lastCountedOn && pending.lastCountedOn === normalDate, 'PENDING_DATES_INVALID');
    check(clock === pending.lastCountedOn && pending.count <= calendarDifference(pending.lastCountedOn, pending.startedOn) + 1, 'OBSERVATION_CLOCK_INVALID');
  }
  if (state.class.pending) check(state.class.pending.contextScopeId === evaluation.scopeId, 'PENDING_SCOPE_MISMATCH');
  const series = uniqueMap(state.achievements, 'seriesId', 'DUPLICATE_ACHIEVEMENT_SERIES');
  for (const item of series.values()) {
    uniqueMap(item.earned, 'grade', 'DUPLICATE_EARNED_GRADE');
    for (const tier of item.earned) check(Date.parse(tier.earnedAt) <= Date.parse(evaluation.evaluatedAt), 'FUTURE_TIMESTAMP');
  }
}

function checkDayRewards(day, facts, paid) {
  for (const [category, kind, identity, value] of [
    ['mergedPrs', 'merged_pr', 'prKey', 20],
    ['reviews', 'submitted_review', 'prKey', 15],
    ['releases', 'published_release', 'releaseKey', 25],
  ]) {
    const keys = day.creditedKeys[category];
    check((keys.length === 0) === (day.xp[category] === 0) && day.xp[category] >= keys.length && day.xp[category] <= keys.length * value, 'CREDITED_XP_INVALID');
    for (const key of keys) {
      const matching = facts.filter(fact => fact.kind === kind && fact[identity] === key);
      check(matching.some(fact => fact.occurredAt.slice(0, 10) === day.date && day.byRepository.some(row => row.repositoryId === fact.repositoryId)), 'MISSING_EVIDENCE_REFERENCE');
      const rewardId = category + ':' + key;
      check(!paid.has(rewardId), 'DUPLICATE_REWARD_IDENTITY');
      paid.add(rewardId);
      // A preserved earlier review, even if unpaid, cannot be paid as a new first review.
      if (category === 'reviews') check(!matching.some(fact => fact.occurredAt.slice(0, 10) < day.date), 'FIRST_REVIEW_ALREADY_OBSERVED');
    }
  }
}

export function checkBundle({ state, ledger, status }, context) {
  for (const record of [state, ledger, status].filter(Boolean)) {
    check(equivalent(record.owner, context.expectedOwner), 'OWNER_MISMATCH', 'cross-file');
    check(record.schemaVersion === state.schemaVersion && record.rulesetVersion === state.rulesetVersion, 'VERSION_MISMATCH', 'cross-file');
  }
  check(state.recordRevision === ledger.recordRevision, 'REVISION_MISMATCH', 'cross-file');
  const successfulRevision = state.evaluation?.lastSuccessfulRevision ?? null;
  check(successfulRevision === null || successfulRevision <= state.recordRevision, 'SUCCESS_REVISION_INVALID', 'cross-file');
  if (status) check(status.recordRevision === state.recordRevision && status.lastSuccessfulRevision === successfulRevision, 'STATUS_REFERENCE_MISMATCH', 'cross-file');
  check(state.integrity.ledgerHash === digest(ledger), 'LEDGER_HASH_MISMATCH', 'integrity');

  const repositories = uniqueMap(ledger.repositories, 'id', 'DUPLICATE_REPOSITORY_ID');
  const scopes = uniqueMap(ledger.scopes, 'id', 'DUPLICATE_SCOPE_ID');
  uniqueMap(ledger.facts, 'eventKey', 'DUPLICATE_EVENT_KEY');
  const days = uniqueMap(ledger.days, 'date', 'DUPLICATE_DAY');
  uniqueMap(ledger.corrections, 'id', 'DUPLICATE_CORRECTION_ID');
  const cutoff = state.evaluation?.activityCutoffExclusive ?? context.now.slice(0, 10);
  for (const repo of repositories.values()) check(Date.parse(repo.firstObservedAt) <= Date.parse(context.now), 'FUTURE_TIMESTAMP');
  for (const scope of scopes.values()) {
    check(scope.repositoryIds.every(id => repositories.has(id)), 'UNKNOWN_REPOSITORY_REFERENCE');
    check(scope.rulesetVersion === ledger.rulesetVersion, 'SCOPE_RULESET_MISMATCH');
    check(scope.analysisConfigHash === digest({ rulesetVersion: scope.rulesetVersion, publicOnly: true }), 'ANALYSIS_CONFIG_HASH_MISMATCH');
    check(scope.id === scopeDigest(scope), 'SCOPE_HASH_MISMATCH');
  }
  if (state.evaluation) check(scopes.has(state.evaluation.scopeId), 'UNKNOWN_SCOPE_REFERENCE');
  for (const range of [...ledger.coverage, ...(status?.collectionPending ?? []), ...(status?.unobservedGaps ?? [])]) {
    checkRange(range);
    if (range.scopeId !== null) check(scopes.has(range.scopeId), 'UNKNOWN_SCOPE_REFERENCE');
    if (range.repositoryId !== undefined) check(repositories.has(range.repositoryId), 'UNKNOWN_REPOSITORY_REFERENCE');
  }
  for (const range of ledger.coverage) {
    check(range.startDate >= state.growth.startDate && range.endDateExclusive <= cutoff, 'COVERAGE_DATE_INVALID');
    check(Date.parse(range.observedAt) <= Date.parse(context.now), 'FUTURE_TIMESTAMP');
  }
  if (status) check(Date.parse(status.changedAt) <= Date.parse(context.now), 'FUTURE_TIMESTAMP');

  // Index once; lifetime record validation must not rescan every fact for every day.
  const factsByDate = new Map();
  const identitySets = { merged_pr: new Set(), direct_contribution: new Set(), published_release: new Set() };
  const reviewFactsByPr = new Map();
  for (const fact of ledger.facts) {
    check(repositories.has(fact.repositoryId), 'UNKNOWN_REPOSITORY_REFERENCE');
    const date = fact.occurredAt.slice(0, 10);
    check(date >= state.growth.startDate && date < cutoff, 'FACT_DATE_INVALID');
    const list = factsByDate.get(date) ?? [];
    list.push(fact); factsByDate.set(date, list);
    const identity = fact.prKey ?? fact.contributionKey ?? fact.releaseKey;
    if (identitySets[fact.kind]) {
      check(!identitySets[fact.kind].has(identity), 'DUPLICATE_SOURCE_IDENTITY');
      identitySets[fact.kind].add(identity);
    }
    if (fact.kind === 'submitted_review') {
      const reviews = reviewFactsByPr.get(fact.prKey) ?? [];
      reviews.push(fact); reviewFactsByPr.set(fact.prKey, reviews);
    }
  }
  const paid = new Set();
  for (const day of days.values()) {
    check(Object.entries(day.xp).filter(([key]) => key !== 'total').reduce((sum, [, value]) => sum + value, 0) === day.xp.total, 'DAY_XP_SUM_MISMATCH');
    check(day.date >= state.growth.startDate && day.date < cutoff, 'DAY_DATE_INVALID');
    check(scopes.has(day.scopeId), 'UNKNOWN_SCOPE_REFERENCE');
    const scopeIds = new Set(scopes.get(day.scopeId).repositoryIds);
    uniqueMap(day.byRepository, 'repositoryId', 'DUPLICATE_DAY_REPOSITORY');
    const facts = factsByDate.get(day.date) ?? [];
    for (const row of day.byRepository) {
      check(repositories.has(row.repositoryId) && scopeIds.has(row.repositoryId), 'UNKNOWN_REPOSITORY_REFERENCE');
      for (const [family, units] of Object.entries(row.familyUnits)) {
        if (units === 1) check(facts.some(fact => fact.repositoryId === row.repositoryId && fact.families.includes(family)), 'MISSING_EVIDENCE_REFERENCE');
      }
    }
    const dayRepositoryIds = new Set(day.byRepository.map(row => row.repositoryId));
    const dayFacts = facts.filter(fact => dayRepositoryIds.has(fact.repositoryId));
    const validDay = day.byRepository.some(row => Object.values(row.familyUnits).some(units => units === 1));
    check(day.xp.validDay === (validDay ? 10 : 0), 'COMMON_BONUS_INVALID');
    check(day.xp.authoredContributionDay === (dayFacts.some(fact => ['merged_pr', 'direct_contribution'].includes(fact.kind)) ? 10 : 0), 'COMMON_BONUS_INVALID');
    check(day.xp.triage === (dayFacts.some(fact => fact.kind === 'triage_day') ? 10 : 0), 'COMMON_BONUS_INVALID');
    check(ledger.coverage.some(range => range.complete && range.scopeId === day.scopeId && range.startDate <= day.date && day.date < range.endDateExclusive), 'SETTLEMENT_COVERAGE_MISSING');
    // Paid-key references use preserved review history, not just today's paid list.
    const referencedFacts = [...facts.filter(fact => fact.kind !== 'submitted_review'),
      ...day.creditedKeys.reviews.flatMap(key => reviewFactsByPr.get(key) ?? [])];
    checkDayRewards(day, referencedFacts, paid);
  }
  const correctionTail = new Map();
  for (const correction of ledger.corrections) {
    check(days.has(correction.date) && correction.beforeXp !== correction.afterXp && Date.parse(correction.correctedAt) <= Date.parse(context.now), 'CORRECTION_INVALID');
    const prior = correctionTail.get(correction.date);
    if (prior) check(prior.afterXp === correction.beforeXp && Date.parse(prior.correctedAt) < Date.parse(correction.correctedAt), 'CORRECTION_CHAIN_INVALID');
    correctionTail.set(correction.date, correction);
  }
  for (const [date, correction] of correctionTail) check(days.get(date).xp.total === correction.afterXp, 'CORRECTION_CHAIN_INVALID');
  if (state.growth.phase === 'ready') {
    const total = ledger.days.reduce((sum, day) => sum + BigInt(day.xp.total), 0n);
    check(BigInt(state.growth.totalXp) === total, 'XP_TOTAL_MISMATCH');
  } else check(ledger.days.length === 0 && ledger.facts.length === 0 && ledger.corrections.length === 0, 'PENDING_SETTLEMENT_INVALID');
  checkCharacter(state, context.now);
}
