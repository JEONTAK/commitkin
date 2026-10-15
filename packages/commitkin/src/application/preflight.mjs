import { PreflightFailure, requirePreflight as check } from '../domain/preflight/failure.mjs';
import { checkContextClock, checkBindings } from '../domain/preflight/bindings.mjs';
import { checkReferences } from '../domain/preflight/references.mjs';
import { checkRequiredCollections, checkCollectionClosure } from '../domain/preflight/collections.mjs';

const UNCHECKED = Object.freeze([
  'sourceEligibility', 'coverageConsistency', 'rewardOrder', 'rewardAllocation',
  'sourceAuthenticity', 'policyCatalogSemantics', 'historicalProofSufficiency',
  'sourceRevisionAuthenticity', 'settingsSourceVerification', 'githubOwnerAuthenticity',
]);
const STEPS = Object.freeze([
  'input', 'compatibility', 'contextSchema', 'evidenceSchema', 'catalogShape',
  'recordSafety', 'contextBinding', 'references', 'requiredCollections', 'captureClosure',
]);

function raw(bytes, role, parse) {
  try { return parse(bytes, role); }
  catch (error) {
    const allowed = new Set(['INPUT_INVALID', 'INPUT_TOO_LARGE', 'INPUT_TOO_DEEP', 'INVALID_UTF8', 'DUPLICATE_OBJECT_KEY', 'INVALID_UNICODE', 'JSON_NON_FINITE', 'JSON_SYNTAX']);
    throw new PreflightFailure('input', allowed.has(error.code) ? error.code : 'INPUT_INVALID');
  }
}

function compatibility(context, evidence) {
  const unsupported = (value, expected, type) => typeof value === type && value !== expected;
  const interpreters = [context?.expected, evidence];
  if (unsupported(context?.contextVersion, 1, 'number') && Number.isInteger(context.contextVersion)) throw new PreflightFailure('compatibility', 'COMPATIBLE_TOOL_REQUIRED', 'hold');
  for (const v of interpreters) {
    const unsupportedVersion = unsupported(v?.evidenceVersion, 1, 'number') && Number.isInteger(v.evidenceVersion);
    if (unsupportedVersion || unsupported(v?.rulesetVersion, '1.0.0', 'string') || unsupported(v?.adapter?.id, 'github.com', 'string') || unsupported(v?.adapter?.version, '1', 'string')) {
      throw new PreflightFailure('compatibility', 'COMPATIBLE_TOOL_REQUIRED', 'hold');
    }
  }
}

const parsedBundle = (bytes, parse) => Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, raw(bytes[role], role, parse)]));

/** Read-only local preflight. Passing never authorizes growth or authenticates sources. */
export function createPreflightUseCase({ parse, schema, validateRecords }) {
  return function validatePreflight(input) {
    const result = {
      reportVersion: 1, reportType: 'evidence-preflight',
      checks: Object.fromEntries(STEPS.map(step => [step, 'not_checked'])),
      sourceAuthenticity: 'not_checked', progressionAuthorized: false, notChecked: [...UNCHECKED],
    };
    try {
      check(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => ['context', 'evidence', 'candidate', 'previous'].includes(key)), 'input', 'INPUT_ARGUMENTS_INVALID');
      const context = raw(input.context, 'status', parse);
      const evidence = raw(input.evidence, 'ledger', parse);
      result.checks.input = 'passed';
      compatibility(context, evidence); result.checks.compatibility = 'passed';
      check(schema.validate('context', context), 'context-schema', 'CONTEXT_SCHEMA_INVALID'); result.checks.contextSchema = 'passed';
      check(schema.validate('evidence', evidence), 'evidence-schema', 'EVIDENCE_SCHEMA_INVALID'); result.checks.evidenceSchema = 'passed';
      check(schema.validate('preflight', evidence), 'catalog-shape', 'CATALOG_SHAPE_INVALID'); result.checks.catalogShape = 'passed';
      checkContextClock(context);
      const previousInput = input.previous ?? null;
      const recordContext = { expectedOwner: context.expected.subject, now: context.evaluation.inspectedAt, evaluationStartedAt: context.evaluation.startedAt, operation: 'normal' };
      const recordReport = validateRecords(input.candidate, recordContext, previousInput);
      result.recordReport = recordReport;
      result.notChecked = [...new Set([...result.notChecked, ...recordReport.notChecked])];
      if (recordReport.statusRepairAllowed) throw new PreflightFailure('record', 'RECORD_REPAIR_REQUIRED', 'hold');
      if (recordReport.code !== 'ACCEPT' || recordReport.decision !== 'accept') {
        const hold = ['UPDATE_REQUIRED', 'UNSUPPORTED_SCHEMA', 'UNSUPPORTED_RULESET', 'ANALYSIS_PENDING', 'RETAIN_SUCCESS', 'VALIDATOR_UNAVAILABLE'].includes(recordReport.code);
        throw new PreflightFailure('record', 'RECORD_CHECK_FAILED', hold ? 'hold' : 'rejected');
      }
      result.checks.recordSafety = 'passed';
      const candidate = parsedBundle(input.candidate, parse);
      const previous = previousInput ? parsedBundle(previousInput, parse) : null;
      const scope = checkBindings(context, evidence, candidate, previous); result.checks.contextBinding = 'passed';
      const index = checkReferences(evidence); result.checks.references = 'passed';
      const required = checkRequiredCollections(evidence, scope, index); result.checks.requiredCollections = 'passed';
      checkCollectionClosure(evidence, required); result.checks.captureClosure = 'passed';
      return { ...result, stage: 'complete', code: 'PREFLIGHT_PASSED', decision: 'preflight_passed' };
    } catch (error) {
      if (error instanceof PreflightFailure) return { ...result, stage: error.stage, code: error.code, decision: error.decision };
      return { ...result, stage: 'internal', code: 'PREFLIGHT_UNAVAILABLE', decision: 'hold' };
    }
  };
}
