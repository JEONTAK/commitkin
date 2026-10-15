import { ValidationFailure, failureReport } from '../domain/failure.js';
import { checkBundle } from '../domain/bundle-checks.js';
import { checkTransition } from '../domain/transition-checks.js';

const ROLES = ['state', 'ledger', 'status'];
const UNCHECKED = Object.freeze([
  'github_owner_authenticity', 'source_eligibility_and_completeness',
  'source_identity_and_reward_order', 'growth_class_trait_achievement_eligibility',
  'historical_snapshot_authenticity', 'settings_source_verification',
  'initial_assignment_provenance', 'correction_authorization',
]);

function compatible(record) {
  if (!record || typeof record !== 'object' || !Object.hasOwn(record, 'schemaVersion')) throw new ValidationFailure('compatibility', 'RECORD_VERSION_MISSING');
  if (Number.isInteger(record.schemaVersion) && record.schemaVersion > 1) throw new ValidationFailure('compatibility', 'UPDATE_REQUIRED', 'preserve');
  if (record.schemaVersion !== 1) throw new ValidationFailure('compatibility', 'UNSUPPORTED_SCHEMA', 'preserve');
  if (record.rulesetVersion !== '1.0.0') throw new ValidationFailure('compatibility', 'UNSUPPORTED_RULESET', 'preserve');
}

function checkContext(context, schema) {
  if (!context || !context.expectedOwner || Object.keys(context).some(key => !['expectedOwner', 'now', 'operation', 'evaluationStartedAt'].includes(key)) ||
    !schema.validateReference('urn:commitkin:schemas:v1:common#/$defs/owner', context.expectedOwner) ||
    !schema.validateReference('urn:commitkin:schemas:v1:common#/$defs/utcTimestamp', context.now) ||
    (context.evaluationStartedAt !== undefined && (!schema.validateReference('urn:commitkin:schemas:v1:common#/$defs/utcTimestamp', context.evaluationStartedAt) || Date.parse(context.evaluationStartedAt) > Date.parse(context.now))) ||
    !['normal', 'failed-collection', 'metadata-only', 'status-only'].includes(context.operation ?? 'normal')) {
    throw new ValidationFailure('input', 'VALIDATION_CONTEXT_INVALID');
  }
}

function inspectInputs(inputs, context, ports) {
  const records = {};
  let statusFailure = null;
  for (const role of ROLES) {
    if (!inputs || inputs[role] == null) {
      if (role === 'status') { records.status = null; continue; }
      throw new ValidationFailure('raw', 'RECORD_MISSING');
    }
    try { records[role] = ports.parse(inputs[role], role); }
    catch (error) {
      if (role !== 'status') throw error;
      statusFailure = error; records.status = null;
    }
  }
  for (const role of ROLES) {
    if (role === 'status' && (inputs[role] == null || statusFailure)) continue;
    compatible(records[role]);
  }
  for (const role of ROLES) {
    if (records[role] === null) continue;
    if (!ports.schema.validate(role, records[role])) {
      const error = new ValidationFailure('schema', 'SCHEMA_INVALID');
      if (role !== 'status') throw error;
      statusFailure = error; records.status = null;
    }
  }
  checkBundle(records, context);
  // A damaged status is not a replacement valid status. Offer only a read-only
  // repair hint after the supported primary pair passes every record check.
  if (statusFailure) return { records, statusFailure };
  return { records, statusFailure: null };
}

export function createRecordValidator(ports) {
  return function validateRecords(inputs, context, previousInputs = null) {
    const result = {
      reportVersion: 1, recordValid: false, transitionGuards: 'not_checked',
      progressionAuthorized: false, statusRepairAllowed: false,
      notChecked: [...UNCHECKED],
    };
    try {
      checkContext(context, ports.schema);
      const normalizedContext = { ...context, operation: context.operation ?? 'normal' };
      const candidate = inspectInputs(inputs, normalizedContext, ports);
      if (candidate.statusFailure) return { ...result, ...failureReport(candidate.statusFailure), statusRepairAllowed: true };
      result.recordValid = true;
      if (previousInputs !== null) {
        const previous = inspectInputs(previousInputs, normalizedContext, ports);
        if (previous.statusFailure) throw new ValidationFailure('transition', 'PREVIOUS_RECORD_INVALID');
        result.transitionCode = checkTransition(previous.records, candidate.records, normalizedContext);
        result.transitionGuards = 'passed';
      } else result.notChecked.push('previous_to_candidate_transition');
      if (!candidate.records.status) return { ...result, stage: 'decision', code: 'STATUS_REBUILD_ALLOWED', decision: 'status-only-recovery', statusRepairAllowed: true };
      const state = candidate.records.status.state;
      if (state === 'ok') return { ...result, stage: 'decision', code: 'ACCEPT', decision: 'accept' };
      if (state === 'analysis_pending') return { ...result, stage: 'decision', code: 'ANALYSIS_PENDING', decision: 'hold' };
      return { ...result, stage: 'decision', code: 'RETAIN_SUCCESS', decision: 'preserve' };
    } catch (error) {
      if (previousInputs !== null && result.recordValid) result.transitionGuards = 'rejected';
      return { ...result, ...failureReport(error) };
    }
  };
}
