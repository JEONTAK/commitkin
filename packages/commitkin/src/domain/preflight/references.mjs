import { requirePreflight as check } from './failure.mjs';
import { compareTimestamps } from '../character/activity.mjs';

const GROUP_TYPES = Object.freeze({
  repositories: 'repository', pullRequests: 'pull_request', commits: 'commit',
  reviews: 'review', releases: 'release', issues: 'issue', issueEvents: 'issue_event', fileChanges: 'file_change',
});
const sorted = rows => [...rows].sort((a, b) => a.ref.localeCompare(b.ref, 'en'));

/** Local references/provenance only: successful captures and proof labels are not authenticated. */
export function checkReferences(evidence) {
  const local = new Map(), resources = new Map(), collections = new Map(), pages = new Map(), repositories = new Map();
  const put = (ref, value) => {
    check(!local.has(ref), 'references', 'LOCAL_REFERENCE_COLLISION');
    local.set(ref, value);
  };
  const identities = new Set();
  for (const [group, type] of Object.entries(GROUP_TYPES)) {
    for (const resource of sorted(evidence.resources[group])) {
      const row = { type, resource };
      put(resource.ref, row); resources.set(resource.ref, row);
      if (type === 'repository') {
        check(resource.sourceId.value === resource.repositoryId, 'references', 'REPOSITORY_IDENTITY_MISMATCH');
        check(!repositories.has(resource.repositoryId), 'references', 'DUPLICATE_REPOSITORY_ID');
        repositories.set(resource.repositoryId, resource);
      }
      if (resource.sourceId) {
        const identity = `${type}/${resource.repositoryId}/${resource.sourceId.type}/${resource.sourceId.value}`;
        check(!identities.has(identity), 'references', 'DUPLICATE_RESOURCE_IDENTITY');
        identities.add(identity);
      }
    }
  }
  for (const collection of sorted(evidence.collections)) {
    put(collection.ref, { type: 'collection', collection }); collections.set(collection.ref, collection);
    for (const page of sorted(collection.pages)) {
      put(page.ref, { type: 'page', page, collection }); pages.set(page.ref, { page, collection });
      check(compareTimestamps(page.capturedAt, evidence.evaluation.capturedThrough) <= 0, 'references', 'CAPTURE_AFTER_COMPLETION');
    }
    const observedAt = collection.window.observedAt;
    if (observedAt) check(compareTimestamps(observedAt, evidence.evaluation.capturedThrough) <= 0, 'references', 'SNAPSHOT_AFTER_COMPLETION');
    if (collection.window.kind === 'history') {
      check(compareTimestamps(collection.window.throughExclusive, `${evidence.evaluation.activityCutoffExclusive}T00:00:00Z`) <= 0, 'references', 'HISTORY_AFTER_CUTOFF');
    }
  }
  const resource = (ref, allowed) => {
    const row = resources.get(ref);
    check(Boolean(row), 'references', 'RESOURCE_REFERENCE_MISSING');
    check(allowed.includes(row.type), 'references', 'RESOURCE_REFERENCE_KIND');
    return row.resource;
  };
  const collection = (ref, type, parent) => {
    const c = collections.get(ref);
    check(Boolean(c), 'references', 'COLLECTION_REFERENCE_MISSING');
    check(c.resourceType === type && c.target.kind === 'resource' && c.target.resourceRef === parent.ref && c.target.repositoryId === parent.repositoryId, 'references', 'COLLECTION_PARENT_MISMATCH');
    return c;
  };
  const capture = (refs, predicate) => {
    for (const ref of refs) {
      const row = pages.get(ref);
      check(Boolean(row), 'references', 'CAPTURE_REFERENCE_MISSING');
      check(row.page.response.status === 'success' && predicate(row), 'references', 'CAPTURE_PROVENANCE_MISMATCH');
    }
  };
  const proof = (parent, basis, type) => capture(basis.captureRefs, ({ collection: c }) =>
    c.resourceType === type && c.target.kind === 'resource' && c.target.resourceRef === parent.ref && c.target.repositoryId === parent.repositoryId);
  for (const { type, resource: r } of [...resources.values()].sort((a, b) => a.resource.ref.localeCompare(b.resource.ref, 'en'))) {
    check(repositories.has(r.repositoryId), 'references', 'REPOSITORY_REFERENCE_MISSING');
    capture(r.captureRefs, ({ collection: c, page }) =>
      (c.resourceType === type || (type === 'pull_request' && c.resourceType === 'pr_association')) &&
      c.target.repositoryId === r.repositoryId && page.response.itemRefs.includes(r.ref));
    if (type === 'pull_request') {
      check(r.baseRepositoryId === r.repositoryId, 'references', 'PR_BASE_REPOSITORY_MISMATCH');
      collection(r.fileCollectionRef, 'file_change', r); proof(r, r.labels, 'label_history');
      for (const ref of r.closingIssueRefs) check(resource(ref, ['issue']).repositoryId === r.repositoryId, 'references', 'RESOLVING_ISSUE_REPOSITORY_MISMATCH');
    }
    if (type === 'commit') {
      collection(r.fileCollectionRef, 'file_change', r); collection(r.pullRequestCollectionRef, 'pr_association', r);
      proof(r, r.reflectedAt, 'commit');
    }
    if (type === 'review') check(resource(r.pullRequestRef, ['pull_request']).repositoryId === r.repositoryId, 'references', 'REVIEW_PR_REPOSITORY_MISMATCH');
    if (type === 'release') proof(r, r.firstPublication, 'release');
    if (type === 'issue') proof(r, r.labels, 'label_history');
    if (type === 'issue_event') check(resource(r.issueRef, ['issue']).repositoryId === r.repositoryId, 'references', 'ISSUE_EVENT_PARENT_MISMATCH');
    if (type === 'file_change') {
      const p = resource(r.parentRef, ['pull_request', 'commit']);
      check(p.repositoryId === r.repositoryId, 'references', 'FILE_PARENT_REPOSITORY_MISMATCH');
      const files = collection(p.fileCollectionRef, 'file_change', p);
      capture(r.captureRefs, ({ collection: c }) => c.ref === files.ref);
      if (r.content.mode === 'patch') capture(r.content.captureRefs, ({ collection: c }) => c.ref === files.ref);
    }
  }
  for (const c of sorted(evidence.collections)) {
    check(repositories.has(c.target.repositoryId), 'references', 'COLLECTION_REPOSITORY_MISSING');
    let parent = null;
    if (c.target.kind === 'resource') {
      const allowed = c.purpose === 'metadata' ? [c.resourceType] : c.resourceType === 'file_change' || c.resourceType === 'label_history' ? ['pull_request', ...(c.resourceType === 'file_change' ? ['commit'] : ['issue'])] : c.resourceType === 'pr_association' || c.resourceType === 'commit' ? ['commit'] : c.resourceType === 'review' ? ['pull_request'] : ['release'];
      parent = resource(c.target.resourceRef, allowed);
      check(parent.repositoryId === c.target.repositoryId, 'references', 'COLLECTION_TARGET_REPOSITORY_MISMATCH');
    }
    for (const p of c.pages) {
      if (p.response.status !== 'success') continue;
      for (const ref of p.response.itemRefs) {
        const types = c.resourceType === 'pr_association' ? ['pull_request'] : c.resourceType === 'label_history' ? ['pull_request', 'issue'] : [c.resourceType];
        const r = resource(ref, types);
        check(r.repositoryId === c.target.repositoryId, 'references', 'PAGE_ITEM_REPOSITORY_MISMATCH');
        if (parent && (c.purpose === 'metadata' || ['commit', 'release', 'label_history'].includes(c.resourceType))) check(r.ref === parent.ref, 'references', 'PAGE_ITEM_PARENT_MISMATCH');
        if (parent && c.resourceType === 'file_change') check(r.parentRef === parent.ref, 'references', 'PAGE_FILE_PARENT_MISMATCH');
        if (parent && c.resourceType === 'review') check(r.pullRequestRef === parent.ref, 'references', 'PAGE_REVIEW_PARENT_MISMATCH');
      }
    }
  }
  return { resources, collections, pages, repositories };
}
