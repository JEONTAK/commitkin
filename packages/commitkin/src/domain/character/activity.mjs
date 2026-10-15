import { FAMILIES } from './catalog.mjs';

const DAY = 86400000;
export function dateNumber(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('CHARACTER_DATE_INVALID');
  const value = Date.parse(date + 'T00:00:00Z');
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new TypeError('CHARACTER_DATE_INVALID');
  return value / DAY;
}
export function dateFromNumber(number) { return new Date(number * DAY).toISOString().slice(0, 10); }
export function daysBetween(later, earlier) { return dateNumber(later) - dateNumber(earlier); }
export function shiftDate(date, days) { return dateFromNumber(dateNumber(date) + days); }
export function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
export function compareTimestamps(left, right) {
  const a = left.slice(0, -1).split('.');
  const b = right.slice(0, -1).split('.');
  const seconds = compareText(a[0], b[0]);
  if (seconds) return seconds;
  const af = a[1] ?? ''; const bf = b[1] ?? '';
  const width = Math.max(af.length, bf.length);
  return compareText(af.padEnd(width, '0'), bf.padEnd(width, '0'));
}
export function compareFacts(left, right) { return compareTimestamps(left.occurredAt, right.occurredAt) || compareText(left.eventKey, right.eventKey); }
export function factDate(fact) { return fact.occurredAt.slice(0, 10); }

// Input is the qualified ledger contract. We do not consume raw eligible/complete flags.
// Repeated reviews of the same reviewed commit cannot create another activity date.
export function activityFacts(facts, cutoff, startDate = '0001-01-01', repositories = null) {
  const seen = new Set();
  return [...facts].sort(compareFacts).filter(fact => {
    const identity = fact.kind === 'submitted_review' ? `review:${fact.repositoryId}:${fact.prKey}:${fact.reviewedCommitKey}` :
      fact.kind === 'merged_pr' ? `pr:${fact.repositoryId}:${fact.prKey}` :
      fact.kind === 'published_release' ? `release:${fact.repositoryId}:${fact.releaseKey}` :
      fact.kind === 'direct_contribution' ? `commit:${fact.repositoryId}:${fact.contributionKey}` : `triage:${fact.repositoryId}:${factDate(fact)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    const date = factDate(fact);
    return date >= startDate && date < cutoff && (!repositories || repositories.has(fact.repositoryId));
  });
}
export function unitsFromFacts(facts) {
  const units = new Map();
  for (const fact of facts) for (const family of fact.families) {
    if (!FAMILIES.includes(family)) throw new TypeError('CHARACTER_FAMILY_INVALID');
    const unit = { repositoryId: fact.repositoryId, date: factDate(fact), family };
    units.set(`${unit.repositoryId}:${unit.date}:${family}`, unit);
  }
  return [...units.values()].sort((left, right) => compareText(left.date, right.date) || compareText(left.repositoryId, right.repositoryId) || FAMILIES.indexOf(left.family) - FAMILIES.indexOf(right.family));
}
export function uniqueDates(facts) { return new Set(facts.map(factDate)); }
export function familyUnits(units, family) { return units.filter(unit => unit.family === family); }
export function repositoryDates(facts) {
  const result = new Map();
  for (const fact of facts) {
    if (!result.has(fact.repositoryId)) result.set(fact.repositoryId, new Set());
    result.get(fact.repositoryId).add(factDate(fact));
  }
  return result;
}
export function distinctFacts(facts, field) { return new Set(facts.map(fact => fact[field])); }

export function intervalObserved(coverage, scopeId, startDate, endDateExclusive) {
  let through = startDate;
  for (const range of coverage.filter(item => item.complete === true && item.scopeId === scopeId).sort((left, right) => compareText(left.startDate, right.startDate))) {
    if (range.endDateExclusive <= through) continue;
    if (range.startDate > through) return false;
    through = range.endDateExclusive;
    if (through >= endDateExclusive) return true;
  }
  return through >= endDateExclusive;
}

export function monday(date) {
  const value = dateNumber(date);
  // 1970-01-01 was Thursday; offset 3 from Monday.
  return dateFromNumber(value - (((value + 3) % 7 + 7) % 7));
}
