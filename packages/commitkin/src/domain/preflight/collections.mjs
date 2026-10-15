import { requirePreflight as check, PreflightFailure } from './failure.mjs';

const BASE = Object.freeze([
  ['repository', 'metadata'], ['pull_request', 'activity'], ['commit', 'activity'],
  ['review', 'activity'], ['release', 'activity'], ['issue_event', 'activity'],
]);
const requestKey = c => [c.resourceType, c.target.kind, c.target.repositoryId, c.target.resourceRef ?? '', c.purpose].join('/');

/** Derive fixed obligations from external scope and actual represented relations. */
export function checkRequiredCollections(evidence, scope, index) {
  const byRequest = new Map(), required = new Set(), effective = new Set(scope.repositoryIds);
  for (const c of [...evidence.collections].sort((a, b) => a.ref.localeCompare(b.ref, 'en'))) {
    const key = requestKey(c);
    check(!byRequest.has(key), 'required-collections', 'DUPLICATE_LOGICAL_REQUEST');
    byRequest.set(key, c);
    if (c.target.kind === 'repository' && c.purpose === 'activity') {
      check(effective.has(c.target.repositoryId), 'required-collections', 'ACTIVITY_OUTSIDE_EFFECTIVE_SCOPE');
      check(c.window.startAt === scope.startAt && c.window.endAtExclusive === scope.cutoff, 'required-collections', 'ACTIVITY_INTERVAL_MISMATCH');
    }
  }
  const requireRequest = (type, target, purpose) => {
    const key = requestKey({ resourceType: type, target, purpose });
    const c = byRequest.get(key);
    check(Boolean(c), 'required-collections', 'REQUIRED_REQUEST_OMITTED');
    required.add(c.ref);
    return c;
  };
  for (const repositoryId of scope.repositoryIds) for (const [type, purpose] of BASE) {
    requireRequest(type, { kind: 'repository', repositoryId }, purpose);
  }
  for (const [ref, { type, resource: r }] of index.resources) {
    const target = { kind: 'resource', repositoryId: r.repositoryId, resourceRef: ref };
    if (type === 'pull_request' || type === 'issue') requireRequest(type, target, 'metadata');
    if (type === 'pull_request' || type === 'commit') {
      required.add(r.fileCollectionRef);
      if (type === 'commit') required.add(r.pullRequestCollectionRef);
    }
  }
  // History necessity is qualification-dependent. Its shape/references are checked,
  // but an optional historical failure cannot become either universal hold or proof.
  return required;
}

/** Check declared capture closure, not GitHub-wide discovery or historical truth. */
export function checkCollectionClosure(evidence, required) {
  const contradictions = new Set(), holds = new Set();
  for (const c of [...evidence.collections].sort((a, b) => a.ref.localeCompare(b.ref, 'en'))) {
    const needed = required.has(c.ref);
    const hold = code => { if (needed) holds.add(code); };
    if (c.state === 'not_collected') { hold('REQUIRED_COLLECTION_NOT_COLLECTED'); continue; }
    const pages = [...c.pages].sort((a, b) => a.sequence - b.sequence);
    const items = new Set(), totals = new Set(), cursors = new Set();
    let incomplete = false;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i], response = page.response, previous = pages[i - 1];
      if (page.sequence !== i + 1) contradictions.add('PAGE_SEQUENCE_INVALID');
      if (i === 0 && page.requestCursor !== null) contradictions.add('FIRST_CURSOR_NOT_NULL');
      if (page.requestCursor !== null) {
        if (cursors.has(page.requestCursor)) contradictions.add('CURSOR_CYCLE');
        cursors.add(page.requestCursor);
      }
      if (previous) {
        const prior = previous.response;
        if (prior.status !== 'success' || prior.pagination.state !== 'more' || prior.pagination.nextCursor !== page.requestCursor) contradictions.add('CURSOR_CHAIN_MISMATCH');
      }
      if (response.status === 'failure') { incomplete = true; hold('REQUIRED_COLLECTION_FAILED'); continue; }
      if (response.truncation !== 'not_reported') { incomplete = true; hold('REQUIRED_COLLECTION_TRUNCATED_OR_UNKNOWN'); }
      if (response.total.status === 'provided') totals.add(response.total.value);
      for (const ref of response.itemRefs) {
        if (items.has(ref)) contradictions.add('DUPLICATE_PAGE_ITEM');
        items.add(ref);
      }
      if (i === pages.length - 1 && response.pagination.state !== 'end') {
        incomplete = true;
        hold(response.pagination.state === 'more' ? 'NEXT_PAGE_MISSING' : 'COLLECTION_TERMINATION_UNKNOWN');
      }
      if (response.pagination.state === 'more' && cursors.has(response.pagination.nextCursor)) contradictions.add('CURSOR_CYCLE');
    }
    if (totals.size > 1) contradictions.add('COMPARABLE_TOTAL_CONFLICT');
    const total = [...totals][0];
    if (total !== undefined && (total < items.size || (!incomplete && total !== items.size))) contradictions.add('COMPARABLE_TOTAL_MISMATCH');
    if (needed && !incomplete && c.purpose === 'metadata' && c.target.kind === 'resource' && !items.has(c.target.resourceRef)) contradictions.add('DETAIL_RESPONSE_MISSING');
  }
  // Inspect every collection before selecting a fixed diagnostic. Missing evidence
  // cannot hide a contradictory chain/count in a later array position.
  if (contradictions.size) throw new PreflightFailure('collection-completeness', [...contradictions].sort()[0]);
  if (holds.size) throw new PreflightFailure('collection-completeness', [...holds].sort()[0], 'hold');
}
