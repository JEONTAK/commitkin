/**
 * INTERNAL boundary: activities must come from source qualification, not user JSON.
 * This function does not authenticate actors, collection coverage, identities or history.
 * `{ fact, sourceId }` carries an approved public ledger fact plus private, ephemeral
 * original ordering metadata. Never persist sourceId/activities into a public record.
 * Existing public snapshots need original-ID context only for affected original dates.
 */
const KINDS = ['merged_pr', 'submitted_review', 'published_release', 'direct_contribution', 'triage_day'];
const FAMILIES = ['craft', 'guard', 'knowledge', 'verification', 'recovery', 'operations'];
const HASH = /^v1:sha256:[0-9a-f]{64}$/;
const ID = /^[1-9][0-9]*$/;
const INTEGER = /^(0|[1-9][0-9]*)$/;
const UTF8 = new TextEncoder();
const PAYMENTS = { merged_pr: { field: 'mergedPrs', key: 'prKey', face: 20, limit: 3 }, submitted_review: { field: 'reviews', key: 'prKey', face: 15, limit: 3 }, published_release: { field: 'releases', key: 'releaseKey', face: 25, limit: 1 } };

function requireThat(condition, code = 'INVALID_QUALIFIED_INPUT') { if (!condition) throw new GrowthFailure(code); }
class GrowthFailure extends Error { constructor(code) { super(code); this.code = code; } }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value, fields) { requireThat(plain(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key))); }
function copy(value) { return structuredClone(value); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function timestamp(value) {
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value));
  const [seconds, fraction = ''] = value.slice(0, -1).split('.');
  const parsed = new Date(seconds + 'Z');
  requireThat(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === seconds);
  return [seconds, fraction.replace(/0+$/, '')];
}
function compareTime(left, right) {
  const [ls, lf] = timestamp(left);
  const [rs, rf] = timestamp(right);
  if (ls !== rs) return ls < rs ? -1 : 1;
  const width = Math.max(lf.length, rf.length);
  const a = lf.padEnd(width, '0'); const b = rf.padEnd(width, '0');
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareNumeric(left, right) { const a = BigInt(left); const b = BigInt(right); return a < b ? -1 : a > b ? 1 : 0; }
function validateSourceId(value) {
  exact(value, ['type', 'value']);
  requireThat(['numeric', 'opaque'].includes(value.type) && typeof value.value === 'string');
  if (value.type === 'numeric') requireThat(ID.test(value.value));
  else requireThat(value.value.length > 0 && value.value.isWellFormed() && /\S/u.test(value.value));
}

/** Original timestamp, declared scalar ID, kind, numeric repository; never hash order. */
export function compareOriginalActivities(left, right) {
  const chronological = compareTime(left.fact.occurredAt, right.fact.occurredAt);
  if (chronological) return chronological;
  validateSourceId(left.sourceId); validateSourceId(right.sourceId);
  if (left.sourceId.type !== right.sourceId.type) return left.sourceId.type === 'numeric' ? -1 : 1;
  if (left.sourceId.type === 'numeric') {
    const value = compareNumeric(left.sourceId.value, right.sourceId.value);
    if (value) return value;
  } else {
    const a = UTF8.encode(left.sourceId.value); const b = UTF8.encode(right.sourceId.value);
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  }
  const kind = KINDS.indexOf(left.fact.kind) - KINDS.indexOf(right.fact.kind);
  return kind || compareNumeric(left.fact.repositoryId, right.fact.repositoryId);
}

function validateFact(input) {
  requireThat(plain(input) && KINDS.includes(input.kind));
  const base = ['eventKey', 'kind', 'repositoryId', 'occurredAt', 'families'];
  const extra = { merged_pr: ['prKey', 'bugEvidenced'], submitted_review: ['prKey', 'reviewedCommitKey'], published_release: ['releaseKey'], direct_contribution: ['contributionKey'], triage_day: ['issueKeys'] }[input.kind];
  exact(input, [...base, ...extra]);
  requireThat(typeof input.eventKey === 'string' && HASH.test(input.eventKey) && typeof input.repositoryId === 'string' && ID.test(input.repositoryId));
  timestamp(input.occurredAt);
  requireThat(Array.isArray(input.families) && input.families.length > 0 && new Set(input.families).size === input.families.length && input.families.every(value => FAMILIES.includes(value)));
  for (const key of ['prKey', 'reviewedCommitKey', 'releaseKey', 'contributionKey']) if (Object.hasOwn(input, key)) requireThat(typeof input[key] === 'string' && HASH.test(input[key]));
  const allowed = {
    merged_pr: ['craft', 'knowledge', 'verification', 'recovery', 'operations'], direct_contribution: ['craft', 'knowledge', 'verification', 'operations'],
    submitted_review: ['guard'], published_release: ['operations'], triage_day: ['operations'],
  }[input.kind];
  requireThat(input.families.every(value => allowed.includes(value)));
  if (input.kind === 'merged_pr') requireThat(typeof input.bugEvidenced === 'boolean' && (input.bugEvidenced ? input.families.includes('recovery') && !input.families.includes('craft') : !input.families.includes('recovery')));
  if (input.kind === 'triage_day') requireThat(Array.isArray(input.issueKeys) && input.issueKeys.length >= 3 && new Set(input.issueKeys).size === input.issueKeys.length && input.issueKeys.every(key => typeof key === 'string' && HASH.test(key)));
  // Preserve retained fact arrays exactly; their order is not reward chronology.
  return copy(input);
}

function validateActivity(input) {
  exact(input, ['fact', 'sourceId']);
  validateSourceId(input.sourceId);
  return { fact: validateFact(input.fact), sourceId: copy(input.sourceId) };
}

function projectDay(day) {
  requireThat(plain(day) && typeof day.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day.date));
  timestamp(day.date + 'T00:00:00Z');
  exact(day.xp, ['validDay', 'authoredContributionDay', 'mergedPrs', 'reviews', 'releases', 'triage', 'total']);
  requireThat(Object.values(day.xp).every(value => Number.isSafeInteger(value) && value >= 0 && value <= 100));
  requireThat(day.xp.total === Object.entries(day.xp).filter(([key]) => key !== 'total').reduce((sum, [, value]) => sum + value, 0));
  exact(day.creditedKeys, ['mergedPrs', 'reviews', 'releases']);
  requireThat(Object.values(day.creditedKeys).every(keys => Array.isArray(keys) && new Set(keys).size === keys.length && keys.every(key => HASH.test(key))));
  requireThat(Array.isArray(day.byRepository) && day.byRepository.every(item => plain(item) && ID.test(item.repositoryId) && plain(item.familyUnits) && FAMILIES.every(family => [0, 1].includes(item.familyUnits[family]))));
  return copy({ date: day.date, byRepository: day.byRepository, xp: day.xp, creditedKeys: day.creditedKeys });
}

function earliestDates(facts, identity) {
  const result = new Map();
  for (const fact of facts.filter(item => item.kind === 'submitted_review')) {
    const key = fact[identity]; const date = fact.occurredAt.slice(0, 10);
    if (!result.has(key) || date < result.get(key)) result.set(key, date);
  }
  return result;
}

function daySettlement(date, activities, allFacts) {
  const sorted = [...activities].sort(compareOriginalActivities);
  const reviewedCommitDate = earliestDates(allFacts, 'reviewedCommitKey');
  const reviewedPrDate = earliestDates(allFacts, 'prKey');
  const seenCommit = new Set(); const seenPr = new Set();
  const effective = []; const rewards = [];
  for (const activity of sorted) {
    const fact = activity.fact;
    if (fact.kind !== 'submitted_review') {
      effective.push(fact);
      if (PAYMENTS[fact.kind]) rewards.push(activity);
      continue;
    }
    if (reviewedCommitDate.get(fact.reviewedCommitKey) === date && !seenCommit.has(fact.reviewedCommitKey)) {
      effective.push(fact); seenCommit.add(fact.reviewedCommitKey);
    }
    if (reviewedPrDate.get(fact.prKey) === date && !seenPr.has(fact.prKey)) {
      rewards.push(activity); seenPr.add(fact.prKey);
    }
  }
  const xp = { validDay: effective.length ? 10 : 0, authoredContributionDay: effective.some(fact => ['merged_pr', 'direct_contribution'].includes(fact.kind)) ? 10 : 0, mergedPrs: 0, reviews: 0, releases: 0, triage: effective.some(fact => fact.kind === 'triage_day') ? 10 : 0, total: 0 };
  let remaining = 100 - xp.validDay - xp.authoredContributionDay - xp.triage;
  const counts = { merged_pr: 0, submitted_review: 0, published_release: 0 };
  const creditedKeys = { mergedPrs: [], reviews: [], releases: [] };
  const allocations = [];
  for (const activity of rewards.sort(compareOriginalActivities)) {
    const rule = PAYMENTS[activity.fact.kind];
    const selected = counts[activity.fact.kind]++ < rule.limit;
    const paid = selected ? Math.min(rule.face, remaining) : 0;
    remaining -= paid; xp[rule.field] += paid;
    const identityKey = activity.fact[rule.key];
    if (paid > 0) creditedKeys[rule.field].push(identityKey);
    allocations.push({ eventKey: activity.fact.eventKey, kind: activity.fact.kind, identityKey, faceValue: rule.face, selected, paid });
  }
  xp.total = 100 - remaining;
  const units = new Map();
  for (const fact of effective) {
    if (!units.has(fact.repositoryId)) units.set(fact.repositoryId, Object.fromEntries(FAMILIES.map(family => [family, 0])));
    for (const family of fact.families) units.get(fact.repositoryId)[family] = 1;
  }
  return {
    day: { date, byRepository: [...units].sort(([a], [b]) => compareNumeric(a, b)).map(([repositoryId, familyUnits]) => ({ repositoryId, familyUnits })), xp, creditedKeys },
    allocations,
  };
}

/**
 * Returns a proposal only; the caller must independently establish qualification and
 * complete required collection before using it. `hold` means preserve prior records.
 * `previous` is the matched public snapshot; `priorActivities` is ephemeral proof.
 * Untouched older days do not require their unavailable original ordering IDs.
 */
export function settleQualifiedActivities({ activities, previous = null, priorActivities = [], reviewHistoryFacts = [] }) {
  try {
    requireThat(Array.isArray(activities) && Array.isArray(priorActivities) && Array.isArray(reviewHistoryFacts));
    const history = reviewHistoryFacts.map(validateFact);
    requireThat(history.every(fact => fact.kind === 'submitted_review'));
    const incoming = activities.map(validateActivity);
    const suppliedPrior = priorActivities.map(validateActivity);
    requireThat(previous === null || plain(previous));
    const previousFacts = previous === null ? [] : previous.facts.map(validateFact);
    const previousDays = previous === null ? [] : previous.days.map(projectDay);
    const oldTotal = previous === null ? '0' : previous.totalXp;
    requireThat(typeof oldTotal === 'string' && INTEGER.test(oldTotal), 'INVALID_PREVIOUS_SNAPSHOT');
    requireThat(previousDays.reduce((sum, day) => sum + BigInt(day.xp.total), 0n) === BigInt(oldTotal), 'INVALID_PREVIOUS_SNAPSHOT');
    requireThat(new Set(previousDays.map(day => day.date)).size === previousDays.length, 'INVALID_PREVIOUS_SNAPSHOT');
    const facts = new Map();
    for (const fact of previousFacts) {
      requireThat(!facts.has(fact.eventKey), 'INVALID_PREVIOUS_SNAPSHOT'); facts.set(fact.eventKey, fact);
    }
    const proofs = new Map();
    for (const activity of [...suppliedPrior, ...incoming]) {
      const key = activity.fact.eventKey;
      if (proofs.has(key)) requireThat(canonical(proofs.get(key)) === canonical(activity), 'CONFLICTING_SOURCE_ACTIVITY');
      if (facts.has(key)) requireThat(canonical(facts.get(key)) === canonical(activity.fact), 'CONFLICTING_RETAINED_FACT');
      proofs.set(key, activity);
    }
    for (const activity of suppliedPrior) requireThat(facts.has(activity.fact.eventKey), 'UNBOUND_PRIOR_ORDERING_EVIDENCE');
    const affected = new Set();
    for (const activity of incoming) {
      if (!facts.has(activity.fact.eventKey)) affected.add(activity.fact.occurredAt.slice(0, 10));
      facts.set(activity.fact.eventKey, activity.fact);
    }
    const allFacts = [...facts.values()];
    const stable = new Map();
    for (const fact of allFacts) {
      const key = fact.kind === 'merged_pr' ? fact.prKey : fact.kind === 'published_release' ? fact.releaseKey : fact.kind === 'direct_contribution' ? fact.contributionKey : fact.kind === 'triage_day' ? fact.repositoryId + ':' + fact.occurredAt.slice(0, 10) : null;
      if (key !== null) {
        const identity = fact.kind + ':' + key;
        requireThat(!stable.has(identity) || stable.get(identity) === fact.eventKey, 'SOURCE_IDENTITY_CONFLICT');
        stable.set(identity, fact.eventKey);
      }
    }
    const original = new Map();
    for (const activity of proofs.values()) {
      const descriptor = canonical({ kind: activity.fact.kind, repositoryId: activity.fact.repositoryId, sourceId: activity.sourceId });
      requireThat(!original.has(descriptor) || original.get(descriptor) === activity.fact.eventKey, 'SOURCE_IDENTITY_CONFLICT');
      original.set(descriptor, activity.fact.eventKey);
    }
    const priorReviewDates = earliestDates(previousFacts, 'prKey');
    for (const [key, date] of earliestDates(allFacts, 'prKey')) if (priorReviewDates.has(key)) requireThat(date >= priorReviewDates.get(key), 'PRIOR_FIRST_REVIEW_CONFLICT');
    const priorCommitDates = earliestDates(previousFacts, 'reviewedCommitKey');
    for (const [key, date] of earliestDates(allFacts, 'reviewedCommitKey')) if (priorCommitDates.has(key)) requireThat(date >= priorCommitDates.get(key), 'PRIOR_REVIEW_COMMIT_CONFLICT');
    const days = new Map(previousDays.map(day => [day.date, day]));
    const allocations = [];
    let delta = 0n;
    for (const date of [...affected].sort()) {
      const dateFacts = allFacts.filter(fact => fact.occurredAt.slice(0, 10) === date);
      requireThat(dateFacts.every(fact => proofs.has(fact.eventKey)), 'MISSING_PRIOR_ORDERING_EVIDENCE');
      const result = daySettlement(date, dateFacts.map(fact => proofs.get(fact.eventKey)), [...history, ...allFacts]);
      const oldDay = days.get(date);
      requireThat(!oldDay || result.day.xp.total >= oldDay.xp.total, 'SETTLED_DAY_REDUCTION');
      delta += BigInt(result.day.xp.total - (oldDay?.xp.total ?? 0));
      // A repeated review can be preserved without inventing an empty activity day.
      if (result.day.xp.total > 0 || oldDay) days.set(date, result.day);
      allocations.push({ date, items: result.allocations });
    }
    // Hash is only a canonical output-list tie breaker, never a reward-order key.
    const retainedFacts = [...facts.values()].sort((a, b) => compareTime(a.occurredAt, b.occurredAt) || compareNumeric(a.repositoryId, b.repositoryId) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0));
    return {
      decision: 'settled', code: 'SETTLEMENT_PROPOSED', totalXp: (BigInt(oldTotal) + delta).toString(), deltaXp: delta.toString(),
      days: [...days.values()].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0), facts: retainedFacts, allocations,
      qualificationVerified: false, sourceAuthenticity: 'not_checked', progressionAuthorized: false,
    };
  } catch (error) {
    return { decision: 'hold', code: error instanceof GrowthFailure ? error.code : 'INVALID_QUALIFIED_INPUT', preservePrevious: true, candidate: null, qualificationVerified: false, sourceAuthenticity: 'not_checked', progressionAuthorized: false };
  }
}
