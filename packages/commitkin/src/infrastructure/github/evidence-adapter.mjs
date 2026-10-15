import { digest, equivalent, scopeDigest } from '../../../../record-validator/src/domain/hash.js';
import { DEVELOPMENT_POLICY_REGISTRY } from '../policies.mjs';
import { compareTimestamps } from '../../domain/character/activity.mjs';

const ID = /^[1-9][0-9]*$/;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const HASH = /^v1:sha256:[0-9a-f]{64}$/;
const GROUPS = ['repositories', 'pullRequests', 'files', 'reviews', 'issues', 'issueEvents', 'releases', 'commits', 'queries'];
class AdapterFailure extends Error { constructor(code) { super(code); this.code = code; } }
function demand(value, code = 'CAPTURE_INPUT_INVALID') { if (!value) throw new AdapterFailure(code); }
const clone = value => structuredClone(value);
const numeric = value => typeof value === 'string' && ID.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const local = (kind, ...parts) => `${kind}-${digest(parts).split(':').at(-1)}`;
const sort = rows => [...rows].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0);
const source = row => row.sourceId?.value;
const numericSource = row => ({ type: 'numeric', value: source(row) });
const identifiedActor = actor => actor?.status === 'identified' && numeric(actor.accountId) && ['User', 'Bot'].includes(actor.type);
function actor(value) {
  if (identifiedActor(value)) return { status: 'identified', accountId: value.accountId, type: value.type };
  demand(value?.status === 'unavailable', 'CAPTURE_ACTOR_INVALID');
  return { status: 'unavailable', reason: 'SOURCE_NOT_PROVIDED' };
}
function unique(rows, key, code) {
  const result = new Map();
  for (const row of rows) { const id = key(row); demand(!result.has(id), code); result.set(id, row); }
  return result;
}
function checkedPolicies(policies) {
  demand(policies && Object.keys(policies).sort().join(',') === 'bugLabels,fileRules', 'POLICY_DESCRIPTOR_INVALID');
  for (const kind of ['fileRules', 'bugLabels']) {
    const p = policies[kind];
    demand(p && ['bundled', 'inline'].includes(p.mode), 'POLICY_DESCRIPTOR_INVALID');
    const known = DEVELOPMENT_POLICY_REGISTRY[kind].find(value => p.id === value.id && p.version === value.version);
    demand(known && p.hash === digest(known.body), 'POLICY_DESCRIPTOR_UNSUPPORTED');
    demand(Object.keys(p).sort().join(',') === (p.mode === 'inline' ? 'body,hash,id,mode,version' : 'hash,id,mode,version'), 'POLICY_DESCRIPTOR_INVALID');
    if (p.mode === 'inline') demand(equivalent(p.body, known.body), 'POLICY_DESCRIPTOR_UNSUPPORTED');
  }
  return clone(policies);
}

/** Verify retained page boundaries, not invented cursors or arbitrary provider URLs. */
function closedQuery(query) {
  demand(query?.closed === true && Number.isSafeInteger(query.pages) && query.pages >= 1 && Number.isSafeInteger(query.receivedItems) && query.receivedItems >= 0, 'CAPTURE_QUERY_INCOMPLETE');
  const snapshots = query.pageSnapshots;
  demand(snapshots, 'CAPTURE_PAGE_PROVENANCE_UNAVAILABLE');
  demand(Array.isArray(snapshots) && snapshots.length === query.pages, 'CAPTURE_PAGE_PROVENANCE_INVALID');
  const pages = [...snapshots].sort((a, b) => a.sequence - b.sequence);
  let offset = 0, expectedPath = null;
  const paths = new Set();
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    demand(p.sequence === i + 1 && Number.isSafeInteger(p.itemCount) && p.itemCount >= 0 && p.startIndex === offset && p.endIndexExclusive === offset + p.itemCount, 'CAPTURE_PAGE_PROVENANCE_INVALID');
    demand(typeof p.requestPath === 'string' && p.requestPath.startsWith('/repos/') && !p.requestPath.includes('://') && !paths.has(p.requestPath), 'CAPTURE_PAGE_PROVENANCE_INVALID');
    if (i > 0) demand(p.requestPath === expectedPath, 'CAPTURE_PAGE_PROVENANCE_INVALID');
    paths.add(p.requestPath); offset = p.endIndexExclusive;
    demand(i === pages.length - 1 ? p.nextPath === null : typeof p.nextPath === 'string' && p.nextPath.startsWith('/repos/') && !p.nextPath.includes('://'), 'CAPTURE_PAGE_PROVENANCE_INVALID');
    expectedPath = p.nextPath;
  }
  demand(offset === query.receivedItems, 'CAPTURE_PAGE_PROVENANCE_INVALID');
}

/**
 * Pure normalization of closed, composition-owned collector output. A normalized
 * page is a materialized logical projection over closed backing provider queries,
 * not a claimed extra HTTP GET or a fabricated original provider total/cursor.
 * Real backing multipage boundaries must be retained and checked before this join.
 */
export function adaptPublicCapture({ capture, context, candidateLedgerHash, previousLedgerHash, policies, capturedAt } = {}) {
  const base = { progressionAuthorized: false, sourceAuthenticity: 'not_checked', qualificationReady: false };
  try {
    demand(capture && GROUPS.every(key => Array.isArray(capture[key])) && numeric(capture.subjectAccountId));
    demand(context?.contextVersion === 1 && context.operation === 'normal' && context.expected?.evidenceVersion === 1 && context.expected.rulesetVersion === '1.0.0' && context.expected.adapter?.id === 'github.com' && context.expected.adapter.version === '1', 'CONTEXT_UNSUPPORTED');
    demand(capture.subjectAccountId === context.expected.subject.accountId && numeric(context.expected.subject.profileRepositoryId), 'SUBJECT_BINDING_MISMATCH');
    demand(timestamp(capturedAt) && timestamp(context.evaluation.startedAt) && timestamp(context.evaluation.inspectedAt) && compareTimestamps(context.evaluation.startedAt, capturedAt) <= 0 && compareTimestamps(capturedAt, context.evaluation.inspectedAt) <= 0, 'CAPTURE_TIME_INVALID');
    const cutoff = context.evaluation.startedAt.slice(0, 10), start = capture.window?.startDate;
    demand(date(start) && capture.window.cutoffDate === cutoff && start <= cutoff, 'CAPTURE_WINDOW_MISMATCH');
    demand(HASH.test(candidateLedgerHash) && (previousLedgerHash === null || HASH.test(previousLedgerHash)), 'LEDGER_BINDING_INVALID');
    demand(context.comparison?.mode === (previousLedgerHash === null ? 'snapshot_only' : 'with_previous'), 'PREVIOUS_MODE_MISMATCH');
    demand(Array.isArray(context.scope?.repositoryIds) && context.scope.repositoryIds.every(numeric), 'SCOPE_INVALID');
    const sortedIds = [...context.scope.repositoryIds].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
    demand(new Set(sortedIds).size === sortedIds.length && equivalent(sortedIds, context.scope.repositoryIds), 'SCOPE_INVALID');
    const repos = unique(capture.repositories, row => row.repositoryId, 'DUPLICATE_REPOSITORY_ID');
    demand(equivalent([...repos.keys()].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0), sortedIds), 'CAPTURE_SCOPE_MISMATCH');
    for (const repo of repos.values()) demand(numeric(repo.repositoryId) && numeric(repo.ownerAccountId) && ['User', 'Organization'].includes(repo.ownerType) && repo.visibility === 'public' && typeof repo.fork === 'boolean' && typeof repo.defaultBranch === 'string' && /\S/u.test(repo.defaultBranch), 'REPOSITORY_METADATA_INVALID');
    for (const q of capture.queries) { demand(repos.has(q.repositoryId), 'QUERY_SCOPE_INVALID'); closedQuery(q); }
    const queryMap = unique(capture.queries, q => JSON.stringify([q.kind, q.repositoryId, q.parentId ?? null]), 'DUPLICATE_QUERY');
    const query = (kind, repoId, parentId, filters) => {
      const q = queryMap.get(JSON.stringify([kind, repoId, parentId ?? null]));
      demand(q && equivalent(q.filters, filters), 'CAPTURE_QUERY_MISSING_OR_MISMATCH');
      return q;
    };
    const providerPages = capture.queries.reduce((n, q) => n + q.pages, 0);
    const collections = [], resources = { repositories: [], pullRequests: [], commits: [], reviews: [], releases: [], issues: [], issueEvents: [], fileChanges: [] };
    const inWindow = value => typeof value === 'string' && value.slice(0, 10) >= start && value.slice(0, 10) < cutoff;
    const beforeCutoff = value => value === null || typeof value === 'string' && value.slice(0, 10) < cutoff;
    function collection(kind, type, repoId, parentRef, purpose, items, window, filters, available = true) {
      const ref = local('collection', kind, repoId, parentRef ?? 'root');
      const c = { ref, resourceType: type, target: { kind: parentRef ? 'resource' : 'repository', repositoryId: repoId, ...(parentRef ? { resourceRef: parentRef } : {}) }, purpose, window, filters };
      if (available) c.state = 'captured', c.pages = [{ ref: local('page', ref), sequence: 1, capturedAt, requestCursor: null, response: { status: 'success', httpStatus: 200, itemRefs: [...items].sort(), pagination: { state: 'end', nextCursor: null }, truncation: 'not_reported', total: { status: 'provided', value: items.length } } }];
      else c.state = 'not_collected', c.pages = [], c.reason = 'UNSUPPORTED_SOURCE';
      collections.push(c); return c;
    }
    const snapshot = () => ({ kind: 'snapshot', observedAt: capturedAt });
    const interval = () => ({ kind: 'interval', startAt: `${start}T00:00:00Z`, endAtExclusive: `${cutoff}T00:00:00Z` });
    const history = () => ({ kind: 'history', throughExclusive: `${cutoff}T00:00:00Z` });
    const page = c => c.pages[0]?.ref;
    const key = row => JSON.stringify([row.repositoryId, source(row)]);
    for (const group of ['pullRequests', 'reviews', 'issues', 'issueEvents', 'releases']) {
      unique(capture[group], key, 'DUPLICATE_SOURCE_IDENTITY');
      demand(capture[group].every(row => repos.has(row.repositoryId) && row.sourceId?.type === 'numeric' && numeric(source(row))), 'SOURCE_IDENTIFIER_INVALID');
    }
    unique(capture.commits, row => JSON.stringify([row.repositoryId, row.oid]), 'DUPLICATE_SOURCE_IDENTITY');
    demand(capture.commits.every(row => repos.has(row.repositoryId) && OID.test(row.oid) && row.sourceId?.type === 'opaque' && source(row) === row.oid), 'COMMIT_METADATA_INVALID');
    const prRefs = new Map(capture.pullRequests.map(r => [key(r), local('pr', r.repositoryId, source(r))]));
    const issueRefs = new Map(capture.issues.map(r => [key(r), local('issue', r.repositoryId, source(r))]));
    const findPr = (repoId, id) => prRefs.get(JSON.stringify([repoId, id]));
    const findIssue = (repoId, id) => issueRefs.get(JSON.stringify([repoId, id]));
    const unavailableLabels = () => ({ status: 'unavailable', reason: 'INSUFFICIENT_HISTORY', captureRefs: [] });
    const unavailableTime = () => ({ status: 'unavailable', reason: 'UNSUPPORTED_SOURCE', captureRefs: [] });
    for (const repo of repos.values()) {
      const id = repo.repositoryId;
      const prs = capture.pullRequests.filter(r => r.repositoryId === id);
      const reviews = capture.reviews.filter(r => r.repositoryId === id && beforeCutoff(r.submittedAt));
      const events = capture.issueEvents.filter(r => r.repositoryId === id);
      const releases = capture.releases.filter(r => r.repositoryId === id);
      const commits = capture.commits.filter(r => r.repositoryId === id);
      demand(query('pull_requests', id, null, { state: 'all', creationCutoff: null }).receivedItems === prs.length, 'CAPTURE_COUNT_MISMATCH');
      demand(query('repository_issue_events', id, null, { enumeration: 'all', projectedActions: 'triage', projectedStartDate: start, projectedCutoffDate: cutoff }).receivedItems >= events.length, 'CAPTURE_COUNT_MISMATCH');
      demand(query('releases', id, null, { enumeration: 'all' }).receivedItems === releases.length, 'CAPTURE_COUNT_MISMATCH');
      demand(query('default_branch_commits', id, null, { branch: repo.defaultBranch, ancestry: 'all', reflectionTimeFromAuthorDate: false }).receivedItems === commits.length, 'CAPTURE_COUNT_MISMATCH');
      const repoRef = local('repo', id);
      const metadata = collection('repository-metadata', 'repository', id, null, 'metadata', [repoRef], snapshot(), {});
      resources.repositories.push({ ref: repoRef, repositoryId: id, captureRefs: [page(metadata)], sourceId: { type: 'numeric', value: id }, owner: { status: 'identified', accountId: repo.ownerAccountId, type: repo.ownerType }, visibility: 'public', fork: repo.fork, observedAt: capturedAt, defaultBranch: repo.defaultBranch });
      const prRoot = collection('merged-pr-activity', 'pull_request', id, null, 'activity', prs.filter(r => inWindow(r.mergedAt)).map(r => findPr(id, source(r))), interval(), { states: 'all' });
      const reviewRoot = collection('review-activity', 'review', id, null, 'activity', reviews.filter(r => inWindow(r.submittedAt)).map(r => local('review', id, source(r))), interval(), { states: 'all' });
      const releaseRoot = collection('release-activity', 'release', id, null, 'activity', releases.map(r => local('release', id, source(r))), interval(), {});
      const commitRoot = collection('default-branch-activity', 'commit', id, null, 'activity', commits.map(r => local('commit', id, r.oid)), interval(), { branch: 'default' });
      const eventRoot = collection('triage-activity', 'issue_event', id, null, 'activity', events.map(r => local('event', id, source(r))), interval(), { actions: 'triage' });
      for (const pr of prs) {
        const ref = findPr(id, source(pr));
        const detail = collection('pr-detail', 'pull_request', id, ref, 'metadata', [ref], snapshot(), { states: 'all' });
        const files = capture.files.filter(f => f.repositoryId === id && f.pullRequestId === source(pr));
        const fileQuery = queryMap.get(JSON.stringify(['pull_request_files', id, source(pr)]));
        demand(['not_collected', 'complete_revision_inventory'].includes(pr.fileProof), 'CAPTURE_FILE_PROOF_UNAVAILABLE');
        const inventoryCaptured = pr.fileProof === 'complete_revision_inventory';
        if (inventoryCaptured) {
          demand(fileQuery && OID.test(pr.diffBaseOid) && OID.test(pr.diffHeadOid) && pr.diffHeadOid === pr.headOid && (pr.state !== 'MERGED' || OID.test(pr.mergeCommitOid) && OID.test(pr.mergeParentOid)), 'CAPTURE_REVISION_PROOF_UNAVAILABLE');
          query('pull_request_files', id, source(pr), { wholeParentRevision: true });
          demand(fileQuery.receivedItems === files.length && pr.changedFiles === files.length, 'CAPTURE_FILE_COUNT_MISMATCH');
        } else demand(files.length === 0, 'UNBOUND_FILE_CAPTURE');
        const normalized = files.map(f => {
          const beforePath = f.beforePath !== undefined ? f.beforePath : f.kind === 'added' ? null : ['renamed', 'copied'].includes(f.kind) ? f.previousPath : f.path;
          const afterPath = f.afterPath !== undefined ? f.afterPath : f.kind === 'removed' ? null : f.path;
          demand(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(f.kind), 'CAPTURE_FILE_METADATA_INVALID');
          const path = value => typeof value === 'string' && /\S/u.test(value) && value.isWellFormed();
          const oid = value => typeof value === 'string' && OID.test(value);
          const beforePresent = f.kind !== 'added', afterPresent = f.kind !== 'removed';
          if (!(beforePresent ? path(beforePath) && oid(f.beforeOid) : beforePath === null && f.beforeOid === null) || !(afterPresent ? path(afterPath) && oid(f.afterOid) : afterPath === null && f.afterOid === null)) return null;
          if (f.contentProof === 'text_pair') demand((beforePresent ? typeof f.beforeText === 'string' && f.beforeText.isWellFormed() : f.beforeText === null) && (afterPresent ? typeof f.afterText === 'string' && f.afterText.isWellFormed() : f.afterText === null), 'CAPTURE_FILE_CONTENT_INVALID');
          const out = { ref: local('file', id, source(pr), beforePath, afterPath), repositoryId: id, captureRefs: [], parentRef: ref, kind: f.kind, beforePath, afterPath, beforeOid: f.beforeOid, afterOid: f.afterOid, content: f.contentProof === 'text_pair' ? { mode: 'text_pair', beforeText: f.beforeText, afterText: f.afterText } : { mode: 'unavailable', reason: 'CONTENT_UNAVAILABLE' } };
          return out;
        });
        if (inventoryCaptured) demand(normalized.every(Boolean), 'CAPTURE_FILE_METADATA_INVALID');
        const haveMetadata = inventoryCaptured && normalized.every(Boolean);
        const fileCollection = collection('parent-file-changes', 'file_change', id, ref, 'changes', haveMetadata ? normalized.map(f => f.ref) : [], snapshot(), {}, haveMetadata);
        if (haveMetadata) for (const f of normalized) { f.captureRefs = [page(fileCollection)]; resources.fileChanges.push(f); }
        const allReviews = capture.reviews.filter(r => r.repositoryId === id && r.pullRequestId === source(pr));
        demand(query('pull_request_reviews', id, source(pr), { states: 'all', history: 'all' }).receivedItems === allReviews.length, 'CAPTURE_REVIEW_COUNT_MISMATCH');
        const prior = allReviews.filter(r => beforeCutoff(r.submittedAt));
        const reviewHistory = collection('prior-pr-reviews', 'review', id, ref, 'history', prior.map(r => local('review', id, source(r))), history(), { states: 'all' });
        demand(['OPEN', 'CLOSED', 'MERGED'].includes(pr.state) && timestamp(pr.createdAt) && (pr.state === 'MERGED' ? timestamp(pr.mergedAt) : pr.mergedAt === null) && pr.baseRepositoryId === id && (pr.headRepositoryId === null || numeric(pr.headRepositoryId)) && OID.test(pr.diffBaseOid ?? pr.baseOid) && OID.test(pr.diffHeadOid ?? pr.headOid), 'PR_METADATA_INVALID');
        resources.pullRequests.push({ ref, repositoryId: id, captureRefs: [page(detail), ...(inWindow(pr.mergedAt) ? [page(prRoot)] : [])], sourceId: numericSource(pr), author: actor(pr.author), state: pr.state, createdAt: pr.createdAt, mergedAt: pr.mergedAt, baseRepositoryId: pr.baseRepositoryId, headRepositoryId: pr.headRepositoryId, baseOid: pr.diffBaseOid ?? pr.baseOid, headOid: pr.diffHeadOid ?? pr.headOid, fileCollectionRef: fileCollection.ref, labels: unavailableLabels(), closingIssueRefs: [] });
        for (const review of prior) {
          demand(['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state) && (review.state === 'PENDING' ? review.submittedAt === null && (review.reviewedCommitOid === null || OID.test(review.reviewedCommitOid)) : timestamp(review.submittedAt) && OID.test(review.reviewedCommitOid)), 'REVIEW_METADATA_INVALID');
          resources.reviews.push({ ref: local('review', id, source(review)), repositoryId: id, captureRefs: [page(reviewHistory), ...(inWindow(review.submittedAt) ? [page(reviewRoot)] : [])], sourceId: numericSource(review), pullRequestRef: ref, reviewer: actor(review.reviewer), state: review.state, submittedAt: review.submittedAt, reviewedCommitOid: review.reviewedCommitOid });
        }
      }
      for (const issue of capture.issues.filter(r => r.repositoryId === id)) {
        demand(timestamp(issue.createdAt), 'ISSUE_METADATA_INVALID');
        const ref = findIssue(id, source(issue));
        const detail = collection('issue-detail', 'issue', id, ref, 'metadata', [ref], snapshot(), { includePullRequests: false });
        resources.issues.push({ ref, repositoryId: id, captureRefs: [page(detail)], sourceId: numericSource(issue), author: actor(issue.author), createdAt: issue.createdAt, labels: unavailableLabels() });
      }
      for (const event of events) {
        demand(timestamp(event.occurredAt) && inWindow(event.occurredAt) && findIssue(id, event.issueId), 'ISSUE_EVENT_PARENT_OR_WINDOW_INVALID');
        const expectedKind = ['labeled', 'unlabeled'].includes(event.kind) ? 'label' : ['assigned', 'unassigned'].includes(event.kind) ? 'assignee' : ['milestoned', 'demilestoned'].includes(event.kind) ? 'milestone' : null;
        demand(expectedKind && event.target?.kind === expectedKind && (expectedKind === 'assignee' ? numeric(event.target.accountId) : event.target.sourceId?.type === 'numeric' && numeric(event.target.sourceId.value)), 'ISSUE_EVENT_TARGET_INVALID');
        const target = expectedKind === 'assignee' ? { kind: expectedKind, accountId: event.target.accountId } : { kind: expectedKind, sourceId: { type: 'numeric', value: event.target.sourceId.value } };
        resources.issueEvents.push({ ref: local('event', id, source(event)), repositoryId: id, captureRefs: [page(eventRoot)], sourceId: numericSource(event), issueRef: findIssue(id, event.issueId), actor: actor(event.actor), occurredAt: event.occurredAt, kind: event.kind, target });
      }
      for (const release of releases) {
        demand(typeof release.draft === 'boolean' && typeof release.prerelease === 'boolean' && (release.publishedAt === null || timestamp(release.publishedAt)), 'RELEASE_METADATA_INVALID');
        resources.releases.push({ ref: local('release', id, source(release)), repositoryId: id, captureRefs: [page(releaseRoot)], sourceId: numericSource(release), author: actor(release.author), draft: release.draft, prerelease: release.prerelease, publishedAt: release.publishedAt, firstPublication: unavailableTime() });
      }
      for (const commit of commits) {
        demand(OID.test(commit.oid) && commit.sourceId?.type === 'opaque' && source(commit) === commit.oid, 'COMMIT_METADATA_INVALID');
        const ref = local('commit', id, commit.oid);
        const available = Array.isArray(commit.associatedPrIds);
        const associations = available ? commit.associatedPrIds.map(prId => { const prRef = findPr(id, prId); demand(prRef, 'ASSOCIATED_PR_DETAIL_UNAVAILABLE'); return prRef; }) : [];
        if (available) demand(query('commit_pull_requests', id, commit.oid, { enumeration: 'all' }).receivedItems === associations.length, 'CAPTURE_ASSOCIATION_COUNT_MISMATCH');
        const files = collection('commit-file-changes', 'file_change', id, ref, 'changes', [], snapshot(), {}, false);
        const pulls = collection('commit-pr-associations', 'pr_association', id, ref, 'relations', associations, snapshot(), {}, available);
        resources.commits.push({ ref, repositoryId: id, captureRefs: [page(commitRoot)], sourceId: { type: 'opaque', value: commit.oid }, oid: commit.oid, author: actor(commit.author), reflectedAt: unavailableTime(), fileCollectionRef: files.ref, pullRequestCollectionRef: pulls.ref });
      }
    }
    demand(capture.reviews.every(r => findPr(r.repositoryId, r.pullRequestId)), 'REVIEW_PARENT_UNAVAILABLE');
    demand(capture.files.every(r => findPr(r.repositoryId, r.pullRequestId)), 'FILE_PARENT_UNAVAILABLE');
    const evidence = { evidenceVersion: 1, rulesetVersion: '1.0.0', adapter: { id: 'github.com', version: '1' }, subject: { accountId: context.expected.subject.accountId, profileRepositoryId: context.expected.subject.profileRepositoryId }, evaluation: { startedAt: context.evaluation.startedAt, capturedThrough: capturedAt, activityCutoffExclusive: cutoff }, binding: { scopeId: scopeDigest({ rulesetVersion: '1.0.0', analysisConfigHash: digest({ rulesetVersion: '1.0.0', publicOnly: true }), repositoryIds: sortedIds }), settingsHash: digest(context.normalizedSettings), candidateLedgerHash, previousLedgerHash }, policies: checkedPolicies(policies), collections: sort(collections), resources: Object.fromEntries(Object.entries(resources).map(([group, values]) => [group, sort(values)])) };
    return { ...base, decision: 'adapted', code: 'PUBLIC_CAPTURE_ADAPTED', evidence, provenance: { interpretation: 'normalized-logical-projections', providerQueries: capture.queries.length, providerPages, logicalCollections: collections.length }, notChecked: ['sourceAuthenticity', 'defaultBranchReflectionHistory', 'originalReleaseLifecycle', 'historicalBugLabelState', 'initialAssignmentProvenance'] };
  } catch (error) {
    return { ...base, decision: 'hold', code: error instanceof AdapterFailure ? error.code : 'CAPTURE_ADAPTER_UNAVAILABLE', evidence: null };
  }
}
