import { ACTIVITY_PRIORITY, CLASS_FAMILY, FAMILY_TRAITS, HABIT_PRIORITY } from './catalog.mjs';
import { compareTimestamps, daysBetween, distinctFacts, factDate, familyUnits, intervalObserved, repositoryDates, shiftDate, uniqueDates, unitsFromFacts } from './activity.mjs';

function isRekindled({ facts, coverage, scopeId, evaluationDate }) {
  const dates = [...uniqueDates(facts)].sort();
  for (let index = 1; index < dates.length; index += 1) {
    const anchor = dates[index - 1];
    const returned = dates[index];
    if (daysBetween(returned, anchor) < 15 || daysBetween(evaluationDate, returned) >= 14) continue;
    if (!intervalObserved(coverage, scopeId, shiftDate(anchor, 1), returned)) continue;
    if (dates[index + 1] && daysBetween(dates[index + 1], returned) < 7) return true;
  }
  return false;
}

export function selectTraits({ facts, classId, coverage, scopeId, evaluationDate }) {
  const recent = facts.filter(fact => factDate(fact) >= shiftDate(evaluationDate, -30) && factDate(fact) < evaluationDate);
  const units = unitsFromFacts(recent);
  const dates = uniqueDates(recent);
  const repositoryActivity = repositoryDates(recent);
  const ratioUnits = units.filter(unit => repositoryActivity.get(unit.repositoryId).size >= 2);
  const shares = new Map();
  for (const unit of ratioUnits) shares.set(unit.repositoryId, (shares.get(unit.repositoryId) ?? 0) + 1);
  const maximum = Math.max(0, ...shares.values());
  const habit = new Set();
  if (dates.size >= 12) habit.add('steadfast');
  // Minimum dates/units concern raw recent activity; ratios use the two-date cohort.
  if (dates.size >= 5 && units.length >= 8 && ratioUnits.length > 0 && maximum * 100 >= ratioUnits.length * 75) habit.add('focused');
  if (dates.size >= 5 && units.length >= 8 && shares.size >= 3 && maximum * 100 <= ratioUnits.length * 50) habit.add('roaming');
  const diverse = new Set(units.map(unit => unit.family));
  if (units.length >= 12 && [...diverse].filter(family => { const group = familyUnits(units, family); return group.length >= 3 && new Set(group.map(unit => unit.date)).size >= 2; }).length >= 3) habit.add('versatile');
  if (isRekindled({ facts, coverage, scopeId, evaluationDate })) habit.add('rekindled');
  const activity = new Map();
  function offer(id, eligible, related) { if (eligible) activity.set(id, related.reduce((latest, fact) => latest && compareTimestamps(latest, fact.occurredAt) > 0 ? latest : fact.occurredAt, '')); }
  const reviews = recent.filter(fact => fact.kind === 'submitted_review');
  const merged = recent.filter(fact => fact.kind === 'merged_pr');
  const bug = merged.filter(fact => fact.bugEvidenced);
  const releases = recent.filter(fact => fact.kind === 'published_release');
  const triage = recent.filter(fact => fact.kind === 'triage_day');
  offer('collaborative', distinctFacts(reviews, 'prKey').size >= 5 && uniqueDates(reviews).size >= 3, reviews);
  for (const [id, family] of [['documenting', 'knowledge'], ['testing', 'verification']]) {
    const group = familyUnits(units, family);
    offer(id, group.length >= 5 && new Set(group.map(unit => unit.date)).size >= 3, recent.filter(fact => fact.families.includes(family)));
  }
  offer('mending', distinctFacts(bug, 'prKey').size >= 3 && uniqueDates(bug).size >= 2, bug);
  offer('finisher', distinctFacts(merged, 'prKey').size >= 5 && uniqueDates(merged).size >= 3, merged);
  offer('shipping', distinctFacts(releases, 'releaseKey').size >= 2 && uniqueDates(releases).size >= 2, releases);
  offer('organizing', uniqueDates(triage).size >= 3, triage);
  const preferred = (FAMILY_TRAITS[CLASS_FAMILY[classId]] ?? []).find(id => activity.has(id));
  const fallback = [...activity].sort(([left, leftAt], [right, rightAt]) => compareTimestamps(rightAt, leftAt) || ACTIVITY_PRIORITY.indexOf(left) - ACTIVITY_PRIORITY.indexOf(right))[0]?.[0];
  return { habit: HABIT_PRIORITY.find(id => habit.has(id)) ?? null, activity: preferred ?? fallback ?? null };
}

export function transitionTrait({ previousSlot, targetId, evaluationDate, clock, previousNormalDate, initialAssignmentVerified }) {
  const slot = structuredClone(previousSlot ?? { currentId: null, pending: null });
  let countedOn = clock;
  // Immediate trait assignment is the first normal analysis exception, not a
  // permanent entitlement attached to an empty slot or first-class provenance.
  if (initialAssignmentVerified && previousNormalDate === null && slot.currentId === null && slot.pending === null) return { value: { currentId: targetId, pending: null }, countedOn: targetId === null ? countedOn : evaluationDate };
  if (previousNormalDate !== null && daysBetween(evaluationDate, previousNormalDate) >= 3) slot.pending = null;
  if (targetId === slot.currentId) slot.pending = null;
  else {
    if (slot.pending?.targetId !== targetId) slot.pending = null;
    if (countedOn !== evaluationDate && previousNormalDate !== evaluationDate) {
      slot.pending = slot.pending ? { ...slot.pending, count: Math.min(3, slot.pending.count + 1), lastCountedOn: evaluationDate } :
        { targetId, count: 1, startedOn: evaluationDate, lastCountedOn: evaluationDate };
      countedOn = evaluationDate;
    }
    if (slot.pending?.count === 3) { slot.currentId = targetId; slot.pending = null; }
  }
  return { value: slot, countedOn };
}
