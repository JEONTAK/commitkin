import { levelProgress, appearanceForLevel } from '../growth/levels.mjs';
import { CLASS_NAMES, FAMILY_NAMES } from './catalog.mjs';
import { activityFacts, dateNumber, daysBetween, intervalObserved, shiftDate } from './activity.mjs';
import { classifyActivity, transitionClass } from './classification.mjs';
import { selectTraits, transitionTrait } from './traits.mjs';
import { achievementMeasures, awardAchievements, selectAchievementBadges } from './achievements.mjs';

export { classifyActivity } from './classification.mjs';
export { selectTraits } from './traits.mjs';
export { achievementMeasures, awardAchievements, selectAchievementBadges } from './achievements.mjs';
export { CLASS_NAMES, CLASS_ROWS, CLASS_FAMILY, FAMILIES, ACHIEVEMENTS, TRAIT_NAMES, ACHIEVEMENT_NAMES } from './catalog.mjs';

/** Evaluate a qualified, complete candidate ledger. No writes, source trust, or rewards. */
export function evaluateCharacter({ previousState, ledger, evaluationDate, evaluatedAt, scopeId, initialAssignmentVerified = false }) {
  dateNumber(evaluationDate);
  const at = Date.parse(evaluatedAt);
  if (!Number.isFinite(at) || !evaluatedAt.endsWith('Z') || evaluatedAt.slice(0, 10) < evaluationDate) throw new TypeError('CHARACTER_TIMESTAMP_INVALID');
  if (!previousState?.growth?.startDate || !ledger || !Array.isArray(ledger.facts) || !Array.isArray(ledger.days)) throw new TypeError('CHARACTER_INPUT_INVALID');
  const startDate = previousState.growth.startDate;
  if (daysBetween(evaluationDate, startDate) < 0) throw new TypeError('CHARACTER_START_INVALID');
  const scope = ledger.scopes.find(item => item.id === scopeId);
  if (!scope) throw new TypeError('CHARACTER_SCOPE_MISSING');
  const repositories = new Set(scope.repositoryIds);
  const windowStart = startDate > shiftDate(evaluationDate, -90) ? startDate : shiftDate(evaluationDate, -90);
  if (!intervalObserved(ledger.coverage, scopeId, windowStart, evaluationDate)) throw new TypeError('CHARACTER_COVERAGE_INCOMPLETE');
  const normal = previousState.observationClock?.lastNormalEvaluationOn ?? null;
  if (normal && normal > evaluationDate) throw new TypeError('CHARACTER_EVALUATION_REVERSED');
  const oldClock = { lastNormalEvaluationOn: null, classLastCountedOn: null, habitLastCountedOn: null, activityLastCountedOn: null, ...previousState.observationClock };
  const allFacts = activityFacts(ledger.facts, evaluationDate, startDate);
  const scopedFacts = allFacts.filter(fact => repositories.has(fact.repositoryId));
  const selection = classifyActivity({ facts: scopedFacts, repositories: ledger.repositories, evaluationDate });
  const classResult = transitionClass({ previousClass: previousState.class, selection, evaluationDate, evaluatedAt, scopeId,
    clock: oldClock.classLastCountedOn, previousNormalDate: normal, initialAssignmentVerified });
  const candidates = selectTraits({ facts: scopedFacts, classId: classResult.value.id, coverage: ledger.coverage, scopeId, evaluationDate });
  const habit = transitionTrait({ previousSlot: previousState.traits?.habit, targetId: candidates.habit, evaluationDate,
    clock: oldClock.habitLastCountedOn, previousNormalDate: normal, initialAssignmentVerified });
  const activity = transitionTrait({ previousSlot: previousState.traits?.activity, targetId: candidates.activity, evaluationDate,
    clock: oldClock.activityLastCountedOn, previousNormalDate: normal, initialAssignmentVerified });
  const measures = achievementMeasures({ facts: allFacts, classHistory: classResult.value.history, startDate, evaluationDate });
  const achievements = awardAchievements({ previousAchievements: previousState.achievements ?? [], measures, evaluatedAt });
  const totalXp = ledger.days.reduce((sum, day) => sum + BigInt(day.xp.total), 0n).toString();
  const level = levelProgress(totalXp);
  const appearance = { ...appearanceForLevel({ classId: classResult.value.id, level: level.level }), classId: classResult.value.id, factionId: previousState.faction.id };
  const actualName = CLASS_NAMES[classResult.value.id];
  const classificationReason = selection.candidateId === classResult.value.id ?
    `${actualName}: ${FAMILY_NAMES[selection.family]} activity leads in the observed public scope, with ${selection.ownership === 'self' ? 'self-owned' : 'other-owned'}, ${selection.distribution} contributions.` :
    classResult.value.id === 'adventurer' ? 'Adventurer: there is not yet a verified, clear regular-class assignment in the observed public scope.' :
      `${actualName} retained while the next activity pattern is insufficient, ambiguous, or under observation.`;
  return {
    class: classResult.value,
    traits: { habit: habit.value, activity: activity.value },
    observationClock: { lastNormalEvaluationOn: evaluationDate, classLastCountedOn: classResult.countedOn, habitLastCountedOn: habit.countedOn, activityLastCountedOn: activity.countedOn },
    achievements, level, appearance, classificationReason,
    // Internal orchestration hint only; never a public record or trust flag.
    classCandidateId: selection.candidateId,
    displayedAchievements: selectAchievementBadges(achievements),
  };
}
