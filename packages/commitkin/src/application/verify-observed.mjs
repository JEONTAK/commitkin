import { equivalent } from '../../../record-validator/src/domain/hash.js';
import { settleQualifiedActivities } from '../domain/growth/settlement.mjs';
import { bundleBytes } from './evaluate.mjs';

/** Candidate equality relative to the composition-owned observed source model. */
export function createObservedCandidateVerifier({ validateRecords }) {
  return function verifyObservedCandidate({ context, candidate, previous, qualification }) {
    const base = { sourceModel: 'observed-api-v1', sourceAuthenticity: 'not_checked', progressionAuthorized: false };
    const hold = code => ({ ...base, decision: 'hold', code });
    try {
      if (qualification?.sourceModel !== base.sourceModel || qualification.decision !== 'qualified') return hold('SOURCE_MODEL_MISMATCH');
      const checked = validateRecords(bundleBytes(candidate), { expectedOwner: context.expected.subject, now: context.evaluation.inspectedAt, evaluationStartedAt: context.evaluation.startedAt, operation: 'normal' }, bundleBytes(previous));
      if (checked.code !== 'ACCEPT') return hold('OBSERVED_CANDIDATE_SAFETY_FAILED');
      const keys = new Set(previous.ledger.facts.map(fact => fact.eventKey));
      const settled = settleQualifiedActivities({ activities: qualification.activities, priorActivities: qualification.activities.filter(item => keys.has(item.fact.eventKey)), reviewHistoryFacts: qualification.reviewHistoryFacts,
        previous: previous.state.growth.phase === 'ready' ? { facts: previous.ledger.facts, days: previous.ledger.days, totalXp: previous.state.growth.totalXp } : null });
      if (settled.decision !== 'settled') return hold(settled.code);
      const facts = rows => [...rows].sort((a,b) => a.eventKey < b.eventKey ? -1 : 1);
      const days = rows => rows.map(({date,byRepository,xp,creditedKeys}) => ({date,byRepository,xp,creditedKeys})).sort((a,b) => a.date < b.date ? -1 : 1);
      if (!equivalent(facts(settled.facts), facts(candidate.ledger.facts))) return hold('OBSERVED_FACTS_MISMATCH');
      if (settled.totalXp !== candidate.state.growth.totalXp || !equivalent(days(settled.days), days(candidate.ledger.days))) return hold('OBSERVED_REWARDS_MISMATCH');
      return { ...base, decision: 'accept_relative_to_capture', code: 'OBSERVED_CANDIDATE_MATCH', sourceEligibility: 'passed_relative_to_capture', rewardOrder: 'passed', rewardAllocation: 'passed', recordReport: checked };
    } catch { return hold('OBSERVED_VERIFICATION_UNAVAILABLE'); }
  };
}
