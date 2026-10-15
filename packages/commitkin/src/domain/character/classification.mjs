import { CLASS_FAMILY, CLASS_ROWS, FAMILIES, MINIMA } from './catalog.mjs';
import { compareFacts, daysBetween, factDate, shiftDate, unitsFromFacts } from './activity.mjs';

const EPSILON = 1e-9;

export function classifyActivity({ facts, repositories, evaluationDate }) {
  const start = shiftDate(evaluationDate, -90);
  const recent = shiftDate(evaluationDate, -30);
  const window = facts.filter(fact => factDate(fact) >= start && factDate(fact) < evaluationDate);
  const reviews = new Map();
  for (const fact of window.filter(item => item.kind === 'submitted_review').sort(compareFacts)) reviews.set(`${fact.repositoryId}:${fact.prKey}`, fact);
  const source = [...window.filter(fact => fact.kind !== 'submitted_review'), ...reviews.values()];
  const units = unitsFromFacts(source);
  const ownership = new Map(repositories.map(repository => [repository.id, repository.ownershipAtFirstObservation]));
  const statistics = {};
  for (const family of FAMILIES) {
    const all = units.filter(unit => unit.family === family);
    const counts = new Map();
    for (const unit of all) counts.set(unit.repositoryId, (counts.get(unit.repositoryId) ?? 0) + 1);
    const eligible = all.filter(unit => counts.get(unit.repositoryId) >= 2);
    const weightedByRepository = new Map();
    for (const unit of eligible) {
      const age = daysBetween(evaluationDate, unit.date);
      const weight = age <= 30 ? 10 : age <= 60 ? 6 : 3;
      weightedByRepository.set(unit.repositoryId, (weightedByRepository.get(unit.repositoryId) ?? 0) + weight);
    }
    const dates = new Set(eligible.map(unit => unit.date));
    const recentDates = new Set(eligible.filter(unit => unit.date >= recent).map(unit => unit.date));
    const [minimumUnits, minimumDates, minimumRecent, normalizer] = MINIMA[family];
    statistics[family] = {
      weighted: [...weightedByRepository.values()].reduce((sum, value) => sum + value, 0),
      units: eligible.length, dates: dates.size, recentDates: recentDates.size, normalizer,
      minimumMet: eligible.length >= minimumUnits && dates.size >= minimumDates && recentDates.size >= minimumRecent,
      weightedByRepository,
    };
  }
  const total = Object.values(statistics).reduce((sum, value) => sum + value.weighted, 0);
  for (const stat of Object.values(statistics)) stat.score = total === 0 ? 0 : 70 * stat.weighted / total + 30 * Math.min(stat.weighted / (stat.normalizer * 10), 1);
  const ranked = FAMILIES.filter(family => statistics[family].minimumMet).sort((left, right) => statistics[right].score - statistics[left].score || FAMILIES.indexOf(left) - FAMILIES.indexOf(right));
  const selected = ranked[0];
  const scores = Object.fromEntries(FAMILIES.map(family => [family, statistics[family].score]));
  if (!selected || statistics[selected].score + EPSILON < 45 || statistics[selected].score - (ranked[1] ? statistics[ranked[1]].score : 0) + EPSILON < 8) return { candidateId: null, family: null, scores, reason: 'insufficient-family-evidence' };
  const stat = statistics[selected];
  const self = [...stat.weightedByRepository].filter(([id]) => ownership.get(id) === 'self').reduce((sum, [, value]) => sum + value, 0);
  const other = [...stat.weightedByRepository].filter(([id]) => ownership.get(id) === 'other').reduce((sum, [, value]) => sum + value, 0);
  if (self + other !== stat.weighted) throw new TypeError('CHARACTER_OWNERSHIP_MISSING');
  const owner = self * 100 >= stat.weighted * 60 ? 'self' : other * 100 >= stat.weighted * 60 ? 'other' : null;
  if (!owner) return { candidateId: null, family: selected, scores, reason: 'mixed-ownership' };
  const cohort = [...stat.weightedByRepository].filter(([id]) => ownership.get(id) === owner);
  const sum = cohort.reduce((value, [, amount]) => value + amount, 0);
  const largest = Math.max(...cohort.map(([, amount]) => amount));
  const distribution = largest * 100 >= sum * 65 ? 'focused' : cohort.length >= 2 && largest * 100 <= sum * 55 ? 'distributed' : null;
  if (!distribution) return { candidateId: null, family: selected, scores, reason: 'unclear-distribution' };
  const index = (owner === 'other' ? 2 : 0) + (distribution === 'distributed' ? 1 : 0);
  return { candidateId: CLASS_ROWS[selected][index], family: selected, ownership: owner, distribution, scores, reason: 'qualified-candidate' };
}

export function transitionClass({ previousClass, selection, evaluationDate, evaluatedAt, scopeId, clock, previousNormalDate, initialAssignmentVerified }) {
  const current = structuredClone(previousClass ?? { id: 'adventurer', lastChangedOn: null, pending: null, history: [] });
  let countedOn = clock;
  const first = current.id === 'adventurer' && current.history.length === 0;
  if (first) {
    current.pending = null;
    if (selection.candidateId && initialAssignmentVerified) {
      current.id = selection.candidateId;
      current.lastChangedOn = evaluationDate;
      current.history.push({ classId: current.id, assignedAt: evaluatedAt });
      countedOn = evaluationDate;
    }
    return { value: current, countedOn };
  }
  let target = selection.candidateId;
  const family = CLASS_FAMILY[current.id];
  if (target && CLASS_FAMILY[target] !== family && selection.scores[CLASS_FAMILY[target]] - selection.scores[family] + EPSILON < 12) target = null;
  if (target === current.id) target = null;
  const gap = previousNormalDate !== null && daysBetween(evaluationDate, previousNormalDate) >= 3;
  if (gap || (current.pending && current.pending.contextScopeId !== scopeId)) current.pending = null;
  if (!target) current.pending = null;
  else {
    if (current.pending?.targetId !== target) current.pending = null;
    const observedNow = countedOn !== evaluationDate && previousNormalDate !== evaluationDate;
    if (observedNow) {
      current.pending = current.pending ? { ...current.pending, count: Math.min(7, current.pending.count + 1), lastCountedOn: evaluationDate } :
        { targetId: target, count: 1, startedOn: evaluationDate, lastCountedOn: evaluationDate, contextScopeId: scopeId };
      countedOn = evaluationDate;
    }
    if (observedNow && current.pending?.count === 7 && current.lastChangedOn && daysBetween(evaluationDate, current.lastChangedOn) >= 14) {
      current.id = target;
      current.lastChangedOn = evaluationDate;
      current.pending = null;
      current.history.push({ classId: target, assignedAt: evaluatedAt });
    }
  }
  return { value: current, countedOn };
}
