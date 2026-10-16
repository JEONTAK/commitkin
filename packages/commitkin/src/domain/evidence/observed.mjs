import { activityIdentity } from './qualify.mjs';
import canonicalize from 'canonicalize';
import { classifyFileEvidence, classifyPath, OBSERVED_FILE_RULES, FileEvidenceFailure } from './files.mjs';
import { compareTimestamps, shiftDate } from '../character/activity.mjs';

export const OBSERVED_SOURCE_MODEL = 'observed-api-v1';
const ID = /^[1-9][0-9]*$/;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const HASH = /^v1:sha256:[0-9a-f]{64}$/;
const GROUPS = ['repositories', 'pullRequests', 'files', 'reviews', 'issues', 'issueEvents', 'releases', 'commits', 'queries'];
const FAMILIES = ['craft', 'guard', 'knowledge', 'verification', 'recovery', 'operations'];
class ObservedFailure extends Error { constructor(code) { super(code); this.code = code; } }
function need(value, code = 'OBSERVED_CAPTURE_INVALID') { if (!value) throw new ObservedFailure(code); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function shape(value, required, optional = []) { need(plain(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key))); }
function id(value) { need(typeof value === 'string' && ID.test(value), 'SOURCE_IDENTIFIER_INVALID'); return value; }
function oid(value, nullable = false) { if (nullable && value === null) return null; need(typeof value === 'string' && OID.test(value), 'SOURCE_OID_INVALID'); return value; }
function count(value) { need(Number.isSafeInteger(value) && value >= 0, 'OBSERVED_COUNT_INVALID'); return value; }
function date(value) { need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value, 'OBSERVED_DATE_INVALID'); return value; }
function time(value, nullable = false) {
  if (nullable && value === null) return null;
  need(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'SOURCE_TIMESTAMP_INVALID'); return value;
}
function source(value, type = 'numeric') { shape(value, ['type', 'value']); need(value.type === type); return type === 'numeric' ? id(value.value) : oid(value.value); }
function actor(value, subject) {
  need(plain(value));
  if (value.status === 'unavailable') { shape(value, ['status', 'reason']); need(typeof value.reason === 'string'); return 'unknown'; }
  shape(value, ['status', 'accountId', 'type']); need(value.status === 'identified' && ['User', 'Bot'].includes(value.type)); id(value.accountId);
  return value.type === 'Bot' ? 'bot' : value.accountId === subject ? 'subject' : 'other';
}
function labels(values, requireNames = false) {
  need(Array.isArray(values), 'CURRENT_LABELS_UNAVAILABLE'); const seen = new Set();
  for (const value of values) {
    shape(value, ['type', 'value'], ['name']); need(value.type === 'numeric' && !seen.has(id(value.value)), 'CURRENT_LABELS_INVALID'); seen.add(value.value);
    if (requireNames || value.name !== undefined) need(typeof value.name === 'string' && value.name.isWellFormed() && value.name.length > 0 && value.name.length <= 1024 && !/[\u0000-\u001f\u007f]/u.test(value.name), 'CURRENT_LABELS_UNAVAILABLE');
  }
  return values.some(value => value.name?.toLowerCase() === 'bug');
}
function unique(rows, key, code = 'DUPLICATE_SOURCE_IDENTITY') { const map = new Map(); for (const row of rows) { const value = key(row); need(!map.has(value), code); map.set(value, row); } return map; }
function numericOrder(a, b) { return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0; }

function restPagePath(value) {
  need(typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !/[\s#\\\u0000-\u001f\u007f]/u.test(value), 'OBSERVED_PAGE_PROVENANCE_INVALID');
  let url;
  try {
    url = new URL(value, 'https://api.github.com');
    need(url.origin === 'https://api.github.com' && url.pathname === value.split('?')[0], 'OBSERVED_PAGE_PROVENANCE_INVALID');
    for (const segment of url.pathname.slice(1).split('/')) {
      const decoded = decodeURIComponent(segment);
      need(decoded.length > 0 && !['.', '..'].includes(decoded) && !/[\/\\\u0000-\u001f\u007f]/u.test(decoded), 'OBSERVED_PAGE_PROVENANCE_INVALID');
    }
  } catch { throw new ObservedFailure('OBSERVED_PAGE_PROVENANCE_INVALID'); }
  return url;
}
function restPageBinding(firstPath, repositoryId) {
  const first = restPagePath(firstPath);
  const named = first.pathname.match(/^\/repos\/[^/]+\/[^/]+(\/.+)$/u);
  need(named, 'OBSERVED_PAGE_PROVENANCE_INVALID');
  const query = url => canonicalize([...url.searchParams].filter(([key]) => key !== 'page').sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const initialQuery = query(first); const aliasPath = '/repositories/' + repositoryId + named[1];
  return (value, sequence) => {
    const url = restPagePath(value); const pages = url.searchParams.getAll('page');
    need((url.pathname === first.pathname || url.pathname === aliasPath) && query(url) === initialQuery, 'OBSERVED_PAGE_PROVENANCE_INVALID');
    need(sequence === 1 ? pages.length === 0 || pages.length === 1 && pages[0] === '1' : pages.length === 1 && pages[0] === String(sequence), 'OBSERVED_PAGE_PROVENANCE_INVALID');
  };
}

function checkQuery(q) {
  shape(q, ['kind', 'repositoryId', 'filters', 'receivedItems', 'pages', 'closed', 'pageSnapshots'], ['parentId', 'includedItems', 'excludedPrivateCount', 'totalCount']);
  const filterKeys = {
    pull_requests: ['state', 'creationCutoff'], releases: ['enumeration'],
    default_branch_commits: ['branch', 'headOid', 'ancestry', 'reflectionTimeFromAuthorDate'],
    repository_issue_events: ['enumeration', 'projectedActions', 'projectedStartDate', 'projectedCutoffDate'],
    pull_request_reviews: ['states', 'history'], pull_request_files: ['wholeParentRevision'],
    commit_pull_requests: ['enumeration'], commit_files: ['wholeParentRevision'], observed_current_labels: ['observation', 'targetKind'],
    observed_closing_issues: ['observation', 'excludeUserLinked'],
  };
  id(q.repositoryId); need(Object.hasOwn(filterKeys, q.kind), 'OBSERVED_QUERY_KIND_UNSUPPORTED'); shape(q.filters, filterKeys[q.kind]);
  const f = q.filters;
  need({
    pull_requests: f.state === 'all' && f.creationCutoff === null,
    releases: f.enumeration === 'all', default_branch_commits: f.ancestry === 'all' && f.reflectionTimeFromAuthorDate === false,
    repository_issue_events: f.enumeration === 'all' && f.projectedActions === 'triage',
    pull_request_reviews: f.states === 'all' && f.history === 'all', pull_request_files: f.wholeParentRevision === true,
    commit_pull_requests: f.enumeration === 'all', commit_files: f.wholeParentRevision === true,
    observed_current_labels: f.observation === 'current' && ['pull_request', 'issue'].includes(f.targetKind),
    observed_closing_issues: f.observation === 'current' && f.excludeUserLinked === false,
  }[q.kind], 'OBSERVED_QUERY_FILTER_MISMATCH');
  const root = ['pull_requests', 'releases', 'default_branch_commits', 'repository_issue_events'].includes(q.kind);
  need(root ? q.parentId === undefined : q.parentId !== undefined, 'OBSERVED_QUERY_PARENT_INVALID');
  if (!root) ['commit_pull_requests', 'commit_files'].includes(q.kind) ? oid(q.parentId) : id(q.parentId);
  if (q.kind !== 'observed_closing_issues') need(q.includedItems === undefined && q.excludedPrivateCount === undefined && q.totalCount === undefined, 'OBSERVED_QUERY_COUNT_MISMATCH');
  else { count(q.includedItems); count(q.excludedPrivateCount); need(q.includedItems + q.excludedPrivateCount === q.receivedItems && (q.totalCount === undefined || q.totalCount === q.receivedItems), 'OBSERVED_QUERY_COUNT_MISMATCH'); }
  need(q.closed === true && count(q.pages) >= 1 && q.pages <= 100 && Array.isArray(q.pageSnapshots) && q.pageSnapshots.length === q.pages, 'OBSERVED_QUERY_INCOMPLETE'); count(q.receivedItems);
  const snapshots = [...q.pageSnapshots].sort((a, b) => a.sequence - b.sequence); let offset = 0; let next = null; let included = 0; let excluded = 0; const paths = new Set();
  const checkRestPath = q.kind === 'observed_closing_issues' ? null : restPageBinding(snapshots[0]?.requestPath, q.repositoryId);
  for (let index = 0; index < snapshots.length; index += 1) {
    const page = snapshots[index]; const graphql = q.kind === 'observed_closing_issues';
    shape(page, graphql ? ['sequence', 'requestCursor', 'endCursor', 'hasNextPage', 'itemCount', 'startIndex', 'endIndexExclusive', 'includedCount', 'excludedPrivateCount'] : ['sequence', 'requestPath', 'itemCount', 'nextPath', 'startIndex', 'endIndexExclusive']);
    need(page.sequence === index + 1 && count(page.itemCount) >= 0 && page.startIndex === offset && page.endIndexExclusive === offset + page.itemCount, 'OBSERVED_PAGE_PROVENANCE_INVALID'); offset = page.endIndexExclusive;
    if (graphql) {
      included += count(page.includedCount); excluded += count(page.excludedPrivateCount); need(page.includedCount + page.excludedPrivateCount === page.itemCount, 'OBSERVED_PAGE_PROVENANCE_INVALID');
      need(page.requestCursor === next && typeof page.hasNextPage === 'boolean', 'OBSERVED_PAGE_PROVENANCE_INVALID');
      if (index === snapshots.length - 1) need(page.hasNextPage === false && (page.endCursor === null || typeof page.endCursor === 'string'), 'OBSERVED_PAGE_PROVENANCE_INVALID');
      else { need(page.hasNextPage === true && typeof page.endCursor === 'string' && page.endCursor.length > 0 && !paths.has(page.endCursor), 'OBSERVED_PAGE_PROVENANCE_INVALID'); paths.add(page.endCursor); }
      next = page.endCursor;
    } else {
      checkRestPath(page.requestPath, index + 1);
      need(!paths.has(page.requestPath) && (index === 0 || page.requestPath === next), 'OBSERVED_PAGE_PROVENANCE_INVALID'); paths.add(page.requestPath);
      if (index === snapshots.length - 1) need(page.nextPath === null, 'OBSERVED_PAGE_PROVENANCE_INVALID');
      else checkRestPath(page.nextPath, index + 2);
      next = page.nextPath;
    }
  }
  need(offset === q.receivedItems && (q.kind !== 'observed_closing_issues' || included === q.includedItems && excluded === q.excludedPrivateCount), 'OBSERVED_PAGE_PROVENANCE_INVALID');
}

/**
 * Composition-owned acquisition model, never a JSON import/trust switch.
 * Approved observation semantics: current default-branch membership + Git commit
 * committed date; current public release flags + published_at; first eligible
 * analysis's current labels/resolving links. No historical-time claims are made.
 */
export function qualifyObservedCapture({ capture, subjectAccountId, growthStartDate, cutoffDate, previousLedger = null, policyRegistry } = {}) {
  const exclusions = {}; let retainedClassifications = 0;
  const exclude = code => { exclusions[code] = (exclusions[code] ?? 0) + 1; };
  const orderedExclusions = () => Object.fromEntries(Object.keys(exclusions).sort().map(key => [key, exclusions[key]]));
  const base = () => ({ sourceModel: OBSERVED_SOURCE_MODEL, exclusions: orderedExclusions(), retainedClassifications, sourceAuthenticity: 'not_checked', progressionAuthorized: false });
  try {
    id(subjectAccountId); date(growthStartDate); date(cutoffDate);
    const start = [growthStartDate, shiftDate(cutoffDate, -90)].sort().at(-1); need(start <= cutoffDate, 'GROWTH_WINDOW_INVALID');
    shape(capture, ['model', 'subjectAccountId', 'window', ...GROUPS]); need(capture.model === OBSERVED_SOURCE_MODEL && capture.subjectAccountId === subjectAccountId, 'OBSERVED_MODEL_OR_SUBJECT_MISMATCH');
    shape(capture.window, ['startDate', 'cutoffDate']); need(capture.window.startDate === start && capture.window.cutoffDate === cutoffDate, 'OBSERVED_WINDOW_MISMATCH');
    for (const name of GROUPS) need(Array.isArray(capture[name]));
    const inWindow = value => typeof value === 'string' && value.slice(0, 10) >= start && value.slice(0, 10) < cutoffDate;
    const fileEntries = policyRegistry?.fileRules;
    need(Array.isArray(fileEntries) && fileEntries.length === 1 && fileEntries[0].id === 'commitkin-observed-files-v1' && fileEntries[0].version === '1', 'POLICY_UNSUPPORTED');
    const fileRules = fileEntries[0].body;
    need(canonicalize(fileRules) === canonicalize(OBSERVED_FILE_RULES), 'POLICY_BODY_UNSUPPORTED');
    const repos = unique(capture.repositories, repo => id(repo.repositoryId));
    for (const repo of repos.values()) {
      shape(repo, ['repositoryId', 'ownerAccountId', 'ownerType', 'visibility', 'fork', 'archived', 'defaultBranch', 'defaultBranchHeadOid']); id(repo.ownerAccountId); oid(repo.defaultBranchHeadOid);
      need(['User', 'Organization'].includes(repo.ownerType) && repo.visibility === 'public' && typeof repo.fork === 'boolean' && typeof repo.archived === 'boolean' && typeof repo.defaultBranch === 'string' && /\S/u.test(repo.defaultBranch), 'REPOSITORY_METADATA_INVALID');
    }
    for (const query of capture.queries) checkQuery(query);
    const queryMap = unique(capture.queries, q => JSON.stringify([q.kind, q.repositoryId, q.parentId ?? null]), 'DUPLICATE_QUERY');
    const query = (kind, repositoryId, parentId = null, expectedCount = null) => {
      const value = queryMap.get(JSON.stringify([kind, repositoryId, parentId])); need(value, 'OBSERVED_REQUIRED_QUERY_MISSING');
      if (expectedCount !== null) need(value.receivedItems === expectedCount, 'OBSERVED_QUERY_COUNT_MISMATCH'); return value;
    };
    const resourceKey = row => id(row.repositoryId) + '/' + source(row.sourceId);
    const prs = unique(capture.pullRequests, resourceKey); const issues = unique(capture.issues, resourceKey);
    unique(capture.reviews, resourceKey); unique(capture.releases, resourceKey); unique(capture.issueEvents, resourceKey);
    const commits = unique(capture.commits, row => id(row.repositoryId) + '/' + source(row.sourceId, 'opaque'));
    for (const issue of issues.values()) {
      shape(issue, ['repositoryId', 'sourceId', 'author', 'createdAt', 'currentLabels'], ['number', 'visibility', 'state', 'labelsProof']);
      actor(issue.author, subjectAccountId); time(issue.createdAt); labels(issue.currentLabels);
      if (issue.number !== undefined) id(issue.number);
      if (issue.visibility !== undefined) need(issue.visibility === 'public', 'ISSUE_VISIBILITY_INVALID');
      if (issue.state !== undefined) need(['OPEN', 'CLOSED'].includes(issue.state), 'ISSUE_STATE_INVALID');
      if (issue.labelsProof !== undefined) need(issue.labelsProof === 'complete_current_labels', 'CURRENT_LABELS_UNAVAILABLE');
      need(repos.has(issue.repositoryId) || issue.visibility === 'public', 'LINKED_PUBLIC_ISSUE_UNAVAILABLE');
    }
    for (const q of capture.queries) {
      if (q.kind === 'observed_current_labels') {
        const row = (q.filters.targetKind === 'issue' ? issues : prs).get(q.repositoryId + '/' + q.parentId); need(row, 'OBSERVED_QUERY_PARENT_INVALID');
        labels(row.currentLabels, true); need(row.currentLabels.length === q.receivedItems, 'OBSERVED_QUERY_COUNT_MISMATCH');
      } else if (['commit_pull_requests', 'commit_files'].includes(q.kind)) {
        const commit = commits.get(q.repositoryId + '/' + q.parentId); need(commit, 'OBSERVED_QUERY_PARENT_INVALID');
        if (q.kind === 'commit_pull_requests') need(Array.isArray(commit.associatedPrIds) && commit.associatedPrIds.length === q.receivedItems, 'OBSERVED_QUERY_COUNT_MISMATCH');
      }
      else if (q.parentId !== undefined) need(prs.has(q.repositoryId + '/' + q.parentId), 'OBSERVED_QUERY_PARENT_INVALID');
      else need(repos.has(q.repositoryId), 'OBSERVED_QUERY_PARENT_INVALID');
      if (['pull_request_files', 'commit_files'].includes(q.kind)) need(q.receivedItems === capture.files.filter(file => file.repositoryId === q.repositoryId && (q.kind === 'commit_files' ? file.commitOid : file.pullRequestId) === q.parentId).length, 'OBSERVED_QUERY_COUNT_MISMATCH');
    }
    for (const repo of repos.values()) {
      const pull = query('pull_requests', repo.repositoryId, null, capture.pullRequests.filter(row => row.repositoryId === repo.repositoryId).length); need(pull.filters.state === 'all' && pull.filters.creationCutoff === null, 'OBSERVED_QUERY_FILTER_MISMATCH');
      const releases = query('releases', repo.repositoryId, null, capture.releases.filter(row => row.repositoryId === repo.repositoryId).length); need(releases.filters.enumeration === 'all', 'OBSERVED_QUERY_FILTER_MISMATCH');
      const commits = query('default_branch_commits', repo.repositoryId, null, capture.commits.filter(row => row.repositoryId === repo.repositoryId).length); need(commits.filters.branch === repo.defaultBranch && commits.filters.headOid === repo.defaultBranchHeadOid && commits.filters.ancestry === 'all' && commits.filters.reflectionTimeFromAuthorDate === false, 'OBSERVED_QUERY_FILTER_MISMATCH');
      const events = query('repository_issue_events', repo.repositoryId); need(events.filters.enumeration === 'all' && events.filters.projectedActions === 'triage' && events.filters.projectedStartDate === start && events.filters.projectedCutoffDate === cutoffDate && events.receivedItems >= capture.issueEvents.filter(row => row.repositoryId === repo.repositoryId).length, 'OBSERVED_QUERY_FILTER_MISMATCH');
    }
    unique(capture.files, file => canonicalize([file.repositoryId, file.pullRequestId ?? file.commitOid, file.path]), 'DUPLICATE_FILE_INVENTORY');
    for (const file of capture.files) {
      shape(file, ['repositoryId', 'path', 'previousPath', 'kind', 'observedBlobOid', 'beforePath', 'afterPath', 'beforeOid', 'afterOid', 'contentProof'], ['pullRequestId', 'commitOid', 'beforeText', 'afterText']); id(file.repositoryId);
      need((file.pullRequestId !== undefined) !== (file.commitOid !== undefined), 'FILE_PARENT_MISMATCH');
      if (file.pullRequestId !== undefined) need(prs.has(file.repositoryId + '/' + id(file.pullRequestId)), 'FILE_PARENT_MISMATCH'); else need(commits.has(file.repositoryId + '/' + oid(file.commitOid)), 'FILE_PARENT_MISMATCH');
      need(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(file.kind), 'FILE_METADATA_INVALID');
      const category = classifyPath({ path: file.afterPath ?? file.beforePath, ruleBody: fileRules });
      need(file.contentProof === 'text_pair' || file.contentProof === 'not_required' && ['excluded', 'unmatched'].includes(category), 'FILE_CONTENT_PROOF_UNAVAILABLE');
      if (file.contentProof === 'not_required') need(!Object.hasOwn(file, 'beforeText') && !Object.hasOwn(file, 'afterText'), 'FILE_METADATA_INVALID');
      for (const side of ['before', 'after']) {
        const present = side === 'before' ? file.kind !== 'added' : file.kind !== 'removed';
        need(present ? typeof file[side + 'Path'] === 'string' && file[side + 'Path'].length > 0 && OID.test(file[side + 'Oid']) : file[side + 'Path'] === null && file[side + 'Oid'] === null, 'FILE_METADATA_INVALID');
        if (present) classifyPath({ path: file[side + 'Path'], ruleBody: fileRules });
        if (file.contentProof === 'text_pair') need(present ? typeof file[side + 'Text'] === 'string' && file[side + 'Text'].isWellFormed() : file[side + 'Text'] === null, 'FILE_METADATA_INVALID');
      }
      need(file.path === (file.afterPath ?? file.beforePath) && file.observedBlobOid === (file.afterOid ?? file.beforeOid), 'FILE_METADATA_INVALID');
      need(['renamed', 'copied'].includes(file.kind) ? file.previousPath === file.beforePath && file.beforePath !== file.afterPath : file.previousPath === null, 'FILE_METADATA_INVALID');
    }
    if (previousLedger !== null) need(plain(previousLedger) && Array.isArray(previousLedger.facts), 'PREVIOUS_FACT_INVALID');
    const oldFacts = previousLedger === null ? new Map() : unique(previousLedger.facts, fact => fact.eventKey, 'PREVIOUS_FACT_DUPLICATE');
    if (previousLedger !== null) need(previousLedger.owner?.accountId === subjectAccountId, 'PREVIOUS_OWNER_MISMATCH');
    const activities = []; const reviewHistoryFacts = [];
    const identity = (kind, repositoryId, sourceId) => activityIdentity({ kind, accountId: subjectAccountId, repositoryId, sourceId });
    const repository = row => { const repo = repos.get(row.repositoryId); need(repo, 'ACTIVITY_OUTSIDE_CAPTURE_SCOPE'); return repo; };
    const retained = fact => {
      const old = oldFacts.get(fact.eventKey); if (!old) return null;
      need(HASH.test(old.eventKey) && old.kind === fact.kind && old.repositoryId === fact.repositoryId && compareTimestamps(time(old.occurredAt), fact.occurredAt) === 0 && ['prKey', 'reviewedCommitKey', 'contributionKey', 'releaseKey'].every(key => fact[key] === undefined || old[key] === fact[key]), 'RETAINED_SOURCE_IDENTITY_OR_TIME_CONFLICT');
      need(Array.isArray(old.families) && old.families.length > 0 && old.families.every(family => FAMILIES.includes(family)), 'PREVIOUS_FACT_INVALID'); return old;
    };
    const append = (fact, sourceId) => { const old = retained(fact); activities.push({ fact: structuredClone(old ?? fact), sourceId: structuredClone(sourceId) }); };
    const fileFamilies = (files, sourceFamily) => classifyFileEvidence({ files: files.map(file => ({ ...file, content: { mode: file.contentProof, beforeText: file.beforeText, afterText: file.afterText } })), ruleBody: fileRules, sourceFamily, unknownPolicy: 'exclude', excludeManagedReadmeUpdates: true, exclude });
    const currentLabels = (row, kind) => {
      labels(row.currentLabels, true); const found = query('observed_current_labels', row.repositoryId, source(row.sourceId), row.currentLabels.length);
      need(found.filters.observation === 'current' && found.filters.targetKind === kind, 'CURRENT_LABEL_QUERY_MISMATCH'); return labels(row.currentLabels, true);
    };
    for (const pr of prs.values()) {
      shape(pr, ['repositoryId', 'sourceId', 'number', 'author', 'state', 'createdAt', 'mergedAt', 'baseRepositoryId', 'headRepositoryId', 'baseOid', 'headOid', 'currentLabels', 'changedFiles', 'fileProof'], ['diffBaseOid', 'diffHeadOid', 'mergeCommitOid', 'mergeParentOid', 'closingIssueIds', 'closingIssuesProof', 'excludedClosingIssueCount', 'labelsProof']);
      repository(pr); id(pr.number); time(pr.createdAt); need(['OPEN', 'CLOSED', 'MERGED'].includes(pr.state)); time(pr.mergedAt, true); need(pr.state === 'MERGED' ? pr.mergedAt !== null : pr.mergedAt === null, 'PR_STATE_CONTRADICTION'); oid(pr.baseOid); oid(pr.headOid); labels(pr.currentLabels);
      need(['not_collected', 'complete_revision_inventory'].includes(pr.fileProof) && (pr.labelsProof === undefined || pr.labelsProof === 'complete_current_labels'), 'PR_REVISION_PROOF_UNAVAILABLE');
      need(pr.baseRepositoryId === pr.repositoryId && (pr.headRepositoryId === null || ID.test(pr.headRepositoryId)), 'PR_UPSTREAM_ATTRIBUTION_MISMATCH'); count(pr.changedFiles);
      const reviews = capture.reviews.filter(row => row.repositoryId === pr.repositoryId && row.pullRequestId === source(pr.sourceId)); const history = query('pull_request_reviews', pr.repositoryId, source(pr.sourceId), reviews.length);
      need(history.filters.states === 'all' && history.filters.history === 'all', 'EARLIER_REVIEW_HISTORY_UNAVAILABLE');
      const author = actor(pr.author, subjectAccountId);
      const idValue = source(pr.sourceId); const basic = { eventKey: identity('merged_pr', pr.repositoryId, idValue), kind: 'merged_pr', repositoryId: pr.repositoryId, occurredAt: pr.mergedAt, prKey: identity('pull_request', pr.repositoryId, idValue) };
      const old = pr.mergedAt === null ? null : retained(basic);
      if (pr.state !== 'MERGED' || !inWindow(pr.mergedAt)) { exclude('NONCANDIDATE_PR'); continue; }
      if (['bot', 'other'].includes(author)) { exclude('NON_SUBJECT_PR'); continue; } need(author === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      need(pr.fileProof === 'complete_revision_inventory' && OID.test(pr.diffBaseOid) && pr.diffHeadOid === pr.headOid && OID.test(pr.mergeCommitOid) && OID.test(pr.mergeParentOid), 'PR_REVISION_PROOF_UNAVAILABLE');
      const files = capture.files.filter(file => file.repositoryId === pr.repositoryId && file.pullRequestId === idValue);
      need(files.length === pr.changedFiles, 'FILE_INVENTORY_COUNT_MISMATCH'); const inventory = query('pull_request_files', pr.repositoryId, idValue, files.length); need(inventory.filters.wholeParentRevision === true, 'FILE_INVENTORY_QUERY_MISMATCH');
      if (old) { fileFamilies(files, old.bugEvidenced ? 'recovery' : 'craft'); retainedClassifications += 1; append(basic, pr.sourceId); continue; }
      const ownBug = currentLabels(pr, 'pull_request');
      need(pr.closingIssuesProof === 'complete_current_resolving_issues' && Array.isArray(pr.closingIssueIds), 'CURRENT_RESOLVING_ISSUES_UNAVAILABLE');
      const closing = query('observed_closing_issues', pr.repositoryId, idValue); need(closing.filters.observation === 'current' && closing.filters.excludeUserLinked === false, 'CURRENT_RESOLVING_QUERY_MISMATCH');
      const excludedCount = count(pr.excludedClosingIssueCount); need(closing.receivedItems === pr.closingIssueIds.length + excludedCount && (closing.includedItems === undefined || closing.includedItems === pr.closingIssueIds.length) && (closing.excludedPrivateCount === undefined || closing.excludedPrivateCount === excludedCount), 'CURRENT_RESOLVING_COUNT_MISMATCH');
      let linkedBug = false;
      for (const ref of pr.closingIssueIds) {
        shape(ref, ['repositoryId', 'sourceId', 'number']); const linked = issues.get(id(ref.repositoryId) + '/' + source(ref.sourceId)); need(linked && linked.visibility === 'public', 'LINKED_PUBLIC_ISSUE_UNAVAILABLE');
        need(linked.number === undefined || linked.number === id(ref.number), 'LINKED_ISSUE_IDENTITY_MISMATCH'); linkedBug = currentLabels(linked, 'issue') || linkedBug;
      }
      unique(pr.closingIssueIds, ref => ref.repositoryId + '/' + ref.sourceId.value, 'DUPLICATE_SOURCE_IDENTITY');
      const families = fileFamilies(files, ownBug || linkedBug ? 'recovery' : 'craft');
      if (families.length === 0) { exclude('NO_QUALIFYING_CHANGE'); continue; }
      append({ ...basic, families, bugEvidenced: families.includes('recovery') }, pr.sourceId);
    }
    for (const commit of capture.commits) {
      shape(commit, ['repositoryId', 'sourceId', 'oid', 'author', 'defaultBranchReflectionProof', 'fullFileContents', 'associatedPrIds', 'committedAt', 'defaultBranchMembership'], ['firstParentOid', 'treeOid', 'parentTreeOid', 'fileProof', 'changedFiles']);
      const repo = repository(commit); need(source(commit.sourceId, 'opaque') === oid(commit.oid), 'COMMIT_IDENTITY_MISMATCH'); const owner = actor(commit.author, subjectAccountId); time(commit.committedAt);
      need(commit.defaultBranchMembership === 'current_ancestry' && commit.defaultBranchReflectionProof === 'unsupported' && ['not_collected', 'text_pair'].includes(commit.fullFileContents) && ['not_collected', 'complete_revision_inventory'].includes(commit.fileProof), 'DIRECT_FILE_PROOF_UNAVAILABLE');
      const basic = { eventKey: identity('direct_contribution', commit.repositoryId, commit.oid), kind: 'direct_contribution', repositoryId: commit.repositoryId, occurredAt: commit.committedAt, contributionKey: identity('direct_contribution', commit.repositoryId, commit.oid) };
      const old = retained(basic);
      if (repo.fork || ['bot', 'other'].includes(owner)) { exclude('NONCANDIDATE_DIRECT_COMMIT'); continue; }
      // A validated date can establish exclusion without guessing authorship.
      // Retained identity/time conflicts and malformed inputs still fail above.
      if (!inWindow(commit.committedAt)) { exclude('OUTSIDE_GROWTH_WINDOW'); continue; }
      need(owner === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      need(commit.defaultBranchMembership === 'current_ancestry' && Array.isArray(commit.associatedPrIds), 'DEFAULT_BRANCH_MEMBERSHIP_UNAVAILABLE');
      need(new Set(commit.associatedPrIds).size === commit.associatedPrIds.length, 'DUPLICATE_SOURCE_IDENTITY');
      const associations = query('commit_pull_requests', commit.repositoryId, commit.oid, commit.associatedPrIds.length); need(associations.filters.enumeration === 'all', 'COMMIT_ASSOCIATION_QUERY_MISMATCH');
      let represented = false;
      for (const prId of commit.associatedPrIds) { const pr = prs.get(commit.repositoryId + '/' + id(prId)); need(pr, 'ASSOCIATED_PR_DETAIL_UNAVAILABLE'); if (pr.state === 'MERGED') represented = true; }
      if (represented) { exclude('PR_REPRESENTED_COMMIT'); continue; }
      need(commit.fileProof === 'complete_revision_inventory' && commit.fullFileContents === 'text_pair', 'DIRECT_FILE_PROOF_UNAVAILABLE'); oid(commit.firstParentOid, true); oid(commit.treeOid); oid(commit.parentTreeOid, true); need((commit.firstParentOid === null) === (commit.parentTreeOid === null), 'DIRECT_PARENT_PROOF_INVALID');
      const files = capture.files.filter(file => file.repositoryId === commit.repositoryId && file.commitOid === commit.oid); need(files.length === count(commit.changedFiles), 'FILE_INVENTORY_COUNT_MISMATCH');
      const inventory = query('commit_files', commit.repositoryId, commit.oid, files.length); need(inventory.filters.wholeParentRevision === true, 'FILE_INVENTORY_QUERY_MISMATCH');
      const families = fileFamilies(files, 'craft');
      if (old) { append(basic, commit.sourceId); continue; } if (families.length === 0) { exclude('NO_QUALIFYING_CHANGE'); continue; }
      append({ ...basic, families }, commit.sourceId);
    }
    for (const release of capture.releases) {
      shape(release, ['repositoryId', 'sourceId', 'author', 'draft', 'prerelease', 'publishedAt', 'firstPublicationProof']); repository(release);
      need(typeof release.draft === 'boolean' && typeof release.prerelease === 'boolean' && release.firstPublicationProof === 'unsupported'); time(release.publishedAt, true); const owner = actor(release.author, subjectAccountId);
      const value = source(release.sourceId); const basic = { eventKey: identity('published_release', release.repositoryId, value), kind: 'published_release', repositoryId: release.repositoryId, occurredAt: release.publishedAt, families: ['operations'], releaseKey: identity('release', release.repositoryId, value) };
      if (oldFacts.has(basic.eventKey) && release.publishedAt !== null) { retained(basic); append(basic, release.sourceId); continue; }
      if (release.draft || release.prerelease || ['bot', 'other'].includes(owner)) { exclude('NONCANDIDATE_RELEASE'); continue; } need(owner === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      need(release.publishedAt !== null, 'PUBLICATION_TIME_UNAVAILABLE'); if (!inWindow(release.publishedAt)) { exclude('OUTSIDE_GROWTH_WINDOW'); continue; }
      append(basic, release.sourceId);
    }
    for (const review of capture.reviews) {
      shape(review, ['repositoryId', 'pullRequestId', 'sourceId', 'reviewer', 'state', 'submittedAt', 'reviewedCommitOid']); repository(review); id(review.pullRequestId);
      need(['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)); time(review.submittedAt, review.state === 'PENDING'); oid(review.reviewedCommitOid, review.state === 'PENDING');
      need(review.state !== 'PENDING' || review.submittedAt === null, 'REVIEW_STATE_CONTRADICTION');
      const pr = prs.get(review.repositoryId + '/' + review.pullRequestId); need(pr, 'REVIEW_PARENT_UNAVAILABLE'); const who = actor(review.reviewer, subjectAccountId); const author = actor(pr.author, subjectAccountId);
      if (review.state === 'PENDING' || ['bot', 'other'].includes(who) || ['subject', 'bot'].includes(author)) { exclude('NONCANDIDATE_REVIEW'); continue; } need(who === 'subject' && author !== 'unknown', 'REVIEW_ATTRIBUTION_UNAVAILABLE');
      if (review.submittedAt.slice(0, 10) >= cutoffDate) continue;
      const prId = review.pullRequestId; const fact = { eventKey: identity('submitted_review', review.repositoryId, source(review.sourceId)), kind: 'submitted_review', repositoryId: review.repositoryId, occurredAt: review.submittedAt, families: ['guard'], prKey: identity('pull_request', review.repositoryId, prId), reviewedCommitKey: identity('reviewed_commit', review.repositoryId, { pullRequestId: prId, commitOid: review.reviewedCommitOid }) };
      reviewHistoryFacts.push(fact); if (inWindow(review.submittedAt)) append(fact, review.sourceId);
    }
    const issueWork = new Map();
    for (const event of capture.issueEvents) {
      shape(event, ['repositoryId', 'sourceId', 'issueId', 'actor', 'occurredAt', 'kind', 'target']); repository(event); id(event.issueId); time(event.occurredAt);
      need(['labeled', 'unlabeled', 'assigned', 'unassigned', 'milestoned', 'demilestoned'].includes(event.kind)); if (!inWindow(event.occurredAt)) continue;
      const who = actor(event.actor, subjectAccountId);
      if (['bot', 'other'].includes(who)) { exclude('NONCANDIDATE_TRIAGE'); continue; }
      const issue = issues.get(event.repositoryId + '/' + event.issueId); need(issue, 'TRIAGE_ISSUE_UNAVAILABLE');
      const author = actor(issue.author, subjectAccountId); if (['bot', 'subject'].includes(author)) { exclude('NONCANDIDATE_TRIAGE'); continue; } need(who === 'subject' && author !== 'unknown', 'TRIAGE_ATTRIBUTION_UNAVAILABLE');
      let target;
      if (['labeled', 'unlabeled'].includes(event.kind)) { shape(event.target, ['kind', 'sourceId']); need(event.target.kind === 'label'); target = source(event.target.sourceId); }
      else if (['assigned', 'unassigned'].includes(event.kind)) { shape(event.target, ['kind', 'accountId']); need(event.target.kind === 'assignee'); target = id(event.target.accountId); }
      else { shape(event.target, ['kind', 'sourceId']); need(event.target.kind === 'milestone'); target = source(event.target.sourceId); }
      const key = [event.repositoryId, event.occurredAt.slice(0, 10), event.issueId, event.target.kind, target].join('/'); const values = issueWork.get(key) ?? []; values.push(event); issueWork.set(key, values);
    }
    const days = new Map();
    for (const events of issueWork.values()) {
      if (events.length !== 1) { exclude('REPEATED_TRIAGE_TOGGLE'); continue; }
      const event = events[0]; const key = event.repositoryId + '/' + event.occurredAt.slice(0, 10); const values = days.get(key) ?? new Map();
      if (!values.has(event.issueId) || compareTimestamps(event.occurredAt, values.get(event.issueId).occurredAt) < 0) values.set(event.issueId, event); days.set(key, values);
    }
    for (const entries of days.values()) {
      if (entries.size < 3) { exclude('TRIAGE_THRESHOLD_NOT_MET'); continue; }
      const ordered = [...entries.values()].sort((a, b) => compareTimestamps(a.occurredAt, b.occurredAt) || numericOrder(source(a.sourceId), source(b.sourceId)));
      const event = ordered[2]; const value = event.occurredAt.slice(0, 10);
      append({ eventKey: identity('triage_day', event.repositoryId, value), kind: 'triage_day', repositoryId: event.repositoryId, occurredAt: event.occurredAt, families: ['operations'], issueKeys: [...entries.keys()].sort(numericOrder).map(issueId => identity('issue', event.repositoryId, issueId)) }, { type: 'opaque', value });
    }
    activities.sort((a, b) => a.fact.eventKey < b.fact.eventKey ? -1 : a.fact.eventKey > b.fact.eventKey ? 1 : 0); reviewHistoryFacts.sort((a, b) => a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0);
    return { ...base(), decision: 'qualified', code: 'QUALIFIED_OBSERVED_API_CAPTURE', activities, reviewHistoryFacts, sourceEligibility: 'passed_relative_to_observed_capture', coverageConsistency: 'passed_relative_to_known_capture' };
  } catch (error) {
    return { ...base(), decision: 'hold', code: error instanceof ObservedFailure || error instanceof FileEvidenceFailure ? error.code : 'OBSERVED_CAPTURE_INVALID', activities: [], reviewHistoryFacts: [], sourceEligibility: 'not_checked', coverageConsistency: 'not_checked' };
  }
}
