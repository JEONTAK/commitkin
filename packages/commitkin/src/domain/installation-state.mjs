import { digest, scopeDigest } from '../../../record-validator/src/domain/hash.js';
import { normalizeSettings } from './settings.mjs';
import { compareTimestamps, shiftDate } from './character/activity.mjs';

const ID = /^[1-9][0-9]*$/;
const SHA = /^[a-f0-9]{40}$/;
const TRACKING = ['active', 'excluded', 'unavailable', 'outside_public_scope'];
const SOURCES = ['automatic', 'additional'];
function requireThat(condition, code) { if (!condition) throw new TypeError(code); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function canonicalId(value) { return typeof value === 'string' && ID.test(value); }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
function sources(value) { return Array.isArray(value) && value.length > 0 && value.length <= 2 && new Set(value).size === value.length && value.every(item => SOURCES.includes(item)); }
function exact(value, keys) { return plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function indexed(rows, validate, code) {
  requireThat(Array.isArray(rows), code);
  const result = new Map();
  for (const row of rows) { requireThat(validate(row) && !result.has(row.id), code); result.set(row.id, row); }
  return result;
}
function unionSources(...lists) { const all = new Set(lists.flat()); return SOURCES.filter(source => all.has(source)); }
function numericOrder(left, right) { return BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0; }

/** Preserve tracking continuity without rewriting historical ownership or storing names. */
export function reconcileRepositoryTracking({ previousRows, repositories, tracked, subjectAccountId, observedAt }) {
  requireThat(canonicalId(subjectAccountId) && timestamp(observedAt), 'TRACKING_CONTEXT_INVALID');
  const previous = indexed(previousRows, row => exact(row, ['id', 'firstObservedAt', 'ownershipAtFirstObservation', 'tracking', 'discoveredVia']) && canonicalId(row.id) && timestamp(row.firstObservedAt) && compareTimestamps(row.firstObservedAt, observedAt) <= 0 && ['self', 'other'].includes(row.ownershipAtFirstObservation) && TRACKING.includes(row.tracking) && sources(row.discoveredVia), 'TRACKING_PREVIOUS_INVALID');
  const metadata = indexed(repositories, row => plain(row) && canonicalId(row.id) && canonicalId(row.ownerAccountId) && ['public', 'private', 'internal'].includes(row.visibility) && sources(row.discoveredVia), 'TRACKING_METADATA_INVALID');
  const continuity = indexed(tracked, row => exact(row, ['id', 'tracking', 'discoveredVia']) && canonicalId(row.id) && TRACKING.includes(row.tracking) && sources(row.discoveredVia), 'TRACKING_CURRENT_INVALID');
  for (const row of metadata.values()) {
    const known = continuity.get(row.id);
    requireThat(known && (known.tracking !== 'active' || row.visibility === 'public'), 'TRACKING_METADATA_CONTRADICTION');
  }
  const output = [];
  for (const before of previous.values()) {
    const current = continuity.get(before.id); const detail = metadata.get(before.id);
    output.push({ ...structuredClone(before), tracking: current?.tracking ?? before.tracking,
      discoveredVia: unionSources(before.discoveredVia, current?.discoveredVia ?? [], detail?.discoveredVia ?? []) });
  }
  for (const current of continuity.values()) {
    if (previous.has(current.id)) continue;
    // Unknown historical ownership must not be guessed for a never-analyzed
    // excluded/private/unavailable target. Existing rows above always survive.
    if (current.tracking !== 'active') continue;
    const detail = metadata.get(current.id);
    requireThat(detail && detail.visibility === 'public', 'TRACKING_NEW_METADATA_REQUIRED');
    output.push({ id: current.id, firstObservedAt: observedAt, ownershipAtFirstObservation: detail.ownerAccountId === subjectAccountId ? 'self' : 'other', tracking: 'active', discoveredVia: unionSources(current.discoveredVia, detail.discoveredVia) });
  }
  return output.sort(numericOrder);
}

function hold(code) { return { decision: 'hold', code, snapshot: null, progressionAuthorized: false, publicationAuthorized: false }; }

/**
 * Pure pending-snapshot preparation after trusted installation acquisition.
 * Flags are evidence from that application boundary, not authentication gained
 * by this function or permission to write a real record or publish a character.
 */
export function prepareInitialSnapshot({ installation, discovery, settings, settingsFileUsed, startedAt, evaluatedAt }) {
  try {
    requireThat(plain(installation) && installation.decision === 'acquired' && installation.firstInstallVerified === true && installation.initialAssignmentVerified === true &&
      installation.provenance?.source === 'fixed-head-repository-read' && installation.provenance.historyScope === 'reachable-default-branch-at-expected-head' &&
      installation.provenance.expectedHead === installation.expectedHead && SHA.test(installation.expectedHead ?? '') && SHA.test(installation.provenance.treeSha ?? '') &&
      exact(installation.expectedOwner, ['accountId', 'profileRepositoryId']) && canonicalId(installation.expectedOwner.accountId) && canonicalId(installation.expectedOwner.profileRepositoryId) &&
      exact(installation.records, ['state', 'ledger', 'status']) && Object.values(installation.records).every(value => value === null), 'INITIAL_INSTALLATION_UNVERIFIED');
    const owner = structuredClone(installation.expectedOwner);
    requireThat(installation.repository?.id === owner.profileRepositoryId && installation.repository.ownerAccountId === owner.accountId && installation.repository.visibility === 'public', 'INITIAL_OWNER_MISMATCH');
    requireThat(exact(installation.initialSelection, ['accountId', 'factionId']) && installation.initialSelection.accountId === owner.accountId && ['bloomguard', 'ashbound'].includes(installation.initialSelection.factionId), 'INITIAL_SELECTION_INVALID');
    requireThat(timestamp(startedAt) && timestamp(evaluatedAt) && compareTimestamps(startedAt, evaluatedAt) <= 0, 'INITIAL_TIME_INVALID');
    requireThat(typeof settingsFileUsed === 'boolean' && installation.settingsFileUsed === settingsFileUsed, 'INITIAL_SETTINGS_PROVENANCE_INVALID');
    requireThat(plain(discovery) && discovery.decision === 'ready' && Array.isArray(discovery.codes) && discovery.codes.length === 0, 'INITIAL_DISCOVERY_INCOMPLETE');
    const normalized = normalizeSettings(settings);
    requireThat(settingsFileUsed || normalized.repositories.additional.length === 0 && normalized.repositories.exclude.length === 0, 'INITIAL_SETTINGS_PROVENANCE_INVALID');
    requireThat(Array.isArray(discovery.tracked) && discovery.tracked.every(row => row?.tracking !== 'unavailable'), 'INITIAL_DISCOVERY_INCOMPLETE');
    const rows = reconcileRepositoryTracking({ previousRows: [], repositories: discovery.repositories, tracked: discovery.tracked, subjectAccountId: owner.accountId, observedAt: evaluatedAt });
    const repositoryIds = rows.filter(row => row.tracking === 'active').map(row => row.id);
    const scopeBody = { rulesetVersion: '1.0.0', analysisConfigHash: digest({ rulesetVersion: '1.0.0', publicOnly: true }), repositoryIds };
    const scope = { id: scopeDigest(scopeBody), ...scopeBody };
    const date = startedAt.slice(0, 10); const startDate = shiftDate(date, -90);
    const ledger = { schemaVersion: 1, recordType: 'ledger', rulesetVersion: '1.0.0', recordRevision: 1, owner: structuredClone(owner), repositories: rows, scopes: [scope], coverage: [], facts: [], days: [], corrections: [] };
    const state = {
      schemaVersion: 1, recordType: 'state', rulesetVersion: '1.0.0', recordRevision: 1, owner: structuredClone(owner),
      faction: { id: installation.initialSelection.factionId, confirmedAt: startedAt },
      growth: { phase: 'pending', startDate, totalXp: null }, class: null,
      traits: { habit: { currentId: null, pending: null }, activity: { currentId: null, pending: null } },
      observationClock: { lastNormalEvaluationOn: null, classLastCountedOn: null, habitLastCountedOn: null, activityLastCountedOn: null }, achievements: [],
      settings: { filePreviouslyUsed: settingsFileUsed, lastAcceptedHash: digest(normalized) }, evaluation: null, integrity: { ledgerHash: digest(ledger) },
    };
    const status = { schemaVersion: 1, recordType: 'status', rulesetVersion: '1.0.0', recordRevision: 1, owner: structuredClone(owner), lastSuccessfulRevision: null, state: 'analysis_pending', reasonCode: 'INITIAL_ANALYSIS_PENDING', changedAt: evaluatedAt, collectionPending: [{ startDate, endDateExclusive: date, scopeId: scope.id }], unobservedGaps: [] };
    return { decision: 'prepared', code: 'PENDING_INITIAL_SNAPSHOT_PREPARED', snapshot: { state, ledger, status }, scopeId: scope.id, expectedOwner: owner, expectedHead: installation.expectedHead, firstInstallVerified: true, initialAssignmentVerified: true, sourceAuthenticity: 'not_checked', progressionAuthorized: false, publicationAuthorized: false };
  } catch (error) {
    const codes = new Set(['INITIAL_INSTALLATION_UNVERIFIED', 'INITIAL_OWNER_MISMATCH', 'INITIAL_SELECTION_INVALID', 'INITIAL_TIME_INVALID', 'INITIAL_SETTINGS_PROVENANCE_INVALID', 'INITIAL_DISCOVERY_INCOMPLETE', 'TRACKING_CONTEXT_INVALID', 'TRACKING_PREVIOUS_INVALID', 'TRACKING_METADATA_INVALID', 'TRACKING_CURRENT_INVALID', 'TRACKING_METADATA_CONTRADICTION', 'TRACKING_NEW_METADATA_REQUIRED', 'SETTINGS_INVALID']);
    return hold(codes.has(error?.message) ? error.message : 'INITIAL_SNAPSHOT_INPUT_INVALID');
  }
}
