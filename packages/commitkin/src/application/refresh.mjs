import { digest } from '../../../record-validator/src/domain/hash.js';
import { bundleBytes, scopeFor } from './evaluate.mjs';
import { checkReferences } from '../domain/preflight/references.mjs';
import { checkRequiredCollections, checkCollectionClosure } from '../domain/preflight/collections.mjs';
import { qualifyEvidence } from '../domain/evidence/qualify.mjs';
import { prepareInitialSnapshot, reconcileRepositoryTracking } from '../domain/installation-state.mjs';
import { compareTimestamps } from '../domain/character/activity.mjs';

const bytes = value => Buffer.from(JSON.stringify(value));
const defaults = { version: 1, repositories: { additional: [], exclude: [] } };
const shift = (date, offset) => new Date(Date.parse(date + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const held = (stage, code) => ({ decision: 'hold', stage, code, files: null, preservePrevious: true, progressionAuthorized: false, published: false });

/**
 * Trusted acquisition is supplied by composition, never by a JSON trust flag.
 * This use case prepares bytes only. It has no filesystem or publication port.
 */
export function createRefreshUseCase(ports) {
  return async function prepareRefresh({ workflowContext, initialSelection = null }) {
    try {
      const installation = await ports.acquire({ workflowContext, initialSelection });
      if (installation.decision !== 'acquired') return held('installation', installation.code);
      if (installation.readmeBytes === null) return held('readme', 'README_CONNECTION_REQUIRED');
      const originalReadme = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(installation.readmeBytes);
      // Validate the user's connection before expensive discovery/collection.
      ports.updateReadme(originalReadme, 'Analysis pending');
      const previous = installation.firstInstallVerified ? null : Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, ports.parse(installation.records[role], role)]));
      const settings = ports.parseSettings(installation.settingsBytes, {
        previouslyUsed: previous?.state.settings.filePreviouslyUsed ?? false,
        firstInstallVerified: installation.firstInstallVerified,
        defaultsPreviouslyAccepted: previous?.state.settings.filePreviouslyUsed === false && previous.state.settings.lastAcceptedHash === digest(defaults),
      });
      const discovery = await ports.discover({ login: installation.login, subjectAccountId: installation.expectedOwner.accountId, additional: settings.repositories.additional, exclude: settings.repositories.exclude, tracked: previous?.ledger.repositories ?? [] });
      if (discovery.decision !== 'ready') return held('discovery', discovery.code);
      const startedAt = workflowContext.startedAt, cutoffDate = startedAt.slice(0, 10);
      const initial = previous ? null : prepareInitialSnapshot({ installation, discovery, settings, settingsFileUsed: installation.settingsFileUsed, startedAt, evaluatedAt: ports.clock() });
      if (initial && initial.decision !== 'prepared') return held('initialization', initial.code);
      const base = previous ?? initial.snapshot;
      const reservePending = code => {
        if (!initial || !ports.reserveInitialPending || typeof ports.presentPending !== 'function') return null;
        const files = ports.presentPending({ candidate: base, username: installation.login, originalReadme });
        return { decision: 'pending', stage: 'initialization', code: 'INITIAL_FACTION_RESERVED_ANALYSIS_PENDING', causeCode: code, files, candidate: base,
          repository: installation.repository.fullName, owner: installation.expectedOwner, defaultBranch: installation.defaultBranch, expectedHead: installation.expectedHead,
          summary: { firstInstallation: true, classId: null, totalXp: null, deltaXp: '0', knownRepositories: discovery.repositories.length },
          verification: { decision: 'initial_pending_reservation', initialConfirmation: 'verified', growthAnalysis: 'not_checked' }, sourceModel: ports.sourceModel, sourceAuthenticity: 'not_checked', progressionAuthorized: false, published: false };
      };
      const startDate = [base.state.growth.startDate, shift(cutoffDate, -90)].sort().at(-1);
      const repositoryIds = scopeFor(discovery.repositories.map(repo => repo.id)).repositoryIds;
      const captured = await ports.collect({ repositories: discovery.repositories, subjectAccountId: installation.expectedOwner.accountId, startDate, cutoffDate });
      if (captured.decision !== 'ready') return reservePending(captured.code) ?? held('collection', captured.code);
      const completedAt = ports.clock();
      if (typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt)) || compareTimestamps(completedAt, startedAt) < 0) return held('clock', 'EVALUATION_TIME_INVALID');
      const context = { contextVersion: 1, operation: 'normal', expected: { subject: installation.expectedOwner, evidenceVersion: 1, rulesetVersion: '1.0.0', adapter: { id: 'github.com', version: '1' } }, evaluation: { startedAt, inspectedAt: completedAt }, normalizedSettings: settings, scope: { repositoryIds }, comparison: { mode: 'with_previous' } };
      let evidence = null, qualification;
      if (ports.qualifyCapture) {
        const capturedIds = captured.capture?.repositories?.map(row => row.repositoryId).sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
        if (JSON.stringify(capturedIds) !== JSON.stringify(repositoryIds)) return held('qualification', 'CAPTURE_SCOPE_MISMATCH');
        qualification = ports.qualifyCapture({ capture: captured.capture, subjectAccountId: installation.expectedOwner.accountId, growthStartDate: base.state.growth.startDate, cutoffDate, previousLedger: previous?.ledger ?? null, policyRegistry: ports.policyRegistry });
        if (qualification.sourceModel !== ports.sourceModel) return held('qualification', 'SOURCE_MODEL_MISMATCH');
      } else {
      const adapted = ports.adapt({ capture: captured.capture, context, candidateLedgerHash: digest(base.ledger), previousLedgerHash: digest(base.ledger), policies: ports.policyDescriptors, capturedAt: completedAt });
      if (adapted.decision !== 'adapted') return held('adaptation', adapted.code);
      evidence = adapted.evidence;
      if (bytes(evidence).length > 33554432 || !ports.schema.validate('context', context) || !ports.schema.validate('evidence', evidence) || !ports.schema.validate('preflight', evidence)) return held('schema', 'ACQUIRED_EVIDENCE_INVALID');
      // Independent closure before eligibility: final record bindings are checked
      // after the candidate exists, not trusted from this temporary ledger hash.
      const index = checkReferences(evidence);
      const scope = { repositoryIds, subjectAccountId: installation.expectedOwner.accountId, startAt: startDate + 'T00:00:00Z', cutoff: cutoffDate + 'T00:00:00Z' };
      checkCollectionClosure(evidence, checkRequiredCollections(evidence, scope, index));
      qualification = qualifyEvidence({ evidence, context, previousLedger: previous?.ledger ?? null, policyRegistry: ports.policyRegistry, growthStartDate: base.state.growth.startDate });
      }
      if (qualification.decision !== 'qualified') return (qualification.decision === 'hold' ? reservePending(qualification.code) : null) ?? held('qualification', qualification.code);
      const priorKeys = new Set(base.ledger.facts.map(fact => fact.eventKey));
      const repositoryRows = reconcileRepositoryTracking({ previousRows: base.ledger.repositories, repositories: discovery.repositories, tracked: discovery.tracked, subjectAccountId: installation.expectedOwner.accountId, observedAt: completedAt });
      const evaluated = ports.evaluate({ previous: base, expectedOwner: installation.expectedOwner, activities: qualification.activities, priorActivities: qualification.activities.filter(item => priorKeys.has(item.fact.eventKey)), reviewHistoryFacts: qualification.reviewHistoryFacts, repositoryIds, repositoryRows, settings, settingsFileUsed: installation.settingsFileUsed, evaluationStartedAt: startedAt, evaluatedAt: completedAt, initialAssignmentVerified: installation.initialAssignmentVerified });
      if (!['proposed', 'unchanged'].includes(evaluated.decision)) return held('evaluation', evaluated.code);
      const summary = { firstInstallation: installation.firstInstallVerified, classId: evaluated.candidate.state.class.id, totalXp: evaluated.candidate.state.growth.totalXp, deltaXp: evaluated.deltaXp, knownRepositories: repositoryIds.length };
      // A same-date no-op is not a newly evaluated historical snapshot. Its old
      // successful timestamp must stay old; do not relabel it as after this new
      // capture just to pass a new-candidate binding check. Nothing is published.
      if (evaluated.decision === 'unchanged') return { decision: 'unchanged', stage: 'complete', code: 'REPLAY_UNCHANGED', files: [], candidate: evaluated.candidate, summary,
        verification: { decision: 'not_required', code: 'NO_NEW_CANDIDATE', sourceEligibility: 'passed', newCandidateBinding: 'not_checked' }, sourceAuthenticity: 'not_checked', progressionAuthorized: false, published: false };
      if (evidence) evidence.binding.candidateLedgerHash = digest(evaluated.candidate.ledger);
      // Status-only recovery likewise retains the primary successful snapshot.
      // Its original safety gate plus qualified no-change settlement owns this
      // path; it is not presented as a fresh source/reward candidate validation.
      const statusOnly = evaluated.code === 'LOCAL_STATUS_READY';
      const verification = statusOnly ? { decision: 'not_required', code: 'PRIMARY_SNAPSHOT_UNCHANGED', sourceEligibility: 'passed', newCandidateBinding: 'not_checked' } : ports.verifyCandidate ? ports.verifyCandidate({ context, candidate: evaluated.candidate, previous: base, qualification }) : ports.verify({ context: bytes(context), evidence: bytes(evidence), candidate: bundleBytes(evaluated.candidate), previous: bundleBytes(base) });
      if (!statusOnly && !['accept_relative_to_evidence', 'accept_relative_to_capture'].includes(verification.decision)) return held('verification', verification.code);
      const files = ports.present({ candidate: evaluated.candidate, username: installation.login, classificationReason: evaluated.character.classificationReason, originalReadme });
      return { decision: evaluated.decision === 'unchanged' ? 'unchanged' : 'prepared', stage: 'complete', code: 'DRY_RUN_READY', files, candidate: evaluated.candidate,
        repository: installation.repository.fullName, owner: installation.expectedOwner, defaultBranch: installation.defaultBranch, expectedHead: installation.expectedHead,
        summary, verification, sourceModel: ports.sourceModel ?? 'github-public-historical-v1', sourceAuthenticity: 'not_checked', progressionAuthorized: false, published: false };
    } catch (error) {
      const allowed = new Set(['README_CONNECTION_REQUIRED', 'README_INPUT_INVALID', 'SETTINGS_CONFIRMATION_REQUIRED', 'SETTINGS_INVALID', 'SETTINGS_UTF8_INVALID', 'SETTINGS_DUPLICATE', 'SETTINGS_INPUT_INVALID', 'REQUIRED_COLLECTION_NOT_COLLECTED', 'REQUIRED_COLLECTION_FAILED', 'REQUIRED_COLLECTION_TRUNCATED_OR_UNKNOWN', 'NEXT_PAGE_MISSING', 'COLLECTION_TERMINATION_UNKNOWN']);
      return held('preparation', allowed.has(error?.code ?? error?.message) ? error.code ?? error.message : 'REFRESH_PREPARATION_UNAVAILABLE');
    }
  };
}
