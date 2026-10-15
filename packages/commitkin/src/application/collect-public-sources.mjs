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
  historicalBugLabelState: 'unsupported', fullBeforeAfterFileContents: 'not_collected',
  normalizedEvidenceEnvelope: 'not_implemented', progression: 'not_authorized',
});
const SAFE_CODES = new Set([
  'REQUEST_BUDGET_EXHAUSTED', 'PAGE_LIMIT_REACHED', 'PAGINATION_CYCLE',
  'PAGINATION_INVALID', 'PAGINATION_RESPONSE_INVALID', 'PAGINATION_DESTINATION_REJECTED',
  'PAGINATION_QUERY_CHANGED', 'REPOSITORY_UNAVAILABLE', 'ACCESS_DENIED', 'RATE_LIMITED',
  'NETWORK_UNAVAILABLE', 'HTTP_UNAVAILABLE', 'RESPONSE_TOO_LARGE', 'RESPONSE_JSON_INVALID',
  'UNSAFE_JSON_INTEGER', 'REDIRECT_REJECTED', 'REMOTE_CONFLICT',
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
function numericOrder(a, b) { return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0; }
function listUnique(items, identity) { const keys = items.map(identity); requireThat(new Set(keys).size === keys.length, 'DUPLICATE_SOURCE_IDENTITY'); }
function baseResponse() { return { capabilities: { ...CAPABILITIES }, limitations: [...LIMITATIONS], qualificationReady: false, sourceAuthenticity: 'not_checked', progressionAuthorized: false }; }

export async function collectPublicSources({ client, repositories, subjectAccountId, startDate, cutoffDate }) {
  try {
    requireThat(client && typeof client.get === 'function' && typeof client.paginate === 'function' && typeof client.budget === 'function' && Array.isArray(repositories), 'COLLECTION_INPUT_INVALID');
    requireThat(typeof subjectAccountId === 'string' && ID.test(subjectAccountId) && dateValid(startDate) && dateValid(cutoffDate) && startDate <= cutoffDate, 'COLLECTION_INPUT_INVALID');
    const inputs = repositories.map(item => ({ repositoryId: stableId(item.id ?? item.repositoryId), name: name(item.name) }));
    listUnique(inputs, item => item.repositoryId);
    inputs.sort((a, b) => numericOrder(a.repositoryId, b.repositoryId));
    const capture = { subjectAccountId, window: { startDate, cutoffDate }, repositories: [], pullRequests: [], files: [], reviews: [], issues: [], issueEvents: [], releases: [], commits: [], queries: [] };
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
    async function enumerate(path, query, maxPages = 100) {
      budgetAvailable(); const result = await client.paginate(path, { maxPages });
      requireThat(result?.ok === true && result.complete === true, SAFE_CODES.has(result?.code) ? result.code : 'INCOMPLETE_COLLECTION');
      requireThat(Array.isArray(result.items) && Number.isSafeInteger(result.pages) && result.pages >= 1 && result.pages <= maxPages, 'CAPTURE_CLOSURE_INVALID');
      capture.queries.push({ ...query, pages: result.pages, receivedItems: result.items.length, closed: true });
      return result.items;
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
        const fileItems = await enumerate(prefix + '/pulls/' + number + '/files?per_page=100', { kind: 'pull_request_files', repositoryId, parentId: id, filters: { wholeParentRevision: true } }, 30);
        requireThat(fileItems.length < 3000 && pr.changed_files < 3000, 'PR_FILE_LIMIT_REACHED');
        requireThat(fileItems.length === pr.changed_files, 'PR_FILE_COUNT_MISMATCH');
        listUnique(fileItems, file => file.filename);
        for (const file of fileItems) {
          requireThat(typeof file.filename === 'string' && file.filename.length > 0 && file.filename.isWellFormed() && ['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'].includes(file.status), 'FILE_METADATA_INVALID');
          requireThat(file.previous_filename === undefined || typeof file.previous_filename === 'string' && file.previous_filename.isWellFormed(), 'FILE_METADATA_INVALID');
          // PR files expose one blob SHA, not both full revisions. Do not substitute
          // parent commit SHAs or pretend omitted patch text is complete content.
          capture.files.push({ repositoryId, pullRequestId: id, path: file.filename, previousPath: file.previous_filename ?? null, kind: file.status, observedBlobOid: oid(file.sha), contentProof: 'not_collected' });
        }
        const reviews = await enumerate(prefix + '/pulls/' + number + '/reviews?per_page=100', { kind: 'pull_request_reviews', repositoryId, parentId: id, filters: { states: 'all', history: 'all' } });
        listUnique(reviews, item => stableId(item.id));
        for (const review of reviews) {
          requireThat(['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state), 'REVIEW_STATE_UNSUPPORTED');
          requireThat(review.state !== 'PENDING' || review.submitted_at === null || review.submitted_at === undefined, 'REVIEW_STATE_CONTRADICTION');
          const submittedAt = review.state === 'PENDING' ? null : timestamp(review.submitted_at);
          capture.reviews.push({ repositoryId, pullRequestId: id, sourceId: { type: 'numeric', value: stableId(review.id) }, reviewer: actor(review.user), state: review.state, submittedAt, reviewedCommitOid: review.commit_id === null && review.state === 'PENDING' ? null : oid(review.commit_id) });
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
      // No since/until/author predicate: commit author/committer timestamps do not
      // establish when a commit reached the default branch.
      const commits = await enumerate(prefix + '/commits?sha=' + encodeURIComponent(repository.defaultBranch) + '&per_page=100', { kind: 'default_branch_commits', repositoryId, filters: { branch: repository.defaultBranch, ancestry: 'all', reflectionTimeFromAuthorDate: false } });
      listUnique(commits, item => oid(item.sha));
      for (const commit of commits) {
        const sha = oid(commit.sha); const author = actor(commit.author); let associatedPrIds = null;
        // Full ancestry already closed before actor/fork eligibility exclusions.
        if (!repository.fork && author.status === 'identified' && author.type === 'User' && author.accountId === subjectAccountId) {
          const associations = await enumerate(prefix + '/commits/' + sha + '/pulls?per_page=100', { kind: 'commit_pull_requests', repositoryId, parentId: sha, filters: { enumeration: 'all' } });
          listUnique(associations, item => stableId(item.id));
          associatedPrIds = associations.map(pr => stableId(pr.id)).sort(numericOrder);
        }
        capture.commits.push({ repositoryId, sourceId: { type: 'opaque', value: sha }, oid: sha, author, defaultBranchReflectionProof: 'unsupported', fullFileContents: 'not_collected', associatedPrIds });
      }
    }
    return { decision: 'ready', code: 'PUBLIC_CAPTURE_COLLECTED', capture, ...baseResponse() };
  } catch (error) {
    return { decision: 'hold', code: error instanceof CollectionFailure ? error.code : 'COLLECTION_UNAVAILABLE', capture: null, ...baseResponse() };
  }
}
