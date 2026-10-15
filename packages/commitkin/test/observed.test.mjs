import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { qualifyObservedCapture, OBSERVED_SOURCE_MODEL } from '../src/domain/evidence/observed.mjs';
import { classifyPath, OBSERVED_FILE_RULES } from '../src/domain/evidence/files.mjs';
import { settleQualifiedActivities } from '../src/domain/growth/settlement.mjs';

const ACCOUNT = '1001'; const REPO = '9001'; const START = '2026-07-17'; const CUTOFF = '2026-10-15';
const WHEN = '2026-10-14T06:00:00Z'; const HEAD = 'a'.repeat(40); const COMMIT = 'b'.repeat(40);
const USER = { status: 'identified', accountId: ACCOUNT, type: 'User' };
const OTHER = { status: 'identified', accountId: '1002', type: 'User' };
const REGISTRY = { fileRules: [{ id: 'commitkin-observed-files-v1', version: '1', body: OBSERVED_FILE_RULES }] };
const blob = text => createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const clone = value => structuredClone(value);
function q(kind, receivedItems, filters, parentId, repositoryId = REPO) {
  const path = '/repos/owner/project/' + ({ pull_requests: 'pulls?state=all', releases: 'releases', default_branch_commits: 'commits?sha=' + HEAD, repository_issue_events: 'issues/events', pull_request_files: 'pulls/4/files', pull_request_reviews: 'pulls/4/reviews', commit_pull_requests: 'commits/' + COMMIT + '/pulls', commit_files: 'commits/' + COMMIT, observed_current_labels: 'issues/4/labels' }[kind] ?? 'unused');
  return { kind, repositoryId, ...(parentId !== undefined ? { parentId } : {}), filters, receivedItems, pages: 1, closed: true, pageSnapshots: [{ sequence: 1, requestPath: path, itemCount: receivedItems, nextPath: null, startIndex: 0, endIndexExclusive: receivedItems }] };
}
function closingQuery(included = 0, excluded = 0) {
  const total = included + excluded;
  return { kind: 'observed_closing_issues', repositoryId: REPO, parentId: '17', filters: { observation: 'current', excludeUserLinked: false }, receivedItems: total, includedItems: included, excludedPrivateCount: excluded, pages: 1, closed: true, pageSnapshots: [{ sequence: 1, requestCursor: null, endCursor: null, hasNextPage: false, itemCount: total, includedCount: included, excludedPrivateCount: excluded, startIndex: 0, endIndexExclusive: total }] };
}
function setCount(capture, kind, value) {
  const query = capture.queries.find(item => item.kind === kind); query.receivedItems = value; query.pageSnapshots[0].itemCount = value; query.pageSnapshots[0].endIndexExclusive = value;
}
function empty() {
  return { model: OBSERVED_SOURCE_MODEL, subjectAccountId: ACCOUNT, window: { startDate: START, cutoffDate: CUTOFF }, repositories: [{ repositoryId: REPO, ownerAccountId: ACCOUNT, ownerType: 'User', visibility: 'public', fork: false, archived: false, defaultBranch: 'main', defaultBranchHeadOid: HEAD }], pullRequests: [], files: [], reviews: [], issues: [], issueEvents: [], releases: [], commits: [], queries: [q('pull_requests', 0, { state: 'all', creationCutoff: null }), q('releases', 0, { enumeration: 'all' }), q('default_branch_commits', 0, { branch: 'main', headOid: HEAD, ancestry: 'all', reflectionTimeFromAuthorDate: false }), q('repository_issue_events', 0, { enumeration: 'all', projectedActions: 'triage', projectedStartDate: START, projectedCutoffDate: CUTOFF })] };
}
function file(path = 'src/index.ts', beforeText = 'const old = 1;\n', afterText = 'const next = 2;\n', parent = { pullRequestId: '17' }) {
  return { repositoryId: REPO, ...parent, path, previousPath: null, kind: 'modified', observedBlobOid: blob(afterText), beforePath: path, afterPath: path, beforeOid: blob(beforeText), afterOid: blob(afterText), contentProof: 'text_pair', beforeText, afterText };
}
function addPr(capture, { paths = ['src/index.ts'], bugName = null, otherAuthor = false } = {}) {
  const currentLabels = bugName === null ? [] : [{ type: 'numeric', value: '601', name: bugName }];
  const pr = { repositoryId: REPO, sourceId: { type: 'numeric', value: '17' }, number: '4', author: clone(otherAuthor ? OTHER : USER), state: 'MERGED', createdAt: '2025-01-01T00:00:00Z', mergedAt: WHEN, baseRepositoryId: REPO, headRepositoryId: '9999', baseOid: 'c'.repeat(40), headOid: 'd'.repeat(40), currentLabels, changedFiles: paths.length, fileProof: otherAuthor ? 'not_collected' : 'complete_revision_inventory' };
  capture.pullRequests.push(pr); setCount(capture, 'pull_requests', 1); capture.queries.push(q('pull_request_reviews', 0, { states: 'all', history: 'all' }, '17'));
  if (!otherAuthor) {
    Object.assign(pr, { diffBaseOid: 'e'.repeat(40), diffHeadOid: pr.headOid, mergeCommitOid: 'f'.repeat(40), mergeParentOid: '1'.repeat(40), labelsProof: 'complete_current_labels', closingIssueIds: [], excludedClosingIssueCount: 0, closingIssuesProof: 'complete_current_resolving_issues' });
    capture.files.push(...paths.map(path => file(path))); capture.queries.push(q('pull_request_files', paths.length, { wholeParentRevision: true }, '17'), q('observed_current_labels', currentLabels.length, { observation: 'current', targetKind: 'pull_request' }, '17'), closingQuery());
  }
  return capture;
}
function addCommit(capture, { path = 'src/index.ts', fork = false } = {}) {
  capture.repositories[0].fork = fork;
  capture.commits.push({ repositoryId: REPO, sourceId: { type: 'opaque', value: COMMIT }, oid: COMMIT, author: clone(USER), committedAt: WHEN, defaultBranchMembership: 'current_ancestry', defaultBranchReflectionProof: 'unsupported', associatedPrIds: [], firstParentOid: 'c'.repeat(40), treeOid: 'd'.repeat(40), parentTreeOid: 'e'.repeat(40), fullFileContents: 'text_pair', fileProof: 'complete_revision_inventory', changedFiles: 1 });
  capture.files.push(file(path, undefined, undefined, { commitOid: COMMIT })); setCount(capture, 'default_branch_commits', 1);
  capture.queries.push(q('commit_pull_requests', 0, { enumeration: 'all' }, COMMIT), q('commit_files', 1, { wholeParentRevision: true }, COMMIT)); return capture;
}
function addRelease(capture) {
  capture.releases.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: '600' }, author: clone(USER), draft: false, prerelease: false, publishedAt: WHEN, firstPublicationProof: 'unsupported' }); setCount(capture, 'releases', 1); return capture;
}
function run(capture, rest = {}) { return qualifyObservedCapture({ capture, subjectAccountId: ACCOUNT, growthStartDate: START, cutoffDate: CUTOFF, policyRegistry: REGISTRY, ...rest }); }
function okay(capture, rest) { const result = run(capture, rest); assert.equal(result.decision, 'qualified', result.code); assert.equal(result.progressionAuthorized, false); assert.equal(result.sourceAuthenticity, 'not_checked'); assert.equal(result.sourceModel, OBSERVED_SOURCE_MODEL); return result; }
function held(capture, code, rest) { const result = run(capture, rest); assert.equal(result.decision, 'hold'); if (code) assert.equal(result.code, code); assert.deepEqual(result.activities, []); assert.deepEqual(result.reviewHistoryFacts, []); assert.equal(result.progressionAuthorized, false); return result; }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('observed model empty complete scope is zero activity, not a successful source-authentication claim', () => {
  assert.deepEqual(okay(empty()).activities, []);
  held({ ...empty(), eligible: true }, 'OBSERVED_CAPTURE_INVALID');
  held({ ...empty(), model: 'legacy-v1' }, 'OBSERVED_MODEL_OR_SUBJECT_MISMATCH');
});

test('only exact fixed observed catalog ID and body are supported; historical registry is not reused', () => {
  const wrong = clone(REGISTRY); wrong.fileRules[0].id = 'fixture-file-rules-v1'; held(empty(), 'POLICY_UNSUPPORTED', { policyRegistry: wrong });
  wrong.fileRules[0].id = REGISTRY.fileRules[0].id; wrong.fileRules[0].body.categories[3].patterns.push('**/*.json'); held(empty(), 'POLICY_BODY_UNSUPPORTED', { policyRegistry: wrong });
  held(empty(), 'POLICY_UNSUPPORTED', { policyRegistry: {} });
});

test('source PR uses current exact casefold bug label and approved Recovery, with no merge-time claim', () => {
  const result = okay(addPr(empty(), { bugName: 'BuG' })); assert.deepEqual(result.activities[0].fact.families, ['recovery']); assert.equal(result.activities[0].fact.bugEvidenced, true);
  const settled = settleQualifiedActivities({ activities: result.activities }); assert.equal(settled.totalXp, '40');
  for (const bugName of [null, 'bugfix', 'debug', ' bug ', 'BUG REPORT']) { const result = okay(addPr(empty(), { bugName })); assert.deepEqual(result.activities[0].fact.families, ['craft']); assert.equal(result.activities[0].fact.bugEvidenced, false); }
});

test('all source file families classify once without multiplying merged-PR XP', () => {
  const result = okay(addPr(empty(), { paths: ['src/main.ts', 'docs/readme.md', 'tests/main.spec.ts', 'deploy/Dockerfile'] }));
  assert.deepEqual(result.activities[0].fact.families, ['craft', 'knowledge', 'verification', 'operations']); assert.equal(settleQualifiedActivities({ activities: result.activities }).totalXp, '40');
});

test('direct current ancestry uses original Git committed date, complete first-parent pair, never Recovery', () => {
  const result = okay(addCommit(empty())); const fact = result.activities[0].fact;
  assert.equal(fact.kind, 'direct_contribution'); assert.equal(fact.occurredAt, WHEN); assert.deepEqual(fact.families, ['craft']); assert.equal(settleQualifiedActivities({ activities: result.activities }).totalXp, '20');
  const capture = addCommit(empty()); capture.commits[0].firstParentOid = null; capture.commits[0].parentTreeOid = null;
  const f = capture.files[0]; Object.assign(f, { kind: 'added', beforePath: null, beforeOid: null, beforeText: null }); okay(capture);
});

test('current public full release uses publishedAt once and does not pretend original lifecycle is verified', () => {
  const result = okay(addRelease(empty())); assert.equal(result.activities[0].fact.kind, 'published_release'); assert.equal(result.activities[0].fact.occurredAt, WHEN); assert.equal(settleQualifiedActivities({ activities: result.activities }).totalXp, '35');
  for (const flag of ['draft', 'prerelease']) { const capture = addRelease(empty()); capture.releases[0][flag] = true; assert.equal(okay(capture).activities.length, 0); }
});

test('linked public issue current labels apply across repositories without expanding activity scope', () => {
  const capture = addPr(empty()); const ref = { repositoryId: '8001', sourceId: { type: 'numeric', value: '701' }, number: '9' };
  capture.pullRequests[0].closingIssueIds = [ref]; capture.queries[capture.queries.findIndex(q => q.kind === 'observed_closing_issues')] = closingQuery(1);
  capture.issues.push({ ...ref, author: clone(OTHER), createdAt: '2025-01-01T00:00:00Z', state: 'OPEN', visibility: 'public', currentLabels: [{ type: 'numeric', value: '702', name: 'BUG' }], labelsProof: 'complete_current_labels' });
  capture.queries.push(q('observed_current_labels', 1, { observation: 'current', targetKind: 'issue' }, '701', '8001'));
  assert.deepEqual(okay(capture).activities[0].fact.families, ['recovery']); assert.equal(capture.repositories.length, 1);
  capture.issues[0].visibility = 'private'; held(capture, 'ISSUE_VISIBILITY_INVALID');
});

test('confirmed private closing issues are excluded counts only; unknown link is a whole hold', () => {
  const capture = addPr(empty()); capture.pullRequests[0].excludedClosingIssueCount = 2;
  capture.queries[capture.queries.findIndex(q => q.kind === 'observed_closing_issues')] = closingQuery(0, 2);
  assert.deepEqual(okay(capture).activities[0].fact.families, ['craft']);
  capture.pullRequests[0].closingIssueIds.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: '701' }, number: '9' }); capture.pullRequests[0].excludedClosingIssueCount = 1;
  const closing = capture.queries.find(q => q.kind === 'observed_closing_issues'); closing.includedItems = 1; closing.excludedPrivateCount = 1; Object.assign(closing.pageSnapshots[0], { includedCount: 1, excludedPrivateCount: 1 });
  held(capture, 'LINKED_PUBLIC_ISSUE_UNAVAILABLE');
});

test('unknown/excluded binary paths do not contribute but remain full OID inventory', () => {
  for (const path of ['assets/photo.png', 'data/config.json', 'pnpm-lock.yaml', '.commitkin/card.png']) {
    const capture = addPr(empty(), { paths: [path] }); const f = capture.files[0]; f.contentProof = 'not_required'; delete f.beforeText; delete f.afterText;
    const result = okay(capture); assert.equal(result.activities.length, 0); assert.ok(result.exclusions.UNRECOGNIZED_FILE || result.exclusions.EXCLUDED_FILE);
  }
  assert.equal(classifyPath({ path: 'package.json', ruleBody: OBSERVED_FILE_RULES }), 'source');
  assert.deepEqual(okay(addCommit(empty(), { path: 'tsconfig.build.json' })).activities[0].fact.families, ['craft']);
});

test('known source missing full content is not treated as an unrecognized or zero-work event', () => {
  const capture = addPr(empty()); capture.files[0].contentProof = 'not_required'; delete capture.files[0].beforeText; delete capture.files[0].afterText; held(capture, 'FILE_CONTENT_PROOF_UNAVAILABLE');
  const tampered = addPr(empty()); tampered.files[0].afterText += 'tampered'; held(tampered, 'FILE_CONTENT_OID_MISMATCH');
});

test('README card-block-only changes are excluded only with exactly unchanged outside bytes', () => {
  const before = '# Profile\n<!-- COMMITKIN:START -->\nold\n<!-- COMMITKIN:END -->\nfooter\n'; const after = before.replace('old', 'new');
  const capture = addPr(empty(), { paths: ['README.md'] }); capture.files[0] = file('README.md', before, after);
  assert.equal(okay(capture).activities.length, 0); assert.equal(okay(capture).exclusions.MANAGED_README_ONLY_CHANGE, 1);
  capture.files[0] = file('README.md', before, after.replace('footer', 'real docs'));
  assert.deepEqual(okay(capture).activities[0].fact.families, ['knowledge']);
  capture.files[0] = file('README.md', before, after + '<!-- COMMITKIN:START --><!-- COMMITKIN:END -->'); assert.deepEqual(okay(capture).activities[0].fact.families, ['knowledge']);
});

test('first-analysis families and bugEvidenced freeze when current labels later change', () => {
  const capture = addPr(empty()); const original = okay(capture).activities[0].fact; const previousLedger = { owner: { accountId: ACCOUNT }, facts: [clone(original)] };
  capture.pullRequests[0].currentLabels = [{ type: 'numeric', value: '601', name: 'bug' }]; setCount(capture, 'observed_current_labels', 1);
  const replay = okay(capture, { previousLedger }); assert.deepEqual(replay.activities[0].fact, original); assert.equal(replay.retainedClassifications, 1);
  capture.pullRequests[0].mergedAt = '2026-10-14T07:00:00Z'; held(capture, 'RETAINED_SOURCE_IDENTITY_OR_TIME_CONFLICT', { previousLedger });
});

test('retained instant equality preserves original timestamp spelling, not rounded milliseconds', () => {
  const capture = addPr(empty()); const original = okay(capture).activities[0].fact; const previousLedger = { owner: { accountId: ACCOUNT }, facts: [clone(original)] };
  capture.pullRequests[0].mergedAt = WHEN.replace('Z', '.0000Z'); assert.equal(okay(capture, { previousLedger }).activities[0].fact.occurredAt, WHEN);
  capture.pullRequests[0].mergedAt = WHEN.replace('Z', '.0001Z'); held(capture, 'RETAINED_SOURCE_IDENTITY_OR_TIME_CONFLICT', { previousLedger });
  capture.pullRequests[0].mergedAt = '2026-10-16T00:00:00Z'; held(capture, 'RETAINED_SOURCE_IDENTITY_OR_TIME_CONFLICT', { previousLedger });
});

test('retained release current flags cannot remove past reward or lose known original ordering context', () => {
  const capture = addRelease(empty()); const original = okay(capture).activities[0].fact; const previousLedger = { owner: { accountId: ACCOUNT }, facts: [clone(original)] };
  for (const field of ['draft', 'prerelease']) { capture.releases[0][field] = true; assert.deepEqual(okay(capture, { previousLedger }).activities[0].fact, original); }
  capture.releases[0].publishedAt = WHEN.replace('Z', '.000Z'); assert.equal(okay(capture, { previousLedger }).activities[0].fact.occurredAt, WHEN);
  capture.releases[0].publishedAt = '2026-10-16T00:00:00Z'; held(capture, 'RETAINED_SOURCE_IDENTITY_OR_TIME_CONFLICT', { previousLedger });
  capture.releases[0].publishedAt = null; assert.equal(okay(capture, { previousLedger }).activities.length, 0);
});

test('direct parent/file/query and current head snapshot disagreement cannot authorize partial work', () => {
  const changes = [
    c => { c.repositories[0].defaultBranchHeadOid = 'f'.repeat(40); },
    c => { c.commits[0].parentTreeOid = null; },
    c => { c.commits[0].changedFiles = 2; },
    c => { c.queries = c.queries.filter(q => q.kind !== 'commit_files'); },
    c => { c.files[0].commitOid = '9'.repeat(40); },
    c => { c.files[0].observedBlobOid = '9'.repeat(40); },
  ];
  for (const change of changes) { const capture = addRelease(addCommit(empty())); change(capture); held(capture); }
});

test('conclusively irrelevant fork/direct and PR-represented commit do not demand unrelated source files', () => {
  const fork = addCommit(empty(), { fork: true }); fork.files = []; fork.commits[0].fileProof = 'not_collected'; fork.commits[0].fullFileContents = 'not_collected'; fork.queries = fork.queries.filter(q => q.kind !== 'commit_files'); assert.equal(okay(fork).activities.length, 0);
  const represented = addCommit(addPr(empty())); represented.commits[0].associatedPrIds = ['17']; setCount(represented, 'commit_pull_requests', 1); represented.files = represented.files.filter(f => f.pullRequestId); represented.commits[0].fileProof = 'not_collected'; represented.commits[0].fullFileContents = 'not_collected';
  represented.queries = represented.queries.filter(q => q.kind !== 'commit_files');
  assert.equal(okay(represented).activities.length, 1); assert.equal(okay(represented).exclusions.PR_REPRESENTED_COMMIT, 1);
});

test('missing required closures, counters, filters, fake eligible flag and duplicate source identities fail closed', () => {
  const changes = [
    c => { c.queries.pop(); }, c => { c.queries[0].closed = false; }, c => { c.queries[0].filters.eligible = true; },
    c => { c.queries[0].pageSnapshots[0].nextPath = '/repos/owner/project/pulls?page=2'; },
    c => { c.queries.find(q => q.kind === 'observed_current_labels').receivedItems = 3; },
    c => { c.queries.find(q => q.kind === 'observed_closing_issues').pageSnapshots[0].includedCount = 2; },
    c => { c.pullRequests.push(clone(c.pullRequests[0])); }, c => { c.files.push(clone(c.files[0])); },
    c => { c.pullRequests[0].author = { status: 'unavailable', reason: 'ACTOR_NOT_PROVIDED' }; },
  ];
  for (const change of changes) { const capture = addPr(empty()); change(capture); held(capture); }
});

test('UTC window is growth-start bounded; cutoff and future activities are never backdated to observation', () => {
  const capture = addRelease(addCommit(addPr(empty()))); capture.pullRequests[0].mergedAt = CUTOFF + 'T00:00:00Z'; capture.commits[0].committedAt = '2026-07-16T23:59:59Z'; capture.releases[0].publishedAt = '2026-10-16T00:00:00Z';
  assert.equal(okay(capture).activities.length, 0);
  held(empty(), 'OBSERVED_WINDOW_MISMATCH', { growthStartDate: '2026-10-01' });
});

function addReview(capture, { submittedAt = WHEN, sourceId = '300', state = 'APPROVED', reviewedCommitOid = COMMIT } = {}) {
  if (capture.pullRequests.length === 0) addPr(capture, { otherAuthor: true });
  capture.reviews.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: sourceId }, pullRequestId: '17', reviewer: clone(USER), state, submittedAt, reviewedCommitOid }); setCount(capture, 'pull_request_reviews', capture.reviews.length); return capture;
}
test('normal review and prior pre-growth review preserve earliest history without backfilling old growth', () => {
  const capture = addReview(empty()); const result = okay(capture); assert.equal(result.activities[0].fact.kind, 'submitted_review'); assert.equal(settleQualifiedActivities({ activities: result.activities, reviewHistoryFacts: result.reviewHistoryFacts }).totalXp, '25');
  addReview(capture, { sourceId: '299', submittedAt: '2026-07-16T00:00:00Z' }); const withHistory = okay(capture);
  assert.equal(withHistory.activities.length, 1); assert.equal(withHistory.reviewHistoryFacts.length, 2); assert.equal(settleQualifiedActivities({ activities: withHistory.activities, reviewHistoryFacts: withHistory.reviewHistoryFacts }).totalXp, '0');
});

test('PENDING cannot masquerade as submitted; unknown reviewer is hold instead of inactivity', () => {
  const pending = addReview(empty(), { state: 'PENDING', submittedAt: null, reviewedCommitOid: null }); assert.equal(okay(pending).activities.length, 0);
  pending.reviews[0].submittedAt = WHEN; held(pending, 'REVIEW_STATE_CONTRADICTION');
  const unknown = addReview(empty()); unknown.reviews[0].reviewer = { status: 'unavailable', reason: 'ACTOR_NOT_PROVIDED' }; held(unknown, 'REVIEW_ATTRIBUTION_UNAVAILABLE');
});

test('three distinct other-authored triaged issues qualify one per-repo UTC day; own or toggles do not', () => {
  const capture = empty();
  for (let i = 0; i < 3; i += 1) {
    const issueId = String(400 + i); capture.issues.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: issueId }, author: clone(OTHER), createdAt: '2025-01-01T00:00:00Z', currentLabels: [] });
    capture.issueEvents.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: String(500 + i) }, issueId, actor: clone(USER), occurredAt: '2026-10-14T0' + i + ':00:00Z', kind: 'labeled', target: { kind: 'label', sourceId: { type: 'numeric', value: '601' } } });
  }
  setCount(capture, 'repository_issue_events', 3); const result = okay(capture); assert.equal(result.activities[0].fact.kind, 'triage_day'); assert.equal(result.activities[0].fact.issueKeys.length, 3); assert.equal(settleQualifiedActivities({ activities: result.activities }).totalXp, '20');
  capture.issues[0].author = clone(USER); assert.equal(okay(capture).activities.length, 0);
});

test('conclusively other-person triage does not demand irrelevant issue proof; owner triage needs attribution', () => {
  const capture = empty(); capture.issueEvents.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: '501' }, issueId: '401', actor: clone(OTHER), occurredAt: WHEN, kind: 'assigned', target: { kind: 'assignee', accountId: '1002' } }); setCount(capture, 'repository_issue_events', 1);
  assert.equal(okay(capture).activities.length, 0);
  capture.issueEvents[0].actor = clone(USER); held(capture, 'TRIAGE_ISSUE_UNAVAILABLE');
  capture.issues.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: '401' }, author: { status: 'unavailable', reason: 'ACTOR_NOT_PROVIDED' }, createdAt: WHEN, currentLabels: [] }); held(capture, 'TRIAGE_ATTRIBUTION_UNAVAILABLE');
});

test('triage same-target toggles cannot satisfy threshold; assignee and milestone changes have typed identities', () => {
  const capture = empty();
  for (let i = 0; i < 3; i += 1) {
    const issueId = String(400 + i); capture.issues.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: issueId }, author: clone(OTHER), createdAt: WHEN, currentLabels: [] });
    capture.issueEvents.push({ repositoryId: REPO, sourceId: { type: 'numeric', value: String(500 + i) }, issueId, actor: clone(USER), occurredAt: WHEN, kind: i === 0 ? 'assigned' : 'milestoned', target: i === 0 ? { kind: 'assignee', accountId: '1002' } : { kind: 'milestone', sourceId: { type: 'numeric', value: '601' } } });
  }
  setCount(capture, 'repository_issue_events', 3); assert.equal(okay(capture).activities.length, 1);
  const toggle = clone(capture.issueEvents[0]); toggle.sourceId.value = '600'; toggle.kind = 'unassigned'; capture.issueEvents.push(toggle); setCount(capture, 'repository_issue_events', 4); const result = okay(capture); assert.equal(result.activities.length, 0); assert.equal(result.exclusions.REPEATED_TRIAGE_TOGGLE, 1);
});

test('permutation/replay and frozen inputs preserve exact facts without exposing raw observation metadata', () => {
  const capture = addRelease(addCommit(addPr(empty(), { paths: ['docs/a.md', 'src/a.ts'], bugName: 'bug' })));
  const before = clone(capture); const expected = okay(freeze(capture)); const shuffled = clone(before);
  for (const group of ['repositories', 'pullRequests', 'files', 'reviews', 'issues', 'issueEvents', 'releases', 'commits', 'queries']) shuffled[group].reverse();
  assert.deepEqual(okay(shuffled), expected); assert.deepEqual(capture, before);
  const publicFacts = JSON.stringify(expected.activities.map(row => row.fact)); for (const raw of ['beforeText', 'afterText', 'currentLabels', 'closingIssueIds', 'sourceId', 'diffHeadOid']) assert.equal(publicFacts.includes(raw), false);
  const first = settleQualifiedActivities({ activities: expected.activities, reviewHistoryFacts: expected.reviewHistoryFacts });
  const replay = settleQualifiedActivities({ activities: expected.activities, reviewHistoryFacts: expected.reviewHistoryFacts, previous: first, priorActivities: expected.activities }); assert.equal(replay.deltaXp, '0'); assert.equal(replay.totalXp, first.totalXp);
});

test('page arrays use explicit sequence and offsets rather than array position, without mutation', () => {
  const capture = empty(); const query = capture.queries[0]; query.pages = 2;
  query.pageSnapshots = [{ sequence: 2, requestPath: '/repos/owner/project/pulls?state=all&page=2', nextPath: null, itemCount: 0, startIndex: 0, endIndexExclusive: 0 }, { sequence: 1, requestPath: '/repos/owner/project/pulls?state=all', nextPath: '/repos/owner/project/pulls?state=all&page=2', itemCount: 0, startIndex: 0, endIndexExclusive: 0 }];
  const before = clone(capture); okay(freeze(capture)); assert.deepEqual(capture, before);
});

function aliasPages(capture, { suffix = 'pulls', initialQuery = 'state=all&per_page=100', nextPath = '/repositories/' + REPO + '/pulls?state=all&per_page=100&page=2' } = {}) {
  const query = capture.queries[0]; query.pages = 2;
  query.pageSnapshots = [{ sequence: 1, requestPath: '/repos/owner/project/' + suffix + '?' + initialQuery, itemCount: 0, nextPath, startIndex: 0, endIndexExclusive: 0 }, { sequence: 2, requestPath: nextPath, itemCount: 0, nextPath: null, startIndex: 0, endIndexExclusive: 0 }];
  return capture;
}
test('canonical repository-ID Link alias closes only the same verified repository endpoint and filters', () => {
  const capture = aliasPages(empty()); const before = clone(capture); assert.equal(okay(freeze(capture)).activities.length, 0); assert.deepEqual(capture, before);
  const reorderedQuery = aliasPages(empty(), { nextPath: '/repositories/' + REPO + '/pulls?page=2&per_page=100&state=all' }); okay(reorderedQuery);
  const threePages = aliasPages(empty()); const query = threePages.queries[0]; query.pages = 3;
  query.pageSnapshots[1].nextPath = '/repos/owner/project/pulls?state=all&per_page=100&page=3';
  query.pageSnapshots.push({ sequence: 3, requestPath: query.pageSnapshots[1].nextPath, itemCount: 0, nextPath: null, startIndex: 0, endIndexExclusive: 0 }); okay(threePages);
});

test('repository-ID pagination aliases cannot switch repository, host, endpoint, query, or traverse paths', () => {
  const invalid = [
    '/repositories/9999/pulls?state=all&per_page=100&page=2',
    '/repositories/09001/pulls?state=all&per_page=100&page=2',
    '/repositories/' + REPO + '/issues?state=all&per_page=100&page=2',
    '/repositories/' + REPO + '/pulls/17?state=all&per_page=100&page=2',
    'https://api.github.com/repositories/' + REPO + '/pulls?state=all&per_page=100&page=2',
    '//evil.invalid/repositories/' + REPO + '/pulls?state=all&per_page=100&page=2',
    '/repositories/' + REPO + '/pulls?state=closed&per_page=100&page=2',
    '/repositories/' + REPO + '/pulls?state=all&per_page=1&page=2',
    '/repositories/' + REPO + '/pulls?per_page=100&page=2',
    '/repositories/' + REPO + '/pulls?state=all&per_page=100&page=2&extra=true',
    '/repositories/' + REPO + '/pulls?state=all&per_page=100&page=3',
    '/repositories/' + REPO + '/pulls?state=all&per_page=100&page=2&page=2',
    '/repositories/' + REPO + '/pulls?state=all&per_page=100&after=opaque',
    '/repositories/' + REPO + '/x/../pulls?state=all&per_page=100&page=2',
    '/repositories/' + REPO + '/%2e%2e/' + REPO + '/pulls?state=all&per_page=100&page=2',
    '/repositories/' + REPO + '/pulls%2f..%2freleases?state=all&per_page=100&page=2',
    '/repositories/' + REPO + '/pulls?state=all&per_page=100&page=2#fragment',
    '/repositories/' + REPO + '/pulls%00?state=all&per_page=100&page=2',
    '/repositories/' + REPO + '/pulls%ZZ?state=all&per_page=100&page=2',
    '/repos/another/project/pulls?state=all&per_page=100&page=2',
  ];
  for (const nextPath of invalid) held(aliasPages(empty(), { nextPath }), 'OBSERVED_PAGE_PROVENANCE_INVALID');
  const noNamedBinding = aliasPages(empty()); noNamedBinding.queries[0].pageSnapshots[0].requestPath = '/repositories/' + REPO + '/pulls?state=all&per_page=100'; held(noNamedBinding, 'OBSERVED_PAGE_PROVENANCE_INVALID');
});
