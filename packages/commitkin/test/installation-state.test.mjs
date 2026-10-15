import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInitialSnapshot, reconcileRepositoryTracking } from '../src/domain/installation-state.mjs';
import { createValidator } from '../../record-validator/src/index.js';
import { digest, scopeDigest } from '../../record-validator/src/domain/hash.js';

const HEAD = 'a'.repeat(40); const TREE = 'b'.repeat(40); const START = '2026-10-15T23:50:00Z'; const AT = '2026-10-16T00:05:00Z';
const settings = { version: 1, repositories: { additional: [], exclude: [] } };
function installation() {
  return { decision: 'acquired', firstInstallVerified: true, initialAssignmentVerified: true, expectedOwner: { accountId: '1001', profileRepositoryId: '9001' }, expectedHead: HEAD,
    records: { state: null, ledger: null, status: null }, repository: { id: '9001', ownerAccountId: '1001', visibility: 'public' }, initialSelection: { accountId: '1001', factionId: 'bloomguard' }, settingsFileUsed: false,
    provenance: { source: 'fixed-head-repository-read', expectedHead: HEAD, treeSha: TREE, historyScope: 'reachable-default-branch-at-expected-head' } };
}
const metadata = (id = '9001', ownerAccountId = '1001', extra = {}) => ({ id, ownerAccountId, visibility: 'public', discoveredVia: ['automatic'], ...extra });
const tracked = (id = '9001', tracking = 'active', extra = {}) => ({ id, tracking, discoveredVia: ['automatic'], ...extra });
const discovery = () => ({ decision: 'ready', codes: [], repositories: [metadata()], tracked: [tracked()] });
const options = (extra = {}) => ({ installation: installation(), discovery: discovery(), settings, settingsFileUsed: false, startedAt: START, evaluatedAt: AT, ...extra });
const previous = (extra = {}) => ({ id: '9001', firstObservedAt: '2026-09-01T00:00:00Z', ownershipAtFirstObservation: 'self', tracking: 'active', discoveredVia: ['automatic'], ...extra });
const reconcile = (extra = {}) => reconcileRepositoryTracking({ previousRows: [previous()], repositories: [metadata()], tracked: [tracked()], subjectAccountId: '1001', observedAt: AT, ...extra });
const validate = createValidator();

test('prepared initial records match the approved v1 pending bundle and existing validator', () => {
  const result = prepareInitialSnapshot(options()); assert.equal(result.decision, 'prepared');
  const { state, ledger, status } = result.snapshot;
  assert.equal(state.recordRevision, 1); assert.equal(ledger.recordRevision, 1); assert.equal(status.recordRevision, 1);
  assert.equal(state.growth.startDate, '2026-07-17'); assert.equal(state.growth.totalXp, null); assert.equal(state.class, null); assert.equal(state.evaluation, null);
  assert.equal(state.faction.confirmedAt, START); assert.deepEqual(ledger.coverage, []); assert.deepEqual(ledger.facts, []); assert.deepEqual(ledger.days, []); assert.deepEqual(state.achievements, []);
  assert.equal(status.state, 'analysis_pending'); assert.equal(status.lastSuccessfulRevision, null); assert.equal(status.collectionPending[0].endDateExclusive, '2026-10-15');
  const bytes = Object.fromEntries(Object.entries(result.snapshot).map(([role, value]) => [role, Buffer.from(JSON.stringify(value))]));
  const report = validate(bytes, { expectedOwner: result.expectedOwner, now: AT, operation: 'normal', evaluationStartedAt: START });
  assert.equal(report.code, 'ANALYSIS_PENDING'); assert.equal(report.recordValid, true); assert.equal(result.publicationAuthorized, false); assert.equal(result.progressionAuthorized, false);
});
test('D remains frozen at startedAt when preparation completes after UTC midnight', () => {
  const result = prepareInitialSnapshot(options());
  assert.equal(result.snapshot.state.growth.startDate, '2026-07-17'); assert.equal(result.snapshot.status.collectionPending[0].endDateExclusive, '2026-10-15');
});
test('hashes use exact normalized settings, fixed public-only projection and numerically ordered stable IDs', () => {
  const input = options({ discovery: { decision: 'ready', codes: [], repositories: [metadata('20'), metadata('3')], tracked: [tracked('20'), tracked('3')] }, settingsFileUsed: true });
  input.installation.settingsFileUsed = true;
  input.settings = { version: 1, repositories: { additional: ['Z/Repo', 'a/b', 'z/repo'], exclude: ['z/repo'] } };
  const result = prepareInitialSnapshot(input); assert.equal(result.decision, 'prepared');
  const { state, ledger } = result.snapshot; assert.deepEqual(ledger.scopes[0].repositoryIds, ['3', '20']);
  assert.equal(state.settings.lastAcceptedHash, digest({ version: 1, repositories: { additional: ['a/b', 'z/repo'], exclude: ['z/repo'] } }));
  assert.equal(ledger.scopes[0].analysisConfigHash, digest({ rulesetVersion: '1.0.0', publicOnly: true }));
  assert.equal(ledger.scopes[0].id, scopeDigest(ledger.scopes[0])); assert.equal(state.integrity.ledgerHash, digest(ledger));
});
test('empty effective scope is valid and never silently inserts the profile storage repository', () => {
  const result = prepareInitialSnapshot(options({ discovery: { decision: 'ready', codes: [], repositories: [], tracked: [] } }));
  assert.equal(result.decision, 'prepared'); assert.deepEqual(result.snapshot.ledger.repositories, []); assert.deepEqual(result.snapshot.ledger.scopes[0].repositoryIds, []);
  const bytes = Object.fromEntries(Object.entries(result.snapshot).map(([role, value]) => [role, Buffer.from(JSON.stringify(value))]));
  assert.equal(validate(bytes, { expectedOwner: result.expectedOwner, now: AT }).code, 'ANALYSIS_PENDING');
});
test('bare missing files or first-use flags without trusted acquisition provenance cannot initialize', () => {
  for (const patch of [{ decision: 'hold' }, { firstInstallVerified: false }, { initialAssignmentVerified: false }, { provenance: {} }, { records: {} }, { records: { state: null, ledger: {}, status: null } }]) {
    const input = options(); Object.assign(input.installation, patch); assert.equal(prepareInitialSnapshot(input).code, 'INITIAL_INSTALLATION_UNVERIFIED');
  }
});
test('actual owner binding and permanent manual selection must agree with acquired metadata', () => {
  const wrongOwner = options(); wrongOwner.installation.repository.ownerAccountId = '999'; assert.equal(prepareInitialSnapshot(wrongOwner).code, 'INITIAL_OWNER_MISMATCH');
  for (const selection of [{ accountId: '999', factionId: 'bloomguard' }, { accountId: '1001', factionId: 'random' }, { accountId: '1001', factionId: 'ashbound', reset: true }]) {
    const input = options(); input.installation.initialSelection = selection; assert.equal(prepareInitialSnapshot(input).code, 'INITIAL_SELECTION_INVALID');
  }
});
test('invalid or reversed clocks cannot silently choose a different growth start', () => {
  for (const clock of [{ startedAt: '2026-02-30T00:00:00Z' }, { evaluatedAt: '2026-10-15T23:49:59Z' }, { startedAt: '2026-10-15T23:50:00.0000002Z', evaluatedAt: '2026-10-15T23:50:00.0000001Z' }]) assert.equal(prepareInitialSnapshot(options(clock)).code, 'INITIAL_TIME_INVALID');
});
test('partial discovery or a missing-used-settings mismatch holds without a candidate', () => {
  assert.equal(prepareInitialSnapshot(options({ discovery: { ...discovery(), decision: 'hold' } })).code, 'INITIAL_DISCOVERY_INCOMPLETE');
  assert.equal(prepareInitialSnapshot(options({ discovery: { ...discovery(), codes: ['ACCESS_DENIED'] } })).code, 'INITIAL_DISCOVERY_INCOMPLETE');
  assert.equal(prepareInitialSnapshot(options({ settingsFileUsed: true })).code, 'INITIAL_SETTINGS_PROVENANCE_INVALID');
  assert.equal(prepareInitialSnapshot(options({ discovery: { ...discovery(), repositories: [], tracked: [tracked('9001', 'unavailable')] } })).code, 'INITIAL_DISCOVERY_INCOMPLETE');
  assert.equal(prepareInitialSnapshot(options({ settings: { version: 1, repositories: { additional: ['owner/extra'], exclude: [] } } })).code, 'INITIAL_SETTINGS_PROVENANCE_INVALID');
});
test('first observations record self versus other ownership without storing repository names', () => {
  const result = reconcile({ previousRows: [], repositories: [metadata('1'), metadata('2', '500')], tracked: [tracked('1'), tracked('2')] });
  assert.equal(result[0].ownershipAtFirstObservation, 'self'); assert.equal(result[1].ownershipAtFirstObservation, 'other'); assert.equal(result[0].firstObservedAt, AT);
  assert.equal(Object.hasOwn(result[0], 'name'), false); assert.equal(Object.hasOwn(result[0], 'ownerAccountId'), false);
});
test('refresh retains all prior repository IDs and immutable first observation ownership despite transfers', () => {
  const before = previous(); const result = reconcile({ repositories: [metadata('9001', '500')], tracked: [tracked('9001', 'excluded', { discoveredVia: ['additional'] })] });
  assert.equal(result[0].ownershipAtFirstObservation, before.ownershipAtFirstObservation); assert.equal(result[0].firstObservedAt, before.firstObservedAt); assert.equal(result[0].tracking, 'excluded');
  assert.deepEqual(result[0].discoveredVia, ['automatic', 'additional']);
});
test('discovery omission does not silently exclude or delete tracked history', () => {
  assert.deepEqual(reconcile({ repositories: [], tracked: [] }), [previous()]);
});
test('explicit unavailable or outside-public-scope status preserves historical ownership', () => {
  for (const tracking of ['unavailable', 'outside_public_scope']) {
    const result = reconcile({ repositories: [], tracked: [tracked('9001', tracking)] }); assert.equal(result[0].tracking, tracking); assert.equal(result[0].ownershipAtFirstObservation, 'self');
  }
});
test('never-analyzed excluded/private/unavailable IDs without historical metadata are omitted, not assigned invented ownership', () => {
  const result = reconcile({ previousRows: [], repositories: [], tracked: [tracked('1', 'excluded'), tracked('2', 'outside_public_scope'), tracked('3', 'unavailable')] });
  assert.deepEqual(result, []);
});
test('new active targets require verified public repository metadata', () => {
  assert.throws(() => reconcile({ previousRows: [], repositories: [], tracked: [tracked('1')] }), /TRACKING_NEW_METADATA_REQUIRED/);
  assert.throws(() => reconcile({ previousRows: [], repositories: [metadata('1', '1001', { visibility: 'private' })], tracked: [tracked('1')] }), /TRACKING_METADATA_CONTRADICTION/);
});
test('tracking rejects unsafe IDs, duplicate identities, bad timestamps and unknown source values', () => {
  for (const input of [{ subjectAccountId: 1001 }, { previousRows: [previous(), previous()] }, { tracked: [tracked(), tracked()] }, { repositories: [metadata('01')] }, { tracked: [tracked('9001', 'active', { discoveredVia: ['secret'] })] }, { observedAt: '2026-08-01T00:00:00Z' }]) assert.throws(() => reconcile(input), /TRACKING_/);
});
test('tracking updates only from explicit known tracking rows, not a fabricated metadata flag', () => {
  assert.throws(() => reconcile({ repositories: [metadata()], tracked: [] }), /TRACKING_METADATA_CONTRADICTION/);
});
test('preparation and reconciliation never mutate caller-owned inputs', () => {
  const input = options(); const copy = structuredClone(input); assert.equal(prepareInitialSnapshot(input).decision, 'prepared'); assert.deepEqual(input, copy);
  const previousRows = [previous()]; const repositories = [metadata()]; const trackedRows = [tracked('9001', 'unavailable')]; const prior = structuredClone({ previousRows, repositories, trackedRows });
  reconcile({ previousRows, repositories, tracked: trackedRows }); assert.deepEqual({ previousRows, repositories, trackedRows }, prior);
});
