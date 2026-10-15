import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { adaptPublicCapture } from '../src/infrastructure/github/evidence-adapter.mjs';
import { developmentPolicyDescriptors } from '../src/infrastructure/policies.mjs';
import { createEvidenceSchemaRegistry } from '../src/infrastructure/evidence-schema.mjs';
import { createPreflightValidator } from '../src/infrastructure/preflight-factory.mjs';
import { createEvidenceVerifier } from '../src/index.mjs';
import { collectPublicSources } from '../src/application/collect-public-sources.mjs';

const ROOT = new URL('../../../test/fixtures/evidence/', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const schema = createEvidenceSchemaRegistry(), preflight = createPreflightValidator();
const subject = { status: 'identified', accountId: '1001', type: 'User' };
const other = { status: 'identified', accountId: '2002', type: 'User' };
const q = (kind, receivedItems, filters, parentId) => ({ kind, repositoryId: '9001', ...(parentId ? { parentId } : {}), filters, receivedItems, pages: 1, closed: true, pageSnapshots: [{ sequence: 1, requestPath: '/repos/owner/project/' + kind + '?per_page=100', itemCount: receivedItems, nextPath: null, startIndex: 0, endIndexExclusive: receivedItems }] });
function setCount(query, count) { query.receivedItems = count; query.pageSnapshots[0].itemCount = count; query.pageSnapshots[0].endIndexExclusive = count; }
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
function capture() {
  return { subjectAccountId: '1001', window: { startDate: '2026-07-17', cutoffDate: '2026-10-15' },
    repositories: [{ repositoryId: '9001', ownerAccountId: '1001', ownerType: 'User', visibility: 'public', fork: false, archived: false, defaultBranch: 'main' }],
    pullRequests: [], files: [], reviews: [], issues: [], issueEvents: [], releases: [], commits: [],
    queries: [q('pull_requests', 0, { state: 'all', creationCutoff: null }), q('repository_issue_events', 0, { enumeration: 'all', projectedActions: 'triage', projectedStartDate: '2026-07-17', projectedCutoffDate: '2026-10-15' }), q('releases', 0, { enumeration: 'all' }), q('default_branch_commits', 0, { branch: 'main', ancestry: 'all', reflectionTimeFromAuthorDate: false })] };
}
function records(id) {
  const entry = read('preflight-v1/cases.json').cases.find(c => c.caseId === id);
  if (entry.baseRecordFixture.includes('#')) {
    const [path, pointer] = entry.baseRecordFixture.split('#');
    let value = read('preflight-v1/' + path);
    for (const part of pointer.split('/').filter(Boolean)) value = value[part];
    return structuredClone(value);
  }
  return Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, read('preflight-v1/' + entry.baseRecordFixture + '/' + role + '.json')]));
}
function args(id = 'ES-N01') {
  const candidate = records(id);
  return { capture: capture(), context: read('preflight-v1/normal/' + id + '/context.json'), candidateLedgerHash: candidate.state.integrity.ledgerHash, previousLedgerHash: null, policies: developmentPolicyDescriptors(), capturedAt: '2026-10-15T01:00:00Z' };
}
function normalized(input) {
  const original = structuredClone(input), result = adaptPublicCapture(input);
  assert.equal(result.decision, 'adapted', result.code);
  assert.equal(schema.validate('evidence', result.evidence), true);
  assert.equal(schema.validate('preflight', result.evidence), true);
  assert.equal(result.progressionAuthorized, false); assert.equal(result.sourceAuthenticity, 'not_checked');
  assert.deepEqual(input, original);
  return result;
}
function preflightInput(input, evidence, id) {
  return { context: Buffer.from(JSON.stringify(input.context)), evidence: Buffer.from(JSON.stringify(evidence)), candidate: Object.fromEntries(Object.entries(records(id)).map(([role, value]) => [role, Buffer.from(JSON.stringify(value))])) };
}
function addPr(input, own = true) {
  const pr = { repositoryId: '9001', sourceId: { type: 'numeric', value: own ? '17' : '31' }, number: own ? '4' : '5', author: structuredClone(own ? subject : other), state: own ? 'MERGED' : 'OPEN', createdAt: '2025-01-01T00:00:00Z', mergedAt: own ? '2026-10-14T06:00:00Z' : null, baseRepositoryId: '9001', headRepositoryId: '9999', baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), currentLabels: [], changedFiles: 1, fileProof: own ? 'complete_revision_inventory' : 'not_collected' };
  input.capture.pullRequests.push(pr); setCount(input.capture.queries.find(q => q.kind === 'pull_requests'), input.capture.pullRequests.length);
  if (own) {
    pr.diffBaseOid = 'c'.repeat(40); pr.diffHeadOid = pr.headOid; pr.mergeCommitOid = 'e'.repeat(40); pr.mergeParentOid = 'f'.repeat(40);
    input.capture.queries.push(q('pull_request_files', 1, { wholeParentRevision: true }, '17'));
    input.capture.files.push({ repositoryId: '9001', pullRequestId: '17', path: 'docs/readme.md', previousPath: null, beforePath: 'docs/readme.md', afterPath: 'docs/readme.md', kind: 'modified', beforeOid: blob('# old\n'), afterOid: blob('# new\n'), beforeText: '# old\n', afterText: '# new\n', contentProof: 'text_pair' });
  }
  input.capture.queries.push(q('pull_request_reviews', 0, { states: 'all', history: 'all' }, pr.sourceId.value));
  return pr;
}
function addReview(input) {
  const pr = addPr(input, false);
  input.capture.reviews.push({ repositoryId: '9001', pullRequestId: pr.sourceId.value, sourceId: { type: 'numeric', value: '21' }, reviewer: structuredClone(subject), state: 'COMMENTED', submittedAt: '2026-10-14T11:00:00Z', reviewedCommitOid: 'a'.repeat(40) });
  setCount(input.capture.queries.find(q => q.kind === 'pull_request_reviews'), 1);
}
function addTriage(input) {
  for (let i = 0; i < 3; i++) {
    const issueId = String(51 + i);
    input.capture.issues.push({ repositoryId: '9001', sourceId: { type: 'numeric', value: issueId }, author: structuredClone(other), createdAt: '2020-01-01T00:00:00Z', currentLabels: [] });
    input.capture.issueEvents.push({ repositoryId: '9001', sourceId: { type: 'numeric', value: String(751 + i) }, issueId, actor: structuredClone(subject), occurredAt: '2026-10-14T16:00:00Z', kind: 'labeled', target: { kind: 'label', sourceId: { type: 'numeric', value: '601' } } });
  }
  setCount(input.capture.queries.find(q => q.kind === 'repository_issue_events'), 3);
}

for (const [id, extend] of [['ES-N01', () => {}], ['ES-N02', addPr], ['ES-N04', addReview], ['ES-N06', addTriage]]) test('adapter schema + actual preflight + supported verifier ' + id, () => {
  const input = args(id); extend(input); const result = normalized(input), request = preflightInput(input, result.evidence, id);
  const checked = preflight(request); assert.equal(checked.decision, 'preflight_passed', JSON.stringify(checked));
  const verified = createEvidenceVerifier()(request); assert.equal(verified.decision, 'accept_relative_to_evidence', JSON.stringify(verified));
  assert.equal(verified.progressionAuthorized, false);
});

test('empty explicit scope derives no fake repository or source calls', () => {
  const input = args(); input.capture.repositories = []; input.capture.queries = []; input.context.scope.repositoryIds = [];
  const result = normalized(input); assert.deepEqual(result.evidence.collections, []); assert.equal(result.provenance.providerQueries, 0);
});

test('actual collector empty capture adapts, rather than trusting a ready flag', async () => {
  const result = await collectPublicSources({ client: { budget: () => ({ used: 0, remaining: 10, limit: 10 }), get: async () => ({ ok: true, data: { id: '9001', full_name: 'owner/project', owner: { id: '1001', type: 'User' }, private: false, visibility: 'public', fork: false, archived: false, default_branch: 'main' } }), paginate: async path => ({ ok: true, complete: true, items: [], pages: 1, pageSnapshots: [{ sequence: 1, requestPath: path, itemCount: 0, nextPath: null, startIndex: 0, endIndexExclusive: 0 }] }) }, repositories: [{ id: '9001', name: 'owner/project' }], subjectAccountId: '1001', startDate: '2026-07-17', cutoffDate: '2026-10-15' });
  assert.equal(result.decision, 'ready'); const input = args(); input.capture = result.capture; normalized(input);
});

test('parent history is not truncated to recent review activity', () => {
  const input = args('ES-N04'); addReview(input);
  const old = structuredClone(input.capture.reviews[0]); old.sourceId.value = '1'; old.submittedAt = '2020-01-01T00:00:00Z'; input.capture.reviews.push(old);
  setCount(input.capture.queries.find(q => q.kind === 'pull_request_reviews'), 2);
  const e = normalized(input).evidence;
  assert.equal(e.collections.find(c => c.resourceType === 'review' && c.purpose === 'activity').pages[0].response.itemRefs.length, 1);
  assert.equal(e.collections.find(c => c.resourceType === 'review' && c.purpose === 'history').pages[0].response.itemRefs.length, 2);
  assert.equal(e.resources.pullRequests[0].createdAt, '2025-01-01T00:00:00Z');
});

test('unsupported label/release/reflection histories stay explicitly unavailable', () => {
  const input = args(); input.capture.releases.push({ repositoryId: '9001', sourceId: { type: 'numeric', value: '41' }, author: structuredClone(subject), draft: false, prerelease: false, publishedAt: '2026-10-14T12:00:00Z', firstPublicationProof: 'unsupported' });
  setCount(input.capture.queries.find(q => q.kind === 'releases'), 1);
  const e = normalized(input).evidence;
  assert.equal(e.resources.releases[0].firstPublication.status, 'unavailable');
  assert.equal(e.resources.releases[0].firstPublication.value, undefined);
});

test('pending review preserves null submission/commit and reason mapping without fake actor', () => {
  const input = args('ES-N04'); addReview(input); const r = input.capture.reviews[0]; r.state = 'PENDING'; r.submittedAt = null; r.reviewedCommitOid = null; r.reviewer = { status: 'unavailable', reason: 'ACTOR_NOT_PROVIDED' };
  const e = normalized(input).evidence; assert.equal(e.resources.reviews[0].reviewer.reason, 'SOURCE_NOT_PROVIDED');
  assert.equal(e.collections.find(c => c.resourceType === 'review' && c.purpose === 'activity').pages[0].response.itemRefs.length, 0);
});

test('actual relevant diff revisions are not advanced base tips or file blob OIDs', () => {
  const input = args('ES-N02'); addPr(input); const e = normalized(input).evidence, pr = e.resources.pullRequests[0];
  assert.equal(pr.baseOid, 'c'.repeat(40)); assert.equal(pr.headOid, 'b'.repeat(40));
  assert.notEqual(e.resources.fileChanges[0].beforeOid, pr.baseOid);
});

test('metadata-only irrelevance stays not_collected, never a fabricated empty file set', () => {
  const input = args('ES-N04'); addReview(input); const e = normalized(input).evidence;
  const files = e.collections.find(c => c.resourceType === 'file_change'); assert.equal(files.state, 'not_collected'); assert.deepEqual(files.pages, []); assert.deepEqual(e.resources.fileChanges, []);
});

test('actual multipage provenance permits a deterministic logical projection, no fake provider cursors', () => {
  const input = args('ES-N02'); addPr(input); const q = input.capture.queries.find(q => q.kind === 'pull_requests'); q.pages = 2;
  q.pageSnapshots = [
    { sequence: 1, requestPath: '/repos/owner/project/pulls?per_page=100', itemCount: 0, nextPath: '/repos/owner/project/pulls?per_page=100&page=2', startIndex: 0, endIndexExclusive: 0 },
    { sequence: 2, requestPath: '/repos/owner/project/pulls?per_page=100&page=2', itemCount: 1, nextPath: null, startIndex: 0, endIndexExclusive: 1 },
  ];
  const before = normalized(input); q.pageSnapshots.reverse(); const after = normalized(input);
  assert.deepEqual(before, after); assert.equal(before.provenance.providerPages, 7);
  assert.equal(JSON.stringify(before.evidence).includes('requestPath'), false);
});

const failures = [
  ['unclosed query', i => { i.capture.queries[0].closed = false; }, 'CAPTURE_QUERY_INCOMPLETE'],
  ['missing backing query', i => { i.capture.queries.pop(); }, 'CAPTURE_QUERY_MISSING_OR_MISMATCH'],
  ['wrong query filters', i => { i.capture.queries[0].filters.state = 'open'; }, 'CAPTURE_QUERY_MISSING_OR_MISMATCH'],
  ['missing real page provenance', i => { delete i.capture.queries[0].pageSnapshots; }, 'CAPTURE_PAGE_PROVENANCE_UNAVAILABLE'],
  ['wrong raw received count', i => { setCount(i.capture.queries[0], 1); }, 'CAPTURE_COUNT_MISMATCH'],
  ['wrong subject', i => { i.capture.subjectAccountId = '2'; }, 'SUBJECT_BINDING_MISMATCH'],
  ['unrequested repository missing', i => { i.context.scope.repositoryIds = ['9002']; }, 'CAPTURE_SCOPE_MISMATCH'],
  ['wrong completed date', i => { i.capture.window.cutoffDate = '2026-10-16'; }, 'CAPTURE_WINDOW_MISMATCH'],
  ['future completion', i => { i.capturedAt = '2026-10-15T03:00:00Z'; }, 'CAPTURE_TIME_INVALID'],
  ['previous mode contradiction', i => { i.previousLedgerHash = i.candidateLedgerHash; }, 'PREVIOUS_MODE_MISMATCH'],
  ['arbitrary policy', i => { i.policies.fileRules.id = 'fixture-files-v1'; }, 'POLICY_DESCRIPTOR_UNSUPPORTED'],
  ['duplicate source', i => { addPr(i); i.capture.pullRequests.push(structuredClone(i.capture.pullRequests[0])); }, 'DUPLICATE_SOURCE_IDENTITY'],
];
for (const [name, change, code] of failures) test('adapter holds ' + name + ' without source dump', () => {
  const input = args(); change(input); const result = adaptPublicCapture(input);
  assert.equal(result.decision, 'hold'); assert.equal(result.code, code); assert.equal(result.evidence, null); assert.equal(result.progressionAuthorized, false);
  assert.equal(JSON.stringify(result).includes('beforeText'), false);
});

test('resource and query permutations preserve exact adapter output without mutating inputs', () => {
  const input = args('ES-N06'); addTriage(input); const before = normalized(input);
  for (const key of ['repositories', 'pullRequests', 'files', 'reviews', 'issues', 'issueEvents', 'releases', 'commits', 'queries']) input.capture[key].reverse();
  assert.deepEqual(normalized(input), before);
});

function addCommit(input, author = other, associatedPrIds = null) {
  const oid = 'e'.repeat(40);
  input.capture.commits.push({ repositoryId: '9001', sourceId: { type: 'opaque', value: oid }, oid, author: structuredClone(author), defaultBranchReflectionProof: 'unsupported', fullFileContents: 'not_collected', associatedPrIds });
  setCount(input.capture.queries.find(q => q.kind === 'default_branch_commits'), 1);
  if (Array.isArray(associatedPrIds)) input.capture.queries.push(q('commit_pull_requests', associatedPrIds.length, { enumeration: 'all' }, oid));
}

test('known other-author ancestry does not fabricate direct files or require irrelevant proof', () => {
  const input = args(); addCommit(input); const e = normalized(input).evidence;
  assert.equal(e.resources.commits[0].reflectedAt.status, 'unavailable');
  assert.equal(e.collections.filter(c => c.target.kind === 'resource').every(c => c.state === 'not_collected'), true);
  const request = preflightInput(input, e, 'ES-N01');
  assert.equal(preflight(request).decision, 'preflight_passed');
  assert.equal(createEvidenceVerifier()(request).decision, 'accept_relative_to_evidence');
});

test('commit proven represented by merged PR is not double-counted or assigned fake file proof', () => {
  const input = args('ES-N02'); addPr(input); addCommit(input, subject, ['17']); const e = normalized(input).evidence;
  const request = preflightInput(input, e, 'ES-N02');
  assert.equal(preflight(request).decision, 'preflight_passed');
  assert.equal(createEvidenceVerifier()(request).decision, 'accept_relative_to_evidence');
});

test('unrepresented own/unknown commit remains incomplete; adapter never invents reflection time', () => {
  for (const author of [subject, { status: 'unavailable', reason: 'ACTOR_NOT_PROVIDED' }]) {
    const input = args(); addCommit(input, author, author === subject ? [] : null); const e = normalized(input).evidence;
    assert.equal(e.resources.commits[0].reflectedAt.status, 'unavailable');
    assert.equal(preflight(preflightInput(input, e, 'ES-N01')).decision, 'hold');
  }
});

for (const [name, change] of [
  ['wrong sequence', p => { p.sequence = 2; }],
  ['wrong range', p => { p.endIndexExclusive = 1; }],
  ['external path', p => { p.requestPath = 'https://evil.invalid/never-fetch'; }],
  ['unterminated last page', p => { p.nextPath = '/repos/owner/project/pulls?page=2'; }],
]) test('actual page snapshot contradiction holds: ' + name, () => {
  const input = args(); change(input.capture.queries[0].pageSnapshots[0]); const result = adaptPublicCapture(input);
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'CAPTURE_PAGE_PROVENANCE_INVALID');
  assert.equal(JSON.stringify(result).includes('evil.invalid'), false);
});

test('unknown-scope commit cannot be silently discarded from normalized observations', () => {
  const input = args(); addCommit(input); input.capture.commits[0].repositoryId = '9002';
  assert.equal(adaptPublicCapture(input).code, 'COMMIT_METADATA_INVALID');
});

test('added/removed fulltext uses actual null sides and opaque file/blob IDs', () => {
  for (const kind of ['added', 'removed']) {
    const input = args('ES-N02'); addPr(input); const f = input.capture.files[0]; f.kind = kind;
    const side = kind === 'added' ? 'before' : 'after'; f[side + 'Path'] = null; f[side + 'Oid'] = null; f[side + 'Text'] = null;
    const e = normalized(input).evidence; assert.equal(e.resources.fileChanges[0][side + 'Oid'], null);
    assert.equal(e.resources.fileChanges[0].content[side + 'Text'], null);
  }
});

test('a malformed text_pair cannot become a partial valid evidence result', () => {
  const input = args('ES-N02'); addPr(input); delete input.capture.files[0].beforeText;
  const result = adaptPublicCapture(input); assert.equal(result.decision, 'hold'); assert.equal(result.code, 'CAPTURE_FILE_CONTENT_INVALID'); assert.equal(result.evidence, null);
});

test('unknown fields in source identity/actor/subject do not leak into normalized evidence', () => {
  const input = args('ES-N02'); addPr(input); input.capture.pullRequests[0].sourceId.secret = 'never-copy-marker'; input.capture.pullRequests[0].author.email = 'never-copy-marker'; input.context.expected.subject.token = 'never-copy-marker';
  const e = normalized(input).evidence; assert.equal(JSON.stringify(e).includes('never-copy-marker'), false);
});

test('complete file proof requires actual compared revisions and matching head, not guessed base tips', () => {
  const input = args('ES-N02'); addPr(input); delete input.capture.pullRequests[0].diffBaseOid;
  assert.equal(adaptPublicCapture(input).code, 'CAPTURE_REVISION_PROOF_UNAVAILABLE');
  const wrong = args('ES-N02'); addPr(wrong); wrong.capture.pullRequests[0].diffHeadOid = 'f'.repeat(40);
  assert.equal(adaptPublicCapture(wrong).code, 'CAPTURE_REVISION_PROOF_UNAVAILABLE');
});
