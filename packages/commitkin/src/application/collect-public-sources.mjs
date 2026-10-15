import { createHash } from 'node:crypto';
import { classifyPath, OBSERVED_FILE_RULES } from '../domain/evidence/files.mjs';

/**
 * Bounded read-only collection port. Construction/import performs no request.
 * The injected client owns HTTP, pagination destination checks and total budgets.
 * This returns an ephemeral minimal capture projection, NOT an evidence envelope,
 * trusted source proof, successful character refresh or permission to publish.
 */
const ID = /^[1-9][0-9]*$/;
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9_.-]{1,100}$/i;
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ACTIONS = new Set(['labeled', 'unlabeled', 'assigned', 'unassigned', 'milestoned', 'demilestoned']);
const LIMITATIONS = Object.freeze([
  'KNOWN_SCOPE_CAPTURE_ONLY', 'ACCOUNT_WIDE_DISCOVERY_NOT_GUARANTEED',
  'NO_EVIDENCE_ENVELOPE_ADAPTER', 'SOURCE_AUTHENTICITY_UNVERIFIED',
]);
const CAPABILITIES = Object.freeze({
  defaultBranchReflectionHistory: 'unsupported', originalReleaseLifecycle: 'unsupported',
  historicalBugLabelState: 'unsupported', fullBeforeAfterFileContents: 'supported_for_proven_candidate_prs',
  normalizedEvidenceEnvelope: 'not_implemented', progression: 'not_authorized',
});
const SAFE_CODES = new Set([
  'REQUEST_BUDGET_EXHAUSTED', 'PAGE_LIMIT_REACHED', 'PAGINATION_CYCLE',
  'PAGINATION_INVALID', 'PAGINATION_RESPONSE_INVALID', 'PAGINATION_DESTINATION_REJECTED',
  'PAGINATION_QUERY_CHANGED', 'REPOSITORY_UNAVAILABLE', 'ACCESS_DENIED', 'RATE_LIMITED',
  'NETWORK_UNAVAILABLE', 'HTTP_UNAVAILABLE', 'RESPONSE_TOO_LARGE', 'RESPONSE_JSON_INVALID',
  'UNSAFE_JSON_INTEGER', 'REDIRECT_REJECTED', 'REMOTE_CONFLICT',
  'COMMIT_FILE_LIMIT_REACHED', 'DUPLICATE_COMMIT_FILE', 'COMMIT_FILES_METADATA_CHANGED',
  'COMMIT_FILES_RESPONSE_INVALID', 'COMMIT_FILES_PAGINATION_INVALID', 'COMMIT_FILE_METADATA_INVALID',
]);
class CollectionFailure extends Error { constructor(code) { super(code); this.code = code; } }
function requireThat(condition, code = 'CAPTURE_SHAPE_INVALID') { if (!condition) throw new CollectionFailure(code); }
function stableId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  requireThat(typeof value === 'string' && ID.test(value), 'SOURCE_IDENTIFIER_INVALID'); return value;
}
function optionalId(value) { return value === null || value === undefined ? null : stableId(value); }
function name(value) { requireThat(typeof value === 'string' && NAME.test(value) && !value.endsWith('/.') && !value.endsWith('/..'), 'REPOSITORY_NAME_INVALID'); return value.toLowerCase(); }
function oid(value) { requireThat(typeof value === 'string' && OID.test(value), 'SOURCE_OID_INVALID'); return value; }
function dateValid(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value; }
function timestamp(value, nullable = false) {
  if (nullable && value === null) return null;
  requireThat(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'SOURCE_TIMESTAMP_INVALID'); return value;
}
function actor(value) {
  if (!value || !['User', 'Bot'].includes(value.type) || value.id === null || value.id === undefined) return { status: 'unavailable', reason: 'ACTOR_NOT_PROVIDED' };
  return { status: 'identified', accountId: stableId(value.id), type: value.type };
}
function labels(value) { requireThat(Array.isArray(value)); return value.map(item => ({ type: 'numeric', value: stableId(item.id) })); }
function namedLabels(value) {
  requireThat(Array.isArray(value), 'CURRENT_LABELS_INVALID');
  const result = value.map(item => {
    requireThat(typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 1024 && item.name.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(item.name), 'CURRENT_LABELS_INVALID');
    return { type: 'numeric', value: stableId(item.id), name: item.name };
  });
  listUnique(result, item => item.value); return result;
}
function numericOrder(a, b) { return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0; }
function listUnique(items, identity) { const keys = items.map(identity); requireThat(new Set(keys).size === keys.length, 'DUPLICATE_SOURCE_IDENTITY'); }
function baseResponse(model) {
  return { capabilities: { ...CAPABILITIES, ...(model === 'observed-api-v1' ? { observedCommittedDate: 'supported', observedReleaseState: 'supported', observedBugLabels: 'supported_for_complete_current_labels', fullBeforeAfterFileContents: 'supported_for_proven_candidate_prs_and_direct_commits' } : {}) }, limitations: [...LIMITATIONS], qualificationReady: false, sourceAuthenticity: 'not_checked', progressionAuthorized: false };
}

export async function collectPublicSources({ client, repositories, subjectAccountId, startDate, cutoffDate, model = 'legacy-v1' }) {
  try {
    requireThat(['legacy-v1', 'observed-api-v1'].includes(model), 'COLLECTION_MODEL_UNSUPPORTED');
    const observed = model === 'observed-api-v1';
    requireThat(client && typeof client.get === 'function' && typeof client.paginate === 'function' && typeof client.budget === 'function' && Array.isArray(repositories), 'COLLECTION_INPUT_INVALID');
    requireThat(typeof subjectAccountId === 'string' && ID.test(subjectAccountId) && dateValid(startDate) && dateValid(cutoffDate) && startDate <= cutoffDate, 'COLLECTION_INPUT_INVALID');
    const inputs = repositories.map(item => ({ repositoryId: stableId(item.id ?? item.repositoryId), name: name(item.name) }));
    listUnique(inputs, item => item.repositoryId);
    inputs.sort((a, b) => numericOrder(a.repositoryId, b.repositoryId));
    const capture = { ...(observed ? { model } : {}), subjectAccountId, window: { startDate, cutoffDate }, repositories: [], pullRequests: [], files: [], reviews: [], issues: [], issueEvents: [], releases: [], commits: [], queries: [] };
    const commitCache = new Map(); const treeCache = new Map(); const blobCache = new Map(); const issueCache = new Map(); const repositoryCache = new Map(); let totalBlobBytes = 0; let totalTextRecordBytes = 0;
    const inWindow = value => value.slice(0, 10) >= startDate && value.slice(0, 10) < cutoffDate;
    function budgetAvailable() {
      const budget = client.budget();
      requireThat(budget && Number.isSafeInteger(budget.used) && Number.isSafeInteger(budget.remaining) && Number.isSafeInteger(budget.limit) && budget.limit > 0 && budget.used >= 0 && budget.remaining >= 0 && budget.used + budget.remaining === budget.limit, 'CLIENT_BUDGET_INVALID');
      requireThat(budget.remaining > 0, 'REQUEST_BUDGET_EXHAUSTED');
    }
    async function get(path) {
      budgetAvailable(); const result = await client.get(path);
      requireThat(result?.ok === true, SAFE_CODES.has(result?.code) ? result.code : 'SOURCE_UNAVAILABLE');
      requireThat(result.data && typeof result.data === 'object' && !Array.isArray(result.data)); return result.data;
    }
    function recordPages(result, receivedItems, path, query, maxPages) {
      requireThat(Number.isSafeInteger(result.pages) && result.pages >= 1 && result.pages <= maxPages, 'CAPTURE_CLOSURE_INVALID');
      requireThat(Array.isArray(result.pageSnapshots) && result.pageSnapshots.length === result.pages, 'CAPTURE_PAGE_PROVENANCE_UNAVAILABLE');
      let offset = 0; let requestPath = path;
      for (let index = 0; index < result.pageSnapshots.length; index += 1) {
        const page = result.pageSnapshots[index];
        requireThat(page.sequence === index + 1 && page.requestPath === requestPath && page.startIndex === offset && Number.isSafeInteger(page.itemCount) && page.itemCount >= 0 && page.endIndexExclusive === offset + page.itemCount && (index === result.pageSnapshots.length - 1 ? page.nextPath === null : typeof page.nextPath === 'string' && page.nextPath.startsWith('/') && !page.nextPath.startsWith('//')), 'CAPTURE_PAGE_PROVENANCE_INVALID');
        offset = page.endIndexExclusive; requestPath = page.nextPath;
      }
      requireThat(offset === receivedItems, 'CAPTURE_PAGE_PROVENANCE_INVALID');
      capture.queries.push({ ...query, pages: result.pages, receivedItems, closed: true, pageSnapshots: structuredClone(result.pageSnapshots) });
    }
    async function enumerate(path, query, maxPages = 100) {
      budgetAvailable(); const result = await client.paginate(path, { maxPages });
      requireThat(result?.ok === true && result.complete === true, SAFE_CODES.has(result?.code) ? result.code : 'INCOMPLETE_COLLECTION');
      requireThat(Array.isArray(result.items), 'CAPTURE_CLOSURE_INVALID');
      recordPages(result, result.items.length, path, query, maxPages);
      return result.items;
    }
    async function currentLabels(prefix, repositoryId, id, number, targetKind) {
      return namedLabels(await enumerate(prefix + '/issues/' + number + '/labels?per_page=100', { kind: 'observed_current_labels', repositoryId, parentId: id, filters: { observation: 'current', targetKind } }));
    }
    async function observedIssue(repositoryId, number, id) {
      const key = repositoryId + ':' + id;
      if (issueCache.has(key)) {
        requireThat(issueCache.get(key).number === number, 'ISSUE_ID_MISMATCH'); return issueCache.get(key);
      }
      if (!repositoryCache.has(repositoryId)) {
        const metadata = await get('/repositories/' + repositoryId);
        requireThat(stableId(metadata.id) === repositoryId, 'REPOSITORY_ID_MISMATCH');
        requireThat(metadata.private === false && (metadata.visibility === undefined || metadata.visibility === 'public'), 'LINKED_ISSUE_SCOPE_CHANGED');
        repositoryCache.set(repositoryId, '/repos/' + name(metadata.full_name));
      }
      const prefix = repositoryCache.get(repositoryId);
      const issue = await get(prefix + '/issues/' + number);
      requireThat(stableId(issue.id) === id && stableId(issue.number) === number && issue.pull_request === undefined, 'ISSUE_ID_MISMATCH');
      requireThat(['open', 'closed'].includes(issue.state), 'ISSUE_STATE_UNSUPPORTED');
      const projection = { repositoryId, sourceId: { type: 'numeric', value: id }, number, state: issue.state.toUpperCase(), author: actor(issue.user), createdAt: timestamp(issue.created_at), visibility: 'public', currentLabels: await currentLabels(prefix, repositoryId, id, number, 'issue'), labelsProof: 'complete_current_labels' };
      issueCache.set(key, projection); capture.issues.push(projection); return projection;
    }
    async function closingIssues(repositoryName, projection) {
      requireThat(typeof client.closingIssues === 'function', 'CLOSING_ISSUES_CAPABILITY_UNAVAILABLE');
      budgetAvailable();
      const result = await client.closingIssues({ repository: repositoryName, pullNumber: projection.number, maxPages: 10 });
      requireThat(result?.ok === true && result.complete === true, SAFE_CODES.has(result?.code) ? result.code : 'CLOSING_ISSUES_UNAVAILABLE');
      requireThat(stableId(result.repositoryId) === projection.repositoryId && name(result.repositoryName) === repositoryName && stableId(result.pullRequestId) === projection.sourceId.value && stableId(result.pullNumber) === projection.number, 'CLOSING_ISSUES_PARENT_MISMATCH');
      requireThat(Array.isArray(result.items) && Number.isSafeInteger(result.pages) && result.pages >= 1 && result.pages <= 10 && Number.isSafeInteger(result.totalCount) && result.totalCount >= 0 && Number.isSafeInteger(result.excludedPrivateCount) && result.excludedPrivateCount >= 0 && result.items.length + result.excludedPrivateCount === result.totalCount, 'CLOSING_ISSUES_COUNT_MISMATCH');
      requireThat(Array.isArray(result.pageSnapshots) && result.pageSnapshots.length === result.pages, 'CLOSING_ISSUES_PROVENANCE_UNAVAILABLE');
      let offset = 0; let included = 0; let excluded = 0; let cursor = null; const cursors = new Set();
      for (let index = 0; index < result.pageSnapshots.length; index += 1) {
        const page = result.pageSnapshots[index]; const last = index === result.pageSnapshots.length - 1;
        requireThat(page.sequence === index + 1 && page.requestCursor === cursor && page.startIndex === offset && Number.isSafeInteger(page.itemCount) && page.itemCount >= 0 && page.endIndexExclusive === offset + page.itemCount && Number.isSafeInteger(page.includedCount) && page.includedCount >= 0 && Number.isSafeInteger(page.excludedPrivateCount) && page.excludedPrivateCount >= 0 && page.includedCount + page.excludedPrivateCount === page.itemCount && page.hasNextPage === !last && (page.endCursor === null || typeof page.endCursor === 'string' && page.endCursor.length > 0 && page.endCursor.length <= 4096) && (last || typeof page.endCursor === 'string' && !cursors.has(page.endCursor)), 'CLOSING_ISSUES_PROVENANCE_INVALID');
        offset = page.endIndexExclusive; included += page.includedCount; excluded += page.excludedPrivateCount; cursor = page.endCursor;
        if (cursor !== null) cursors.add(cursor);
      }
      requireThat(offset === result.totalCount && included === result.items.length && excluded === result.excludedPrivateCount, 'CLOSING_ISSUES_PROVENANCE_INVALID');
      const references = result.items.map(item => {
        requireThat(item.sourceId?.type === 'numeric', 'CLOSING_ISSUE_ID_INVALID');
        return { repositoryId: stableId(item.repositoryId), sourceId: { type: 'numeric', value: stableId(item.sourceId.value) }, number: stableId(item.number) };
      });
      listUnique(references, item => item.repositoryId + ':' + item.sourceId.value);
      capture.queries.push({ kind: 'observed_closing_issues', repositoryId: projection.repositoryId, parentId: projection.sourceId.value, filters: { observation: 'current', excludeUserLinked: false }, pages: result.pages, receivedItems: result.totalCount, includedItems: result.items.length, excludedPrivateCount: result.excludedPrivateCount, closed: true, pageSnapshots: structuredClone(result.pageSnapshots) });
      for (const reference of references) await observedIssue(reference.repositoryId, reference.number, reference.sourceId.value);
      Object.assign(projection, { closingIssueIds: references, excludedClosingIssueCount: result.excludedPrivateCount, closingIssuesProof: 'complete_current_resolving_issues' });
    }
    async function gitCommit(prefix, sha) {
      const key = prefix + ':' + oid(sha);
      if (!commitCache.has(key)) {
        const value = await get(prefix + '/git/commits/' + sha);
        requireThat(oid(value.sha) === sha && Array.isArray(value.parents) && value.parents.every(parent => OID.test(parent.sha)), 'GIT_COMMIT_PROOF_INVALID');
        commitCache.set(key, { sha, tree: oid(value.tree?.sha), parents: value.parents.map(parent => parent.sha) });
      }
      return commitCache.get(key);
    }
    async function gitTree(prefix, commitOid) {
      const commit = await gitCommit(prefix, commitOid); const key = prefix + ':' + commit.tree;
      if (!treeCache.has(key)) {
        const value = await get(prefix + '/git/trees/' + commit.tree + '?recursive=1');
        requireThat(oid(value.sha) === commit.tree && value.truncated === false && Array.isArray(value.tree), 'GIT_TREE_INCOMPLETE');
        const leaves = new Map(); const paths = new Set();
        for (const entry of value.tree) {
          requireThat(typeof entry.path === 'string' && entry.path.length > 0 && entry.path.isWellFormed() && !entry.path.startsWith('/') && !entry.path.split('/').some(part => ['.', '..', ''].includes(part)) && !/[\\\u0000]/u.test(entry.path) && !paths.has(entry.path), 'GIT_TREE_PATH_INVALID');
          paths.add(entry.path); oid(entry.sha);
          requireThat(['blob', 'tree', 'commit'].includes(entry.type) && typeof entry.mode === 'string', 'GIT_TREE_ENTRY_UNSUPPORTED');
          if (entry.type !== 'tree') leaves.set(entry.path, { sha: entry.sha, mode: entry.mode, type: entry.type });
        }
        treeCache.set(key, leaves);
      }
      return treeCache.get(key);
    }
    const sameEntry = (left, right) => left?.sha === right?.sha && left?.mode === right?.mode && left?.type === right?.type;
    const changedPaths = (before, after) => new Set([...new Set([...before.keys(), ...after.keys()])].filter(path => !sameEntry(before.get(path), after.get(path))));
    function sameSet(left, right) { return left.size === right.size && [...left].every(value => right.has(value)); }
    async function blobText(prefix, sha) {
      const key = prefix + ':' + sha;
      if (!blobCache.has(key)) {
        const value = await get(prefix + '/git/blobs/' + oid(sha));
        requireThat(oid(value.sha) === sha && value.encoding === 'base64' && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 1024 * 1024 && typeof value.content === 'string', 'GIT_BLOB_UNAVAILABLE_OR_TOO_LARGE');
        const encoded = value.content.replace(/[\r\n]/g, '');
        requireThat(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded), 'GIT_BLOB_ENCODING_INVALID');
        const bytes = Buffer.from(encoded, 'base64');
        requireThat(bytes.length === value.size && bytes.toString('base64') === encoded, 'GIT_BLOB_ENCODING_INVALID');
        totalBlobBytes += bytes.length; requireThat(totalBlobBytes <= 32 * 1024 * 1024, 'GIT_BLOB_TOTAL_LIMIT_REACHED');
        const actual = createHash(sha.length === 40 ? 'sha1' : 'sha256').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
        requireThat(actual === sha, 'GIT_BLOB_HASH_MISMATCH');
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new CollectionFailure('GIT_BLOB_BINARY_OR_NON_UTF8'); }
        requireThat(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text), 'GIT_BLOB_BINARY_OR_NON_UTF8');
        blobCache.set(key, text);
      }
      return blobCache.get(key);
    }
    function revisionPairs(projection, inventory, before, after, parentKind) {
      const code = parentKind === 'commit' ? 'COMMIT' : 'PR';
      const touched = new Set(); const pairs = [];
      for (const file of inventory) {
        requireThat(typeof file.filename === 'string' && file.filename.length > 0 && file.filename.isWellFormed() && ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(file.status), 'FILE_METADATA_INVALID');
        requireThat(file.previous_filename === undefined || typeof file.previous_filename === 'string' && file.previous_filename.isWellFormed(), 'FILE_METADATA_INVALID');
        const beforePath = file.status === 'added' ? null : ['renamed', 'copied'].includes(file.status) ? file.previous_filename : file.filename;
        const afterPath = file.status === 'removed' ? null : file.filename;
        requireThat(beforePath === null || typeof beforePath === 'string' && beforePath.length > 0, code + '_RENAME_PROOF_UNAVAILABLE');
        const left = beforePath === null ? null : before.get(beforePath); const right = afterPath === null ? null : after.get(afterPath);
        requireThat((beforePath === null || left) && (afterPath === null || right), code + '_FILE_REVISION_MISMATCH');
        if (file.status === 'added') requireThat(!before.has(afterPath), code + '_FILE_REVISION_MISMATCH');
        if (file.status === 'removed') requireThat(!after.has(beforePath), code + '_FILE_REVISION_MISMATCH');
        if (file.status === 'renamed') requireThat(beforePath !== afterPath && !after.has(beforePath) && !before.has(afterPath), code + '_RENAME_PROOF_AMBIGUOUS');
        if (file.status === 'copied') requireThat(beforePath !== afterPath && sameEntry(before.get(beforePath), after.get(beforePath)) && !before.has(afterPath), code + '_RENAME_PROOF_AMBIGUOUS');
        const category = observed ? classifyPath({ path: afterPath ?? beforePath, ruleBody: OBSERVED_FILE_RULES }) : null;
        const needsText = !observed || !['excluded', 'unmatched'].includes(category);
        if (needsText) for (const entry of [left, right].filter(Boolean)) requireThat(entry.type === 'blob' && ['100644', '100755'].includes(entry.mode), code + '_FILE_MODE_UNSUPPORTED');
        requireThat(oid(file.sha) === (right ?? left).sha, code + '_FILE_BLOB_MISMATCH');
        if (beforePath !== null && file.status !== 'copied') touched.add(beforePath);
        if (afterPath !== null) touched.add(afterPath);
        pairs.push({ repositoryId: projection.repositoryId, ...(parentKind === 'commit' ? { commitOid: projection.oid } : { pullRequestId: projection.sourceId.value }), path: file.filename, previousPath: file.previous_filename ?? null, kind: file.status, observedBlobOid: file.sha, beforePath, afterPath, beforeOid: left?.sha ?? null, afterOid: right?.sha ?? null, contentProof: needsText ? 'not_collected' : 'not_required' });
      }
      requireThat(sameSet(touched, changedPaths(before, after)), code + '_DIFF_INVENTORY_MISMATCH');
      return { pairs, touched };
    }
    async function capturePairs(prefix, pairs, needsContents) {
      for (const pair of pairs) {
        if (needsContents && pair.contentProof !== 'not_required') {
          pair.beforeText = pair.beforeOid === null ? null : await blobText(prefix, pair.beforeOid);
          pair.afterText = pair.afterOid === null ? null : await blobText(prefix, pair.afterOid);
          pair.contentProof = 'text_pair';
          totalTextRecordBytes += Buffer.byteLength(JSON.stringify({ beforeText: pair.beforeText, afterText: pair.afterText }));
          requireThat(totalTextRecordBytes <= 32 * 1024 * 1024, 'GIT_BLOB_TOTAL_LIMIT_REACHED');
        }
        capture.files.push(pair);
      }
    }
    async function acquireFiles(prefix, projection, rawPr, inventory, needsContents) {
      let beforeBranch = projection.baseOid; let merge = null; let mergeParent = null;
      if (projection.state === 'MERGED') {
        merge = oid(rawPr.merge_commit_sha);
        const commit = await gitCommit(prefix, merge);
        requireThat(commit.parents.length >= 1 && commit.parents.length <= 2 && (commit.parents.length !== 2 || commit.parents[1] === projection.headOid), 'PR_MERGE_PROOF_AMBIGUOUS');
        mergeParent = commit.parents[0]; beforeBranch = mergeParent;
      }
      const comparison = await get(prefix + '/compare/' + beforeBranch + '...' + projection.headOid + '?per_page=1');
      requireThat(oid(comparison.base_commit?.sha) === beforeBranch, 'PR_MERGE_BASE_PROOF_INVALID');
      const diffBaseOid = oid(comparison.merge_base_commit?.sha); const diffHeadOid = projection.headOid;
      const before = await gitTree(prefix, diffBaseOid); const after = await gitTree(prefix, diffHeadOid);
      const { pairs, touched } = revisionPairs(projection, inventory, before, after, 'pull_request');
      if (merge !== null) {
        const actualBefore = await gitTree(prefix, mergeParent); const actualAfter = await gitTree(prefix, merge);
        requireThat(sameSet(touched, changedPaths(actualBefore, actualAfter)), 'PR_MERGED_DIFF_AMBIGUOUS');
        for (const path of touched) requireThat(sameEntry(before.get(path), actualBefore.get(path)) && sameEntry(after.get(path), actualAfter.get(path)), 'PR_MERGED_DIFF_AMBIGUOUS');
      }
      Object.assign(projection, { diffBaseOid, diffHeadOid, mergeCommitOid: merge, mergeParentOid: mergeParent, fileProof: 'complete_revision_inventory' });
      await capturePairs(prefix, pairs, needsContents);
    }
    async function acquireCommitFiles(prefix, projection) {
      requireThat(typeof client.commitFiles === 'function', 'COMMIT_FILES_CAPABILITY_UNAVAILABLE');
      budgetAvailable();
      const result = await client.commitFiles({ repository: prefix.slice('/repos/'.length), oid: projection.oid, maxPages: 30 });
      requireThat(result?.ok === true && result.complete === true, SAFE_CODES.has(result?.code) ? result.code : 'COMMIT_FILES_UNAVAILABLE');
      const detail = result.metadata;
      requireThat(detail && oid(detail.oid) === projection.oid && Array.isArray(detail.parentOids) && detail.parentOids.every(value => OID.test(value)) && Array.isArray(result.files), 'COMMIT_DETAIL_INVALID');
      requireThat(timestamp(detail.committedAt) === projection.committedAt, 'COMMIT_DATE_MISMATCH');
      requireThat(result.files.length < 3000, 'COMMIT_FILE_LIMIT_REACHED');
      requireThat(result.receivedItems === result.files.length, 'COMMIT_FILE_COUNT_MISMATCH');
      recordPages(result, result.files.length, prefix + '/commits/' + projection.oid + '?per_page=100', { kind: 'commit_files', repositoryId: projection.repositoryId, parentId: projection.oid, filters: { wholeParentRevision: true } }, 30);
      listUnique(result.files, file => file.filename);
      const commit = await gitCommit(prefix, projection.oid);
      requireThat(oid(detail.treeOid) === commit.tree, 'COMMIT_TREE_MISMATCH');
      requireThat(detail.parentOids.length === commit.parents.length && detail.parentOids.every((parent, index) => oid(parent) === commit.parents[index]), 'COMMIT_PARENT_MISMATCH');
      const firstParentOid = commit.parents[0] ?? null;
      const before = firstParentOid === null ? new Map() : await gitTree(prefix, firstParentOid);
      const after = await gitTree(prefix, projection.oid);
      const { pairs } = revisionPairs(projection, result.files, before, after, 'commit');
      Object.assign(projection, { firstParentOid, treeOid: commit.tree, parentTreeOid: firstParentOid === null ? null : (await gitCommit(prefix, firstParentOid)).tree, changedFiles: pairs.length, fileProof: 'complete_revision_inventory', fullFileContents: 'text_pair' });
      await capturePairs(prefix, pairs, true);
    }
    for (const input of inputs) {
      const rawRepository = await get('/repositories/' + input.repositoryId);
      const repositoryId = stableId(rawRepository.id);
      requireThat(repositoryId === input.repositoryId, 'REPOSITORY_ID_MISMATCH');
      const currentName = name(rawRepository.full_name);
      const visibility = rawRepository.visibility ?? (rawRepository.private === false ? 'public' : 'private');
      requireThat(visibility === 'public' && rawRepository.private === false, 'REPOSITORY_SCOPE_CHANGED');
      requireThat(rawRepository.owner && ['User', 'Organization'].includes(rawRepository.owner.type) && typeof rawRepository.fork === 'boolean' && typeof rawRepository.archived === 'boolean' && typeof rawRepository.default_branch === 'string' && rawRepository.default_branch.length > 0 && rawRepository.default_branch.length <= 1024 && rawRepository.default_branch.isWellFormed(), 'REPOSITORY_METADATA_INVALID');
      const repository = { repositoryId, ownerAccountId: stableId(rawRepository.owner.id), ownerType: rawRepository.owner.type, visibility: 'public', fork: rawRepository.fork, archived: rawRepository.archived, defaultBranch: rawRepository.default_branch };
      capture.repositories.push(repository);
      const prefix = '/repos/' + currentName;
      repositoryCache.set(repositoryId, prefix);
      if (observed) {
        const ref = await get(prefix + '/git/ref/heads/' + repository.defaultBranch.split('/').map(encodeURIComponent).join('/'));
        requireThat(ref.ref === 'refs/heads/' + repository.defaultBranch && ref.object?.type === 'commit', 'DEFAULT_BRANCH_HEAD_INVALID');
        repository.defaultBranchHeadOid = oid(ref.object.sha);
      }
      // Creation-time filtering would miss old PRs with recent merges/reviews.
      const pullList = await enumerate(prefix + '/pulls?state=all&sort=created&direction=asc&per_page=100', { kind: 'pull_requests', repositoryId, filters: { state: 'all', creationCutoff: null } });
      listUnique(pullList, item => stableId(item.id));
      for (const entry of pullList) {
        const number = stableId(entry.number); const listedId = stableId(entry.id);
        const pr = await get(prefix + '/pulls/' + number);
        const id = stableId(pr.id);
        requireThat(id === listedId && stableId(pr.number) === number, 'PR_ID_MISMATCH');
        requireThat(['open', 'closed'].includes(pr.state) && pr.base?.repo && stableId(pr.base.repo.id) === repositoryId, 'PR_PARENT_MISMATCH');
        const mergedAt = timestamp(pr.merged_at, true);
        requireThat(mergedAt === null || pr.state === 'closed', 'PR_STATE_CONTRADICTION');
        requireThat(Number.isSafeInteger(pr.changed_files) && pr.changed_files >= 0, 'PR_FILE_COUNT_UNAVAILABLE');
        const projection = { repositoryId, sourceId: { type: 'numeric', value: id }, number, author: actor(pr.user), state: mergedAt !== null ? 'MERGED' : pr.state === 'open' ? 'OPEN' : 'CLOSED', createdAt: timestamp(pr.created_at), mergedAt, baseRepositoryId: repositoryId, headRepositoryId: optionalId(pr.head?.repo?.id), baseOid: oid(pr.base.sha), headOid: oid(pr.head?.sha), currentLabels: labels(pr.labels), changedFiles: pr.changed_files };
        capture.pullRequests.push(projection);
        const ownAuthor = projection.author.status === 'identified' && projection.author.type === 'User' && projection.author.accountId === subjectAccountId;
        const candidate = ownAuthor && projection.state === 'MERGED' && inWindow(projection.mergedAt);
        projection.fileProof = 'not_collected';
        let fileItems = [];
        if (candidate) {
          fileItems = await enumerate(prefix + '/pulls/' + number + '/files?per_page=100', { kind: 'pull_request_files', repositoryId, parentId: id, filters: { wholeParentRevision: true } }, 30);
          requireThat(fileItems.length < 3000 && pr.changed_files < 3000, 'PR_FILE_LIMIT_REACHED');
          requireThat(fileItems.length === pr.changed_files, 'PR_FILE_COUNT_MISMATCH');
          listUnique(fileItems, file => file.filename);
          for (const file of fileItems) {
            requireThat(typeof file.filename === 'string' && file.filename.length > 0 && file.filename.isWellFormed() && ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(file.status), 'FILE_METADATA_INVALID');
            requireThat(file.previous_filename === undefined || typeof file.previous_filename === 'string' && file.previous_filename.isWellFormed(), 'FILE_METADATA_INVALID');
          }
        }
        const reviews = await enumerate(prefix + '/pulls/' + number + '/reviews?per_page=100', { kind: 'pull_request_reviews', repositoryId, parentId: id, filters: { states: 'all', history: 'all' } });
        listUnique(reviews, item => stableId(item.id));
        for (const review of reviews) {
          requireThat(['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state), 'REVIEW_STATE_UNSUPPORTED');
          requireThat(review.state !== 'PENDING' || review.submitted_at === null || review.submitted_at === undefined, 'REVIEW_STATE_CONTRADICTION');
          const submittedAt = review.state === 'PENDING' ? null : timestamp(review.submitted_at);
          capture.reviews.push({ repositoryId, pullRequestId: id, sourceId: { type: 'numeric', value: stableId(review.id) }, reviewer: actor(review.user), state: review.state, submittedAt, reviewedCommitOid: review.commit_id === null && review.state === 'PENDING' ? null : oid(review.commit_id) });
        }
        // Do not acquire source text until complete parent/review history closes.
        if (candidate) {
          await acquireFiles(prefix, projection, pr, fileItems, true);
          if (observed) {
            projection.currentLabels = await currentLabels(prefix, repositoryId, id, number, 'pull_request');
            projection.labelsProof = 'complete_current_labels';
            await closingIssues(currentName, projection);
          }
        }
      }
      const rawEvents = await enumerate(prefix + '/issues/events?per_page=100', { kind: 'repository_issue_events', repositoryId, filters: { enumeration: 'all', projectedActions: 'triage', projectedStartDate: startDate, projectedCutoffDate: cutoffDate } });
      listUnique(rawEvents, item => stableId(item.id));
      const issueNumbers = new Map();
      for (const event of rawEvents) {
        if (!ACTIONS.has(event.event)) continue;
        const occurredAt = timestamp(event.created_at); if (!inWindow(occurredAt)) continue;
        requireThat(event.issue, 'ISSUE_EVENT_PARENT_UNSUPPORTED');
        if (event.issue.pull_request !== undefined) continue;
        const issueId = stableId(event.issue.id); const issueNumber = stableId(event.issue.number);
        requireThat(!issueNumbers.has(issueId) || issueNumbers.get(issueId) === issueNumber, 'ISSUE_ID_MISMATCH'); issueNumbers.set(issueId, issueNumber);
        let target;
        if (['labeled', 'unlabeled'].includes(event.event)) {
          requireThat(event.label?.id !== null && event.label?.id !== undefined, 'ISSUE_EVENT_TARGET_UNAVAILABLE');
          target = { kind: 'label', sourceId: { type: 'numeric', value: stableId(event.label.id) } };
        }
        else if (['assigned', 'unassigned'].includes(event.event)) target = { kind: 'assignee', accountId: stableId(event.assignee?.id) };
        else target = { kind: 'milestone', sourceId: { type: 'numeric', value: stableId(event.milestone?.id) } };
        capture.issueEvents.push({ repositoryId, sourceId: { type: 'numeric', value: stableId(event.id) }, issueId, actor: actor(event.actor), occurredAt, kind: event.event, target });
      }
      // Only referenced issue details are required; old creation dates do not exclude
      // an issue with current triage. Actor filtering is left to qualification.
      for (const [issueId, number] of [...issueNumbers].sort(([a], [b]) => numericOrder(a, b))) {
        if (observed) { await observedIssue(repositoryId, number, issueId); continue; }
        const issue = await get(prefix + '/issues/' + number);
        requireThat(stableId(issue.id) === issueId && stableId(issue.number) === number && issue.pull_request === undefined, 'ISSUE_ID_MISMATCH');
        capture.issues.push({ repositoryId, sourceId: { type: 'numeric', value: issueId }, author: actor(issue.user), createdAt: timestamp(issue.created_at), currentLabels: labels(issue.labels) });
      }
      const releases = await enumerate(prefix + '/releases?per_page=100', { kind: 'releases', repositoryId, filters: { enumeration: 'all' } });
      listUnique(releases, item => stableId(item.id));
      for (const release of releases) {
        requireThat(typeof release.draft === 'boolean' && typeof release.prerelease === 'boolean', 'RELEASE_METADATA_INVALID');
        capture.releases.push({ repositoryId, sourceId: { type: 'numeric', value: stableId(release.id) }, author: actor(release.author), draft: release.draft, prerelease: release.prerelease, publishedAt: timestamp(release.published_at, true), firstPublicationProof: 'unsupported' });
      }
      // Legacy needs reflection proof. Observed mode uses committedDate and the
      // ancestry of one fixed, actually observed default-branch HEAD instead.
      const commits = await enumerate(prefix + '/commits?sha=' + encodeURIComponent(observed ? repository.defaultBranchHeadOid : repository.defaultBranch) + '&per_page=100', { kind: 'default_branch_commits', repositoryId, filters: { branch: repository.defaultBranch, ...(observed ? { headOid: repository.defaultBranchHeadOid } : {}), ancestry: 'all', reflectionTimeFromAuthorDate: false } });
      listUnique(commits, item => oid(item.sha));
      for (const commit of commits) {
        const sha = oid(commit.sha); const author = actor(commit.author); let associatedPrIds = null;
        // Full ancestry already closed before actor/fork eligibility exclusions.
        if (!repository.fork && author.status === 'identified' && author.type === 'User' && author.accountId === subjectAccountId) {
          const associations = await enumerate(prefix + '/commits/' + sha + '/pulls?per_page=100', { kind: 'commit_pull_requests', repositoryId, parentId: sha, filters: { enumeration: 'all' } });
          listUnique(associations, item => stableId(item.id));
          associatedPrIds = associations.map(pr => stableId(pr.id)).sort(numericOrder);
        }
        const projection = { repositoryId, sourceId: { type: 'opaque', value: sha }, oid: sha, author, defaultBranchReflectionProof: 'unsupported', fullFileContents: 'not_collected', associatedPrIds };
        if (observed) {
          Object.assign(projection, { committedAt: timestamp(commit.commit?.committer?.date), defaultBranchMembership: 'current_ancestry', fileProof: 'not_collected' });
          if (!repository.fork && author.status === 'identified' && author.type === 'User' && author.accountId === subjectAccountId && inWindow(projection.committedAt)) {
            const represented = associatedPrIds.map(id => {
              const parent = capture.pullRequests.find(pr => pr.repositoryId === repositoryId && pr.sourceId.value === id);
              requireThat(parent, 'ASSOCIATED_PR_DETAIL_UNAVAILABLE'); return parent;
            }).some(pr => pr.state === 'MERGED');
            if (!represented) await acquireCommitFiles(prefix, projection);
          }
        }
        capture.commits.push(projection);
      }
    }
    return { decision: 'ready', code: 'PUBLIC_CAPTURE_COLLECTED', capture, ...baseResponse(model) };
  } catch (error) {
    return { decision: 'hold', code: error instanceof CollectionFailure ? error.code : 'COLLECTION_UNAVAILABLE', capture: null, ...baseResponse(model) };
  }
}
