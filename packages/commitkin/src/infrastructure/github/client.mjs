import { checkedNextLink, createTransport } from './transport.mjs';

// One fixed read-only document, never caller-supplied GraphQL. BigInt fields are
// strings in GitHub's schema; databaseId's deprecated 32-bit representation is
// deliberately not used. No bodies, titles, labels or URLs are requested here.
export const CLOSING_ISSUES_QUERY = `query CommitkinClosingIssues($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name, followRenames: false) {
    fullDatabaseId nameWithOwner isPrivate
    pullRequest(number: $number) {
      fullDatabaseId number
      closingIssuesReferences(first: 100, after: $after, excludeUserLinked: false, userLinkedOnly: false) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { fullDatabaseId number repository { fullDatabaseId nameWithOwner isPrivate } }
      }
    }
  }
}`;
const REPOSITORY_NAME = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i;
const DATABASE_ID = /^[1-9][0-9]{0,127}$/;
const GRAPHQL_INT_MAX = 2147483647;
const GIT_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function repositoryName(value) { return typeof value === 'string' && REPOSITORY_NAME.test(value) && !['.', '..'].includes(value.split('/')[1]); }
function databaseId(value) { return typeof value === 'string' && DATABASE_ID.test(value); }
function positiveInt(value) { return Number.isSafeInteger(value) && value >= 1 && value <= GRAPHQL_INT_MAX; }
function cursor(value) { return typeof value === 'string' && value.length >= 1 && value.length <= 4096 && !/[\x00-\x1f\x7f]/u.test(value); }
function gitDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19); }
function gitPath(value) { return typeof value === 'string' && value.length > 0 && value.length <= 32768 && value.isWellFormed() && !value.startsWith('/') && !/[\\\x00-\x1f\x7f]/u.test(value) && !value.split('/').some(part => ['', '.', '..'].includes(part)); }
function commitFailure(code, pages = 0, status) { return { ok: false, complete: false, code, files: [], pages, ...(status === undefined ? {} : { status }) }; }
function closingFailure(code, pages = 0, status) { return { ok: false, complete: false, code, items: [], pages, ...(status === undefined ? {} : { status }) }; }
function graphqlErrorCode(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return 'CLOSING_ISSUES_RESPONSE_INVALID';
  if (errors.some(error => error?.type === 'RATE_LIMITED')) return 'RATE_LIMITED';
  if (errors.some(error => error?.type === 'FORBIDDEN')) return 'ACCESS_DENIED';
  if (errors.some(error => error?.type === 'NOT_FOUND')) return 'REPOSITORY_UNAVAILABLE';
  return 'CLOSING_ISSUES_QUERY_FAILED';
}

/** GET plus one fixed read-only GraphQL query. Supply fetch explicitly. */
export function createGithubClient(options) {
  const transport = createTransport(options);
  async function get(path) { return transport.request('GET', path); }
  async function paginate(path, { maxPages = 10, repositoryId, subjectAccountId } = {}) {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) return { ok: false, complete: false, code: 'PAGINATION_OPTIONS_INVALID', items: [] };
    const binding = repositoryId === undefined && subjectAccountId === undefined ? undefined : { initialPath: path, ...(repositoryId === undefined ? {} : { repositoryId }), ...(subjectAccountId === undefined ? {} : { subjectAccountId }) };
    if (binding !== undefined) {
      const checked = checkedNextLink(null, path, binding);
      if (!checked.ok) return { ...checked, complete: false, items: [] };
    }
    let next = path;
    const seen = new Set(); const items = []; const pageSnapshots = [];
    for (let page = 0; page < maxPages; page += 1) {
      if (seen.has(next)) return { ok: false, complete: false, code: 'PAGINATION_CYCLE', items, pageSnapshots };
      seen.add(next);
      const result = await get(next);
      if (!result.ok) return { ...result, complete: false, items, pageSnapshots };
      if (!Array.isArray(result.data)) return { ok: false, complete: false, code: 'PAGINATION_RESPONSE_INVALID', items, pageSnapshots };
      const startIndex = items.length;
      items.push(...result.data);
      const link = checkedNextLink(result.link, next, binding);
      if (!link.ok) return { ...link, complete: false, items, pageSnapshots };
      pageSnapshots.push({ sequence: page + 1, requestPath: next, itemCount: result.data.length, nextPath: link.next, startIndex, endIndexExclusive: items.length });
      if (link.next === null) return { ok: true, complete: true, code: 'CAPTURED', items, pages: page + 1, pageSnapshots };
      next = link.next;
    }
    return { ok: false, complete: false, code: 'PAGE_LIMIT_REACHED', items, pages: maxPages, pageSnapshots };
  }
  /** One fixed JSON object pagination contract, never a caller-selected field. */
  async function commitFiles(input) {
    if (!record(input) || Object.keys(input).some(key => !['repository', 'repositoryId', 'oid', 'maxPages'].includes(key)) || !repositoryName(input.repository) || typeof input.oid !== 'string' || !GIT_OID.test(input.oid) || input.repositoryId !== undefined && !databaseId(input.repositoryId)) return commitFailure('COMMIT_FILES_INPUT_INVALID');
    const { repository, repositoryId, oid, maxPages = 30 } = input;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 30) return commitFailure('PAGINATION_OPTIONS_INVALID');
    let next = '/repos/' + repository + '/commits/' + oid + '?per_page=100';
    const binding = repositoryId === undefined ? undefined : { initialPath: next, repositoryId };
    const files = []; const pageSnapshots = []; const paths = new Set(); const requests = new Set(); let metadata = null;
    for (let page = 0; page < maxPages; page += 1) {
      if (requests.has(next)) return commitFailure('PAGINATION_CYCLE', page);
      requests.add(next);
      const result = await get(next);
      if (!result.ok) return commitFailure(result.code, page, result.status);
      const data = result.data;
      if (!record(data) || data.sha !== oid || !Array.isArray(data.parents) || data.parents.some(parent => !record(parent) || typeof parent.sha !== 'string' || !GIT_OID.test(parent.sha)) || !record(data.commit) || !record(data.commit.tree) || typeof data.commit.tree.sha !== 'string' || !GIT_OID.test(data.commit.tree.sha) || !gitDate(data.commit.committer?.date) || !Array.isArray(data.files) || data.files.length > 100) return commitFailure('COMMIT_FILES_RESPONSE_INVALID', page);
      const current = { oid, treeOid: data.commit.tree.sha, parentOids: data.parents.map(parent => parent.sha), committedAt: data.commit.committer.date };
      if (new Set(current.parentOids).size !== current.parentOids.length) return commitFailure('COMMIT_FILES_RESPONSE_INVALID', page);
      if (metadata !== null && JSON.stringify(metadata) !== JSON.stringify(current)) return commitFailure('COMMIT_FILES_METADATA_CHANGED', page);
      metadata = current;
      const startIndex = files.length;
      for (const file of data.files) {
        if (!record(file) || !gitPath(file.filename) || typeof file.sha !== 'string' || !GIT_OID.test(file.sha) || !['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(file.status) || file.previous_filename !== undefined && !gitPath(file.previous_filename) || ['renamed', 'copied'].includes(file.status) && file.previous_filename === undefined) return commitFailure('COMMIT_FILE_METADATA_INVALID', page);
        if (paths.has(file.filename)) return commitFailure('DUPLICATE_COMMIT_FILE', page);
        paths.add(file.filename);
        // Keep only fields used by the independent full-tree/OID verifier. Raw
        // patches, email, messages and provider-controlled URLs never escape.
        files.push({ filename: file.filename, status: file.status, sha: file.sha, ...(file.previous_filename === undefined ? {} : { previous_filename: file.previous_filename }) });
      }
      // The documented 3000-file provider ceiling cannot certify completeness,
      // even when the final response omits its continuation header.
      if (files.length >= 3000) return commitFailure('COMMIT_FILE_LIMIT_REACHED', page + 1);
      const link = checkedNextLink(result.link, next, binding);
      if (!link.ok) return commitFailure(link.code, page + 1);
      if (link.next !== null) {
        const destination = new URL(link.next, 'https://api.github.com');
        if (data.files.length === 0 || destination.searchParams.getAll('page').length !== 1 || destination.searchParams.get('page') !== String(page + 2) || [...destination.searchParams.keys()].some(key => !['per_page', 'page'].includes(key))) return commitFailure('COMMIT_FILES_PAGINATION_INVALID', page + 1);
      }
      pageSnapshots.push({ sequence: page + 1, requestPath: next, itemCount: data.files.length, nextPath: link.next, startIndex, endIndexExclusive: files.length });
      if (link.next === null) return { ok: true, complete: true, code: 'CAPTURED', metadata, files, pages: page + 1, receivedItems: files.length, pageSnapshots };
      next = link.next;
    }
    return commitFailure('PAGE_LIMIT_REACHED', maxPages);
  }
  async function closingIssues(input) {
    if (!record(input) || Object.keys(input).some(key => !['repository', 'pullNumber', 'maxPages'].includes(key)) ||
      !repositoryName(input.repository) || typeof input.pullNumber !== 'string' || !/^[1-9][0-9]{0,9}$/.test(input.pullNumber) || !positiveInt(Number(input.pullNumber))) return closingFailure('CLOSING_ISSUES_INPUT_INVALID');
    const { repository, pullNumber, maxPages = 10 } = input;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) return closingFailure('PAGINATION_OPTIONS_INVALID');
    const [owner, name] = repository.split('/');
    const items = []; const pageSnapshots = []; const cursors = new Set(); const identities = new Set(); const issueNumbers = new Set(); const repositoryNames = new Map(); const repositoryIds = new Map();
    let after = null; let totalCount = null; let repositoryId = null; let pullRequestId = null; let canonicalName = null; let receivedItems = 0; let excludedPrivateCount = 0;
    for (let page = 0; page < maxPages; page += 1) {
      const result = await transport.request('POST', '/graphql', { operationName: 'CommitkinClosingIssues', query: CLOSING_ISSUES_QUERY, variables: { owner, name, number: Number(pullNumber), after } });
      if (!result.ok) return closingFailure(result.code === 'WRITE_OUTCOME_UNKNOWN' ? 'NETWORK_UNAVAILABLE' : result.code, page, result.status);
      const payload = result.data;
      if (!record(payload)) return closingFailure('CLOSING_ISSUES_RESPONSE_INVALID', page);
      if (Object.hasOwn(payload, 'errors') && (!Array.isArray(payload.errors) || payload.errors.length > 0)) return closingFailure(graphqlErrorCode(payload.errors), page);
      const repo = payload.data?.repository; const pull = repo?.pullRequest;
      if (repo === null || pull === null) return closingFailure('REPOSITORY_UNAVAILABLE', page);
      if (!record(repo) || !databaseId(repo.fullDatabaseId) || !repositoryName(repo.nameWithOwner) || typeof repo.isPrivate !== 'boolean' || !record(pull) || !databaseId(pull.fullDatabaseId) || !positiveInt(pull.number)) return closingFailure('CLOSING_ISSUES_RESPONSE_INVALID', page);
      if (repo.isPrivate) return closingFailure('ACCESS_DENIED', page);
      if (repo.nameWithOwner.toLowerCase() !== repository.toLowerCase() || String(pull.number) !== pullNumber ||
        repositoryId !== null && (repositoryId !== repo.fullDatabaseId || pullRequestId !== pull.fullDatabaseId || canonicalName !== repo.nameWithOwner)) return closingFailure('CLOSING_ISSUES_IDENTITY_MISMATCH', page);
      repositoryId = repo.fullDatabaseId; pullRequestId = pull.fullDatabaseId; canonicalName = repo.nameWithOwner;
      repositoryNames.set(repositoryId, { name: canonicalName, private: false }); repositoryIds.set(canonicalName.toLowerCase(), repositoryId);
      const connection = pull.closingIssuesReferences; const info = connection?.pageInfo;
      if (!record(connection) || !Number.isSafeInteger(connection.totalCount) || connection.totalCount < 0 || connection.totalCount > GRAPHQL_INT_MAX ||
        !Array.isArray(connection.nodes) || connection.nodes.length > 100 || !record(info) || typeof info.hasNextPage !== 'boolean' ||
        !(info.endCursor === null || cursor(info.endCursor)) || info.hasNextPage && (connection.nodes.length === 0 || !cursor(info.endCursor))) return closingFailure('CLOSING_ISSUES_RESPONSE_INVALID', page);
      if (totalCount !== null && totalCount !== connection.totalCount) return closingFailure('CLOSING_ISSUES_COUNT_CHANGED', page);
      totalCount = connection.totalCount;
      if (info.hasNextPage && cursors.has(info.endCursor)) return closingFailure('PAGINATION_CYCLE', page);
      let skipped = 0;
      for (const issue of connection.nodes) {
        const linked = issue?.repository;
        if (!record(issue) || !databaseId(issue.fullDatabaseId) || !positiveInt(issue.number) || !record(linked) || !databaseId(linked.fullDatabaseId) ||
          !repositoryName(linked.nameWithOwner) || typeof linked.isPrivate !== 'boolean') return closingFailure('CLOSING_ISSUES_RESPONSE_INVALID', page);
        // A repeated provider node is not silently deduplicated: doing so could
        // conceal pagination drift and falsely claim an exhaustive connection.
        const issueNumber = `${linked.fullDatabaseId}:${issue.number}`;
        if (identities.has(issue.fullDatabaseId) || issueNumbers.has(issueNumber)) return closingFailure('CLOSING_ISSUES_DUPLICATE', page);
        identities.add(issue.fullDatabaseId); issueNumbers.add(issueNumber);
        const priorRepository = repositoryNames.get(linked.fullDatabaseId); const priorId = repositoryIds.get(linked.nameWithOwner.toLowerCase());
        if (priorRepository !== undefined && (priorRepository.name !== linked.nameWithOwner || priorRepository.private !== linked.isPrivate) ||
          priorId !== undefined && priorId !== linked.fullDatabaseId) return closingFailure('CLOSING_ISSUES_IDENTITY_MISMATCH', page);
        repositoryNames.set(linked.fullDatabaseId, { name: linked.nameWithOwner, private: linked.isPrivate }); repositoryIds.set(linked.nameWithOwner.toLowerCase(), linked.fullDatabaseId);
        // Confirmed private references are outside public scope. Only their
        // count is returned, never their names, numbers or identifiers.
        if (linked.isPrivate) { skipped += 1; continue; }
        items.push({ repositoryId: linked.fullDatabaseId, repositoryName: linked.nameWithOwner, number: String(issue.number), sourceId: { type: 'numeric', value: issue.fullDatabaseId } });
      }
      const startIndex = receivedItems;
      receivedItems += connection.nodes.length; excludedPrivateCount += skipped;
      if (receivedItems > totalCount || info.hasNextPage && receivedItems >= totalCount || !info.hasNextPage && receivedItems !== totalCount) return closingFailure('CLOSING_ISSUES_COUNT_MISMATCH', page);
      pageSnapshots.push({ sequence: page + 1, requestCursor: after, endCursor: info.endCursor, hasNextPage: info.hasNextPage, itemCount: connection.nodes.length,
        includedCount: connection.nodes.length - skipped, excludedPrivateCount: skipped, startIndex, endIndexExclusive: receivedItems });
      if (!info.hasNextPage) return { ok: true, complete: true, code: 'CAPTURED', repositoryId, repositoryName: canonicalName, pullRequestId, pullNumber, items, pages: page + 1, totalCount, excludedPrivateCount, pageSnapshots };
      cursors.add(info.endCursor); after = info.endCursor;
    }
    return closingFailure('PAGE_LIMIT_REACHED', maxPages);
  }
  return Object.freeze({ get, paginate, closingIssues, commitFiles, budget: transport.budget, diagnostics: transport.diagnostics });
}
