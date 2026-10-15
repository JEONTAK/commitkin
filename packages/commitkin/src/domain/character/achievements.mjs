import { ACHIEVEMENTS, GRADES } from './catalog.mjs';
import { compareTimestamps, distinctFacts, factDate, monday, repositoryDates, shiftDate, uniqueDates, unitsFromFacts } from './activity.mjs';

export function achievementMeasures({ facts, classHistory, startDate, evaluationDate }) {
  const historical = facts.filter(fact => factDate(fact) >= startDate && factDate(fact) < evaluationDate);
  const units = unitsFromFacts(historical);
  const active = uniqueDates(historical);
  const weeks = new Map();
  const repositoryWeeks = new Map();
  for (const fact of historical) {
    const date = factDate(fact);
    const week = monday(date);
    if (week < startDate || shiftDate(week, 7) > evaluationDate) continue;
    if (!weeks.has(week)) weeks.set(week, new Set());
    weeks.get(week).add(date);
    if (!repositoryWeeks.has(fact.repositoryId)) repositoryWeeks.set(fact.repositoryId, new Set());
    repositoryWeeks.get(fact.repositoryId).add(week);
  }
  const merged = historical.filter(fact => fact.kind === 'merged_pr');
  const counts = [
    active.size,
    [...weeks.values()].filter(dates => dates.size >= 3).length,
    distinctFacts(merged, 'prKey').size,
    distinctFacts(historical.filter(fact => fact.kind === 'submitted_review'), 'prKey').size,
    units.filter(unit => unit.family === 'knowledge').length,
    units.filter(unit => unit.family === 'verification').length,
    distinctFacts(merged.filter(fact => fact.bugEvidenced), 'prKey').size,
    distinctFacts(historical.filter(fact => fact.kind === 'published_release'), 'releaseKey').size,
    uniqueDates(historical.filter(fact => fact.kind === 'triage_day')).size,
    [...repositoryDates(historical).values()].filter(dates => dates.size >= 2).length,
    Math.max(0, ...[...repositoryWeeks.values()].map(weeksInRepository => weeksInRepository.size)),
    new Set(classHistory.map(entry => entry.classId).filter(id => id !== 'adventurer')).size,
  ];
  return Object.fromEntries(ACHIEVEMENTS.map(([id], index) => [id, counts[index]]));
}

export function awardAchievements({ previousAchievements, measures, evaluatedAt }) {
  const existing = new Map(previousAchievements.map(series => [series.seriesId, structuredClone(series)]));
  return ACHIEVEMENTS.flatMap(([seriesId, thresholds]) => {
    const series = existing.get(seriesId) ?? { seriesId, earned: [] };
    const grades = new Set(series.earned.map(item => item.grade));
    thresholds.forEach((threshold, index) => {
      if (measures[seriesId] >= threshold && !grades.has(GRADES[index])) series.earned.push({ grade: GRADES[index], earnedAt: evaluatedAt });
    });
    series.earned.sort((left, right) => GRADES.indexOf(left.grade) - GRADES.indexOf(right.grade));
    return series.earned.length ? [series] : [];
  });
}

export function selectAchievementBadges(achievements) {
  return achievements.flatMap(series => {
    const earned = [...series.earned].sort((left, right) => GRADES.indexOf(right.grade) - GRADES.indexOf(left.grade))[0];
    return earned ? [{ seriesId: series.seriesId, ...earned }] : [];
  }).sort((left, right) => GRADES.indexOf(right.grade) - GRADES.indexOf(left.grade) ||
    compareTimestamps(right.earnedAt, left.earnedAt) ||
    ACHIEVEMENTS.findIndex(([id]) => id === left.seriesId) - ACHIEVEMENTS.findIndex(([id]) => id === right.seriesId)).slice(0, 3);
}
