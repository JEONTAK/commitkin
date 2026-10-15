import { digest, equivalent, scopeDigest } from '../../../../record-validator/src/domain/hash.js';
import { requirePreflight as check } from './failure.mjs';

const time = value => Date.parse(value);
const numericSort = (a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;

export function checkContextClock(context) {
  check(time(context.evaluation.startedAt) <= time(context.evaluation.inspectedAt), 'context', 'CONTEXT_CLOCK_INVALID');
}

/** Bind supplied expectations to actual supplied bytes, never to inferred ownership. */
export function checkBindings(context, evidence, candidate, previous) {
  const { startedAt, inspectedAt } = context.evaluation;
  const day = startedAt.slice(0, 10);
  const cutoff = `${day}T00:00:00Z`;
  const settings = context.normalizedSettings;
  for (const names of Object.values(settings.repositories)) {
    check(equivalent(names, [...names].sort()), 'binding', 'SETTINGS_NOT_NORMALIZED');
  }
  const repositoryIds = context.scope.repositoryIds;
  check(equivalent(repositoryIds, [...repositoryIds].sort(numericSort)), 'binding', 'SCOPE_NOT_NORMALIZED');
  const analysisConfigHash = digest({ rulesetVersion: '1.0.0', publicOnly: true });
  const scopeId = scopeDigest({ rulesetVersion: '1.0.0', analysisConfigHash, repositoryIds });
  const settingsHash = digest(settings);
  check(equivalent(context.expected.subject, evidence.subject), 'binding', 'SUBJECT_BINDING_MISMATCH');
  check(evidence.binding.scopeId === scopeId, 'binding', 'SCOPE_BINDING_MISMATCH');
  check(evidence.binding.settingsHash === settingsHash, 'binding', 'SETTINGS_BINDING_MISMATCH');
  check(evidence.binding.candidateLedgerHash === digest(candidate.ledger), 'binding', 'CANDIDATE_LEDGER_BINDING_MISMATCH');
  check(context.comparison.mode === (previous ? 'with_previous' : 'snapshot_only'), 'binding', 'PREVIOUS_MODE_MISMATCH');
  check(evidence.binding.previousLedgerHash === (previous ? digest(previous.ledger) : null), 'binding', 'PREVIOUS_LEDGER_BINDING_MISMATCH');
  check(candidate.state.evaluation !== null && candidate.state.evaluation !== undefined, 'binding', 'SUCCESSFUL_RECORD_REQUIRED', 'hold');
  check(candidate.state.evaluation.scopeId === scopeId, 'binding', 'CANDIDATE_SCOPE_MISMATCH');
  check(candidate.state.settings.lastAcceptedHash === settingsHash, 'binding', 'CANDIDATE_SETTINGS_MISMATCH');
  check(evidence.evaluation.startedAt === startedAt, 'binding', 'EVALUATION_START_MISMATCH');
  check(evidence.evaluation.activityCutoffExclusive === day && candidate.state.evaluation.activityCutoffExclusive === day, 'binding', 'ACTIVITY_CUTOFF_MISMATCH');
  check(time(startedAt) <= time(evidence.evaluation.capturedThrough) && time(evidence.evaluation.capturedThrough) <= time(inspectedAt), 'binding', 'CAPTURE_CLOCK_INVALID');
  check(time(evidence.evaluation.capturedThrough) <= time(candidate.state.evaluation.evaluatedAt), 'binding', 'CANDIDATE_EVALUATION_PRECEDES_CAPTURE');
  for (const policy of Object.values(evidence.policies)) {
    if (policy.mode === 'inline') check(digest(policy.body) === policy.hash, 'binding', 'POLICY_DIGEST_MISMATCH');
  }
  const horizon = new Date(`${day}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() - 90);
  const start = [candidate.state.growth.startDate, horizon.toISOString().slice(0, 10)].sort().at(-1);
  return Object.freeze({ day, cutoff, startAt: `${start}T00:00:00Z`, scopeId, repositoryIds: [...repositoryIds] });
}
