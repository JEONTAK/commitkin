import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRefreshUseCase } from '../src/application/refresh.mjs';
import { createSnapshotEvaluator, createEvidenceVerifier } from '../src/index.mjs';
import { parseStrictJson } from '../../record-validator/src/infrastructure/strict-json.js';
import { createEvidenceSchemaRegistry } from '../src/infrastructure/evidence-schema.mjs';
import { parseSettings } from '../src/infrastructure/settings-yaml.mjs';
import { adaptPublicCapture } from '../src/infrastructure/github/evidence-adapter.mjs';
import { DEVELOPMENT_POLICY_REGISTRY, developmentPolicyDescriptors } from '../src/infrastructure/policies.mjs';
import { renderCard } from '../src/presentation/card.mjs';
import { managedContent, updateManagedReadme, START, END } from '../src/presentation/readme.mjs';

const STARTED = '2026-10-15T00:50:00Z';
const COMPLETED = '2026-10-15T01:00:00Z';
const OWNER = { accountId: '1001', profileRepositoryId: '9001' };
const SETTINGS = 'version: 1\nrepositories:\n  additional: []\n  exclude: []\n';
const ORIGINAL_README = '# Original profile\n\n' + START + '\n' + END + '\n\nOutside managed block stays exact.\n';
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const q = (kind, receivedItems, filters, parentId) => {
  const path = {
    pull_requests: '/repos/owner/owner/pulls?state=all&per_page=100',
    repository_issue_events: '/repos/owner/owner/issues/events?per_page=100',
    releases: '/repos/owner/owner/releases?per_page=100',
    default_branch_commits: '/repos/owner/owner/commits?sha=main&per_page=100',
    pull_request_files: '/repos/owner/owner/pulls/4/files?per_page=100',
    pull_request_reviews: '/repos/owner/owner/pulls/4/reviews?per_page=100',
  }[kind];
  return { kind, repositoryId: '9001', ...(parentId ? { parentId } : {}), filters, receivedItems, pages: 1, closed: true,
    pageSnapshots: [{ sequence: 1, requestPath: path, itemCount: receivedItems, nextPath: null, startIndex: 0, endIndexExclusive: receivedItems }] };
};
const EVALUATE = createSnapshotEvaluator();
const VERIFY = createEvidenceVerifier();
const SCHEMA = createEvidenceSchemaRegistry();

function emptyCapture() {
  return {
    subjectAccountId: '1001', window: { startDate: '2026-07-17', cutoffDate: '2026-10-15' },
    repositories: [{ repositoryId: '9001', ownerAccountId: '1001', ownerType: 'User', visibility: 'public', fork: false, archived: false, defaultBranch: 'main' }],
    pullRequests: [], files: [], reviews: [], issues: [], issueEvents: [], releases: [], commits: [],
    queries: [q('pull_requests', 0, { state: 'all', creationCutoff: null }), q('repository_issue_events', 0, { enumeration: 'all', projectedActions: 'triage', projectedStartDate: '2026-07-17', projectedCutoffDate: '2026-10-15' }), q('releases', 0, { enumeration: 'all' }), q('default_branch_commits', 0, { branch: 'main', ancestry: 'all', reflectionTimeFromAuthorDate: false })],
  };
}

function addDocumentationPr(capture) {
  const beforeText = '# Documentation before\n'; const afterText = '# Documentation after\n';
  capture.pullRequests.push({ repositoryId: '9001', sourceId: { type: 'numeric', value: '17' }, number: '4', author: { status: 'identified', accountId: '1001', type: 'User' }, state: 'MERGED', createdAt: '2025-01-01T00:00:00Z', mergedAt: '2026-10-14T06:00:00Z', baseRepositoryId: '9001', headRepositoryId: '9999', baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), diffBaseOid: 'c'.repeat(40), diffHeadOid: 'b'.repeat(40), mergeCommitOid: 'e'.repeat(40), mergeParentOid: 'f'.repeat(40), currentLabels: [], changedFiles: 1, fileProof: 'complete_revision_inventory' });
  capture.files.push({ repositoryId: '9001', pullRequestId: '17', path: 'docs/readme.md', previousPath: null, beforePath: 'docs/readme.md', afterPath: 'docs/readme.md', kind: 'modified', beforeOid: blob(beforeText), afterOid: blob(afterText), beforeText, afterText, contentProof: 'text_pair' });
  capture.queries.find(query => query.kind === 'pull_requests').receivedItems = 1;
  Object.assign(capture.queries.find(query => query.kind === 'pull_requests').pageSnapshots[0], { itemCount: 1, endIndexExclusive: 1 });
  capture.queries.push(q('pull_request_files', 1, { wholeParentRevision: true }, '17'));
  capture.queries.push(q('pull_request_reviews', 0, { states: 'all', history: 'all' }, '17'));
  return capture;
}

function setup({ documentation = false, settingsFileUsed = false } = {}) {
  const installation = {
    decision: 'acquired', firstInstallVerified: true, initialAssignmentVerified: true,
    expectedOwner: { ...OWNER }, initialSelection: { accountId: '1001', factionId: 'bloomguard' },
    repository: { id: '9001', fullName: 'Owner/Owner', ownerAccountId: '1001', visibility: 'public' },
    login: 'Owner', defaultBranch: 'main', expectedHead: 'a'.repeat(40),
    provenance: { source: 'fixed-head-repository-read', historyScope: 'reachable-default-branch-at-expected-head', expectedHead: 'a'.repeat(40), treeSha: 'b'.repeat(40) },
    records: { state: null, ledger: null, status: null },
    settingsBytes: settingsFileUsed ? encode(SETTINGS) : null, settingsFileUsed,
    readmeBytes: encode(ORIGINAL_README),
  };
  const discovery = {
    decision: 'ready', code: 'DISCOVERED_KNOWN_SCOPE', codes: [],
    repositories: [{ id: '9001', name: 'owner/owner', ownerAccountId: '1001', visibility: 'public', fork: false, archived: false, discoveredVia: ['automatic'] }],
    tracked: [{ id: '9001', tracking: 'active', discoveredVia: ['automatic'] }],
  };
  const capture = documentation ? addDocumentationPr(emptyCapture()) : emptyCapture();
  const calls = { acquire: [], discover: [], collect: [], present: [], verify: [] };
  const controls = { installation, discovery, captured: { decision: 'ready', code: 'PUBLIC_CAPTURE_COLLECTED', capture }, clock: COMPLETED };
  const ports = {
    acquire: async request => { calls.acquire.push(request); return controls.installation; },
    discover: async request => { calls.discover.push(request); return controls.discovery; },
    collect: async request => { calls.collect.push(request); return controls.captured; },
    parse: parseStrictJson, parseSettings, updateReadme: updateManagedReadme,
    clock: () => controls.clock, adapt: adaptPublicCapture, schema: SCHEMA,
    policyRegistry: DEVELOPMENT_POLICY_REGISTRY, policyDescriptors: developmentPolicyDescriptors(), evaluate: EVALUATE,
    verify: request => { calls.verify.push(request); return VERIFY(request); },
    present: ({ candidate, username, classificationReason, originalReadme }) => {
      calls.present.push({ candidate, username });
      const card = renderCard({ state: candidate.state, username, classificationReason, preview: true });
      const readme = updateManagedReadme(originalReadme, managedContent({ state: candidate.state, status: candidate.status, username, classificationReason, preview: true }));
      return [...['state', 'ledger', 'status'].map(role => ({ path: '.commitkin/' + role + '.json', content: encode(candidate[role]) })), { path: '.commitkin/card.png', content: card }, { path: 'README.md', content: encode(readme) }];
    },
  };
  const workflowContext = { startedAt: STARTED };
  return { installation, discovery, capture, controls, calls, ports, workflowContext, run: createRefreshUseCase(ports) };
}

function assertPrepared(result, xp) {
  assert.equal(result.decision, 'prepared', JSON.stringify(result));
  assert.equal(result.code, 'DRY_RUN_READY'); assert.equal(result.stage, 'complete');
  assert.equal(result.candidate.state.growth.totalXp, xp); assert.equal(result.candidate.state.growth.phase, 'ready');
  assert.equal(result.candidate.state.faction.id, 'bloomguard');
  assert.equal(result.progressionAuthorized, false); assert.equal(result.published, false);
  assert.equal(result.verification.decision, 'accept_relative_to_evidence');
  assert.deepEqual(result.files.map(file => file.path).sort(), ['.commitkin/card.png', '.commitkin/ledger.json', '.commitkin/state.json', '.commitkin/status.json', 'README.md']);
  const png = result.files.find(file => file.path.endsWith('.png')).content;
  assert.equal(Buffer.from(png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const readme = result.files.find(file => file.path === 'README.md').content.toString('utf8');
  assert.ok(readme.startsWith('# Original profile\n\n' + START));
  assert.ok(readme.endsWith(END + '\n\nOutside managed block stays exact.\n'));
}

function reuseCandidate(mock, result) {
  mock.controls.installation = {
    ...mock.installation, firstInstallVerified: false, initialAssignmentVerified: false,
    records: Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, encode(result.candidate[role])])),
    readmeBytes: result.files.find(file => file.path === 'README.md').content,
  };
  mock.controls.clock = '2026-10-15T02:00:00Z';
}

test('first verified installation composes real schema/domain/record/evidence/presentation for empty known scope', async () => {
  const mock = setup(); const result = await mock.run({ workflowContext: mock.workflowContext, initialSelection: mock.installation.initialSelection });
  assertPrepared(result, '0'); assert.equal(result.summary.firstInstallation, true); assert.equal(result.summary.knownRepositories, 1);
  assert.equal(result.candidate.state.class.id, 'adventurer'); assert.deepEqual(result.candidate.ledger.facts, []);
  assert.equal(result.candidate.state.growth.startDate, '2026-07-17');
  assert.equal(mock.calls.discover.length, 1); assert.equal(mock.calls.collect.length, 1); assert.equal(mock.calls.verify.length, 1); assert.equal(mock.calls.present.length, 1);
  assert.equal(mock.calls.discover[0].subjectAccountId, OWNER.accountId);
});

test('qualifying documentation PR produces40XP and retained real identity without pretending full source authenticity', async () => {
  const mock = setup({ documentation: true }); const result = await mock.run({ workflowContext: mock.workflowContext });
  assertPrepared(result, '40'); assert.equal(result.summary.deltaXp, '40'); assert.equal(result.candidate.ledger.facts.length, 1);
  assert.equal(result.candidate.ledger.facts[0].kind, 'merged_pr'); assert.deepEqual(result.candidate.ledger.facts[0].families, ['knowledge']);
  assert.equal(result.verification.sourceAuthenticity, 'not_checked');
  assert.equal(result.candidate.state.achievements.find(item => item.seriesId === 'completed-works').earned[0].grade, 'bronze');
});

test('same-date repeat refresh preserves fixed faction/growth/facts and adds noXP or observation', async () => {
  const mock = setup({ documentation: true }); const first = await mock.run({ workflowContext: mock.workflowContext }); assertPrepared(first, '40');
  reuseCandidate(mock, first); const replay = await mock.run({ workflowContext: mock.workflowContext });
  assert.equal(replay.decision, 'unchanged', JSON.stringify(replay)); assert.equal(replay.summary.deltaXp, '0');
  assert.deepEqual(replay.candidate, first.candidate); assert.equal(replay.progressionAuthorized, false); assert.equal(replay.published, false);
});

test('next-date normal refresh preserves original-date facts and legitimate XP while advancing successful coverage', async () => {
  const mock = setup({ documentation: true }); const first = await mock.run({ workflowContext: mock.workflowContext }); assertPrepared(first, '40');
  reuseCandidate(mock, first); mock.workflowContext.startedAt = '2026-10-16T00:50:00Z'; mock.controls.clock = '2026-10-16T01:00:00Z';
  mock.capture.window = { startDate: '2026-07-18', cutoffDate: '2026-10-16' };
  const events = mock.capture.queries.find(query => query.kind === 'repository_issue_events');
  events.filters.projectedStartDate = '2026-07-18'; events.filters.projectedCutoffDate = '2026-10-16';
  const result = await mock.run({ workflowContext: mock.workflowContext }); assertPrepared(result, '40');
  assert.equal(result.summary.deltaXp, '0'); assert.deepEqual(result.candidate.ledger.facts, first.candidate.ledger.facts);
  assert.deepEqual(result.candidate.ledger.days, first.candidate.ledger.days);
  assert.equal(result.candidate.state.growth.startDate, first.candidate.state.growth.startDate);
  assert.equal(result.candidate.state.evaluation.activityCutoffExclusive, '2026-10-16');
});

test('discovery or collection failure returns no candidate file bytes and preserves previous records', async () => {
  for (const stage of ['discovery', 'collection']) {
    const mock = setup();
    if (stage === 'discovery') mock.controls.discovery = { decision: 'hold', code: 'DISCOVERY_PARTIAL' };
    else mock.controls.captured = { decision: 'hold', code: 'REQUEST_BUDGET_EXHAUSTED', capture: null };
    const result = await mock.run({ workflowContext: mock.workflowContext });
    assert.equal(result.decision, 'hold'); assert.equal(result.stage, stage); assert.equal(result.files, null); assert.equal(result.preservePrevious, true);
    assert.equal(result.progressionAuthorized, false); assert.equal(result.published, false); assert.equal(mock.calls.verify.length, 0); assert.equal(mock.calls.present.length, 0);
    if (stage === 'discovery') assert.equal(mock.calls.collect.length, 0);
  }
});

test('failed subsequent acquisition/collection never edits the supplied last successful record bytes', async () => {
  const mock = setup({ documentation: true }); const first = await mock.run({ workflowContext: mock.workflowContext }); assertPrepared(first, '40');
  reuseCandidate(mock, first); const original = JSON.stringify(mock.controls.installation.records);
  mock.controls.captured = { decision: 'hold', code: 'REPOSITORY_UNAVAILABLE', capture: null };
  const result = await mock.run({ workflowContext: mock.workflowContext });
  assert.equal(result.decision, 'hold'); assert.equal(result.files, null); assert.equal(result.preservePrevious, true);
  assert.equal(JSON.stringify(mock.controls.installation.records), original); assert.equal(result.published, false);
});

test('qualification failure does not present partial eligible records or replace prior successful character', async () => {
  const mock = setup({ documentation: true });
  mock.capture.files[0].path = mock.capture.files[0].beforePath = mock.capture.files[0].afterPath = 'src/main.js';
  const result = await mock.run({ workflowContext: mock.workflowContext });
  assert.equal(result.decision, 'hold'); assert.equal(result.stage, 'qualification'); assert.equal(result.code, 'BUG_TEMPORAL_PROOF_UNSUPPORTED');
  assert.equal(result.files, null); assert.equal(mock.calls.verify.length, 0); assert.equal(mock.calls.present.length, 0);
});

test('invalid or absent README connection stops before discovery/collection', async () => {
  for (const content of [null, encode('# No managed region\n'), new Uint8Array([0xff])]) {
    const mock = setup(); mock.installation.readmeBytes = content;
    const result = await mock.run({ workflowContext: mock.workflowContext });
    assert.equal(result.decision, 'hold'); assert.equal(result.files, null); assert.equal(mock.calls.discover.length, 0); assert.equal(mock.calls.collect.length, 0);
  }
});

test('deleting a previously used settings file never falls back to automatic defaults', async () => {
  const mock = setup({ settingsFileUsed: true }); const first = await mock.run({ workflowContext: mock.workflowContext }); assertPrepared(first, '0');
  reuseCandidate(mock, first); mock.controls.installation.settingsBytes = null; mock.controls.installation.settingsFileUsed = false;
  mock.calls.discover.length = 0; mock.calls.collect.length = 0;
  const result = await mock.run({ workflowContext: mock.workflowContext });
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'SETTINGS_CONFIRMATION_REQUIRED'); assert.equal(result.files, null);
  assert.equal(mock.calls.discover.length, 0); assert.equal(mock.calls.collect.length, 0);
});

test('acquisition hold cannot be bypassed by source fields or setup selection', async () => {
  const mock = setup(); mock.controls.installation = { decision: 'hold', code: 'RECOVERY_REQUIRED', firstInstallVerified: true };
  const result = await mock.run({ workflowContext: mock.workflowContext, initialSelection: { accountId: '1001', factionId: 'ashbound' } });
  assert.equal(result.decision, 'hold'); assert.equal(result.stage, 'installation'); assert.equal(result.code, 'RECOVERY_REQUIRED');
  assert.equal(mock.calls.discover.length, 0); assert.equal(mock.calls.collect.length, 0); assert.equal(result.files, null);
});

test('thrown private acquisition errors are sanitized and produce no publication bytes', async () => {
  const mock = setup(); mock.ports.acquire = async () => { throw new Error('PRIVATE_TOKEN_AND_REMOTE_ERROR'); };
  const result = await mock.run({ workflowContext: mock.workflowContext });
  assert.equal(result.decision, 'hold'); assert.equal(result.files, null); assert.equal(JSON.stringify(result).includes('PRIVATE_TOKEN'), false);
  assert.equal(mock.calls.collect.length, 0); assert.equal(mock.calls.present.length, 0);
});

test('composed refresh leaves trusted acquisition/capture/workflow inputs unchanged and never writes real growth records', async () => {
  const mock = setup({ documentation: true });
  const before = JSON.stringify({ installation: mock.installation, discovery: mock.discovery, capture: mock.capture, workflow: mock.workflowContext });
  const result = await mock.run({ workflowContext: mock.workflowContext }); assertPrepared(result, '40');
  assert.equal(JSON.stringify({ installation: mock.installation, discovery: mock.discovery, capture: mock.capture, workflow: mock.workflowContext }), before);
  assert.equal(Object.hasOwn(mock.ports, 'write'), false); assert.equal(Object.hasOwn(mock.ports, 'publish'), false);
  assert.ok(result.files.every(file => file.content instanceof Uint8Array)); assert.equal(result.published, false);
});
