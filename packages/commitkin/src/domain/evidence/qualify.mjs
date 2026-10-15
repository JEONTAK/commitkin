import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';

/** Offline, evidence-relative qualification. No source authenticity or write authority. */
class QualificationFailure extends Error {
  constructor(code, decision = 'hold', temporal = false) { super(code); this.code = code; this.decision = decision; this.temporal = temporal; }
}
function demand(condition, code, decision = 'hold', temporal = false) { if (!condition) throw new QualificationFailure(code, decision, temporal); }
function numeric(value) { return typeof value === 'string' && /^[1-9][0-9]*$/.test(value); }
function compareId(a, b) { return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0; }
function hash(value) { return 'v1:sha256:' + createHash('sha256').update(canonicalize(value), 'utf8').digest('hex'); }
function blobHash(text, oid) {
  demand(typeof text === 'string' && text.isWellFormed() && typeof oid === 'string' && [40, 64].includes(oid.length), 'FILE_CONTENT_OID_MISMATCH', 'rejected');
  const bytes = new TextEncoder().encode(text);
  return createHash(oid.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function day(value) { return value.slice(0, 10); }
function dateValid(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value; }
function source(resource, type = 'numeric') {
  demand(resource?.sourceId?.type === type && typeof resource.sourceId.value === 'string' && (type === 'numeric' ? numeric(resource.sourceId.value) : resource.sourceId.value.length > 0), 'SOURCE_IDENTIFIER_INVALID', 'rejected');
  return resource.sourceId.value;
}

export function activityIdentity({ kind, accountId, repositoryId, sourceId }) {
  demand(numeric(accountId) && numeric(repositoryId), 'SOURCE_IDENTIFIER_INVALID', 'rejected');
  const scalar = ['pull_request', 'merged_pr', 'submitted_review', 'release', 'published_release', 'issue'];
  const oid = value => typeof value === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value);
  demand(scalar.includes(kind) || ['reviewed_commit', 'direct_contribution', 'triage_day'].includes(kind), 'SOURCE_IDENTIFIER_INVALID', 'rejected');
  if (scalar.includes(kind)) demand(numeric(sourceId), 'SOURCE_IDENTIFIER_INVALID', 'rejected');
  if (kind === 'direct_contribution') demand(oid(sourceId), 'SOURCE_IDENTIFIER_INVALID', 'rejected');
  if (kind === 'triage_day') demand(dateValid(sourceId), 'SOURCE_IDENTIFIER_INVALID', 'rejected');
  if (kind === 'reviewed_commit') demand(sourceId && Object.keys(sourceId).length === 2 && numeric(sourceId.pullRequestId) && oid(sourceId.commitOid), 'SOURCE_IDENTIFIER_INVALID', 'rejected');
  return hash({ kind, accountId, repositoryId, sourceId });
}

function glob(pattern, path) {
  demand(typeof pattern === 'string' && pattern.length > 0, 'POLICY_BODY_UNSUPPORTED');
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { expression += '(?:.*/)?'; index += 2; }
      else { expression += '.*'; index += 1; }
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[\^$.*+?()[\]{}|\\]/g, '\\$&');
  }
  return new RegExp(expression + '$', 'u').test(path);
}

function resolvePolicies(evidence, registry) {
  const result = {};
  for (const name of ['fileRules', 'bugLabels']) {
    const descriptor = evidence.policies?.[name];
    demand(descriptor && ['bundled', 'inline'].includes(descriptor.mode), 'POLICY_UNSUPPORTED');
    const entry = registry?.[name]?.find(item => item.id === descriptor.id && item.version === descriptor.version);
    demand(entry && entry.body && descriptor.hash === hash(entry.body), 'POLICY_UNSUPPORTED');
    if (descriptor.mode === 'inline') demand(canonicalize(descriptor.body) === canonicalize(entry.body), 'POLICY_BODY_MISMATCH', 'rejected');
    result[name] = entry.body;
  }
  demand(result.fileRules.version === '1' && canonicalize(result.fileRules.precedence) === canonicalize(['deployment', 'test', 'documentation', 'source']), 'POLICY_BODY_UNSUPPORTED');
  return result;
}

/** Pages are normalized capture claims, not authenticated GitHub responses. */
function closedCollection(collection, expected) {
  demand(collection && collection.resourceType === expected.type && collection.target.repositoryId === expected.repositoryId && collection.target.kind === expected.targetKind && (expected.parentRef === undefined || collection.target.resourceRef === expected.parentRef) && collection.purpose === expected.purpose, 'REQUIRED_COLLECTION_MISMATCH', 'rejected');
  if (expected.windowKind) demand(collection.window.kind === expected.windowKind, 'REQUIRED_COLLECTION_MISMATCH', 'rejected');
  if (expected.through) demand(collection.window.throughExclusive === expected.through, 'REQUIRED_HISTORY_WINDOW_MISMATCH', 'rejected');
  demand(collection.state === 'captured' && collection.pages.length > 0, 'REQUIRED_COLLECTION_INCOMPLETE');
  const pages = [...collection.pages].sort((left, right) => left.sequence - right.sequence);
  let cursor = null; let total = null; const refs = []; const seenCursors = new Set();
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]; const response = page.response;
    demand(page.sequence === index + 1 && page.requestCursor === cursor, 'PAGE_CHAIN_CONTRADICTION', 'rejected');
    demand(response.status === 'success', 'REQUIRED_COLLECTION_INCOMPLETE');
    demand(response.truncation === 'not_reported', 'REQUIRED_COLLECTION_INCOMPLETE');
    demand(response.pagination.state !== 'unknown', 'REQUIRED_COLLECTION_INCOMPLETE');
    if (response.total.status === 'provided') {
      demand(total === null || total === response.total.value, 'COLLECTION_COUNT_CONTRADICTION', 'rejected'); total = response.total.value;
    }
    refs.push(...response.itemRefs);
    if (response.pagination.state === 'end') demand(index === pages.length - 1 && response.pagination.nextCursor === null, 'PAGE_CHAIN_CONTRADICTION', 'rejected');
    else {
      demand(response.pagination.state === 'more' && typeof response.pagination.nextCursor === 'string' && !seenCursors.has(response.pagination.nextCursor), 'PAGE_CHAIN_CONTRADICTION', 'rejected');
      seenCursors.add(response.pagination.nextCursor); cursor = response.pagination.nextCursor;
      demand(index < pages.length - 1, 'REQUIRED_COLLECTION_INCOMPLETE');
    }
  }
  demand(pages.at(-1).response.pagination.state === 'end', 'REQUIRED_COLLECTION_INCOMPLETE');
  demand(new Set(refs).size === refs.length && (total === null || total === refs.length), 'COLLECTION_COUNT_CONTRADICTION', 'rejected');
  return refs;
}

function actorState(actor, accountId) {
  if (actor?.status !== 'identified') return 'unknown';
  if (actor.type === 'Bot') return 'bot';
  return actor.type === 'User' && actor.accountId === accountId ? 'subject' : 'other';
}

/**
 * Registry and growthStartDate are composition-owned inputs, not evidence-controlled
 * policy/trust switches. Run strict schema/preflight first; this stage never clears
 * aggregate coverage or source-authenticity gates. Historical execution context is
 * ephemeral and must not become a public raw activity cache.
 */
export function qualifyEvidence({ evidence, context, previousLedger = null, policyRegistry = {}, growthStartDate }) {
  const exclusions = {};
  const exclude = code => { exclusions[code] = (exclusions[code] ?? 0) + 1; };
  const orderedExclusions = () => Object.fromEntries(Object.keys(exclusions).sort().map(code => [code, exclusions[code]]));
  try {
    demand(evidence?.evidenceVersion === 1 && evidence.rulesetVersion === '1.0.0' && evidence.adapter?.id === 'github.com' && evidence.adapter.version === '1', 'EVIDENCE_VERSION_UNSUPPORTED');
    const accountId = context?.expected?.subject?.accountId;
    demand(numeric(accountId) && evidence.subject.accountId === accountId && evidence.subject.profileRepositoryId === context.expected.subject.profileRepositoryId, 'SUBJECT_BINDING_MISMATCH', 'rejected');
    demand(dateValid(growthStartDate), 'GROWTH_WINDOW_REQUIRED');
    const cutoff = day(context.evaluation.startedAt);
    demand(dateValid(cutoff) && evidence.evaluation.activityCutoffExclusive === cutoff, 'ACTIVITY_WINDOW_MISMATCH', 'rejected');
    const lower = new Date(Date.parse(cutoff + 'T00:00:00Z') - 90 * 86400000).toISOString().slice(0, 10);
    const start = growthStartDate > lower ? growthStartDate : lower;
    demand(start <= cutoff, 'GROWTH_WINDOW_INVALID', 'rejected');
    const inWindow = value => typeof value === 'string' && day(value) >= start && day(value) < cutoff;
    const policies = resolvePolicies(evidence, policyRegistry);
    const scope = new Set(context.scope.repositoryIds);
    const resources = evidence.resources;
    demand(resources && ['repositories', 'pullRequests', 'commits', 'reviews', 'releases', 'issues', 'issueEvents', 'fileChanges'].every(name => Array.isArray(resources[name])), 'EVIDENCE_STRUCTURE_INVALID', 'rejected');
    const collections = new Map(evidence.collections.map(item => [item.ref, item]));
    demand(collections.size === evidence.collections.length, 'DUPLICATE_COLLECTION_REFERENCE', 'rejected');
    const all = Object.values(resources).flat(); const byRef = new Map(all.map(item => [item.ref, item]));
    demand(byRef.size === all.length, 'DUPLICATE_RESOURCE_REFERENCE', 'rejected');
    const sourceIdentities = new Set();
    for (const [kind, values] of Object.entries(resources)) for (const resource of values) if (resource.sourceId) {
      const key = canonicalize([kind, resource.repositoryId, resource.sourceId.type, resource.sourceId.value]);
      demand(!sourceIdentities.has(key), 'DUPLICATE_RESOURCE_IDENTITY', 'rejected'); sourceIdentities.add(key);
    }
    const repos = new Map(resources.repositories.map(repo => [repo.repositoryId, repo]));
    const activities = []; const reviewHistoryFacts = []; const identities = new Set();
    const captureCache = new Map();
    const capture = (collection, expected) => {
      const key = canonicalize([collection?.ref ?? null, expected]);
      if (!captureCache.has(key)) captureCache.set(key, closedCollection(collection, expected));
      return captureCache.get(key);
    };
    const identity = (kind, repositoryId, sourceId) => activityIdentity({ kind, accountId, repositoryId, sourceId });
    const append = (fact, sourceId) => {
      if (identities.has(fact.eventKey)) { exclude('DUPLICATE_SOURCE'); return; }
      identities.add(fact.eventKey); activities.push({ fact, sourceId: structuredClone(sourceId) });
    };
    const repositoryEligible = resource => {
      if (!scope.has(resource.repositoryId)) { exclude('OUTSIDE_SCOPE'); return false; }
      const repo = repos.get(resource.repositoryId);
      demand(repo, 'REPOSITORY_REFERENCE_MISSING', 'rejected');
      demand(source(repo) === repo.repositoryId, 'REPOSITORY_ID_MISMATCH', 'rejected');
      if (repo.visibility !== 'public') { exclude('NONPUBLIC_REPOSITORY'); return false; }
      demand(repo.owner?.status === 'identified', 'REPOSITORY_OWNER_UNAVAILABLE');
      return true;
    };
    const rootCapture = (resource, type) => {
      const matches = evidence.collections.filter(item => item.resourceType === type && item.target.kind === 'repository' && item.target.repositoryId === resource.repositoryId && item.purpose === 'activity' && item.window.kind === 'interval' && item.window.startAt === start + 'T00:00:00Z' && item.window.endAtExclusive === cutoff + 'T00:00:00Z');
      demand(matches.length === 1, 'REQUIRED_ACTIVITY_COLLECTION_MISSING', 'rejected');
      const refs = capture(matches[0], { type, repositoryId: resource.repositoryId, targetKind: 'repository', purpose: 'activity', windowKind: 'interval' });
      demand(refs.includes(resource.ref), 'ACTIVITY_MEMBERSHIP_MISMATCH', 'rejected');
    };
    const parentCapture = (ref, parent, type, purpose, windowKind = 'snapshot') => {
      const collection = collections.get(ref);
      const refs = capture(collection, { type, repositoryId: parent.repositoryId, targetKind: 'resource', parentRef: parent.ref, purpose, windowKind });
      return refs.map(item => { demand(byRef.has(item), 'RESOURCE_REFERENCE_MISSING', 'rejected'); return byRef.get(item); });
    };
    const familiesFromFiles = parent => {
      const files = parentCapture(parent.fileCollectionRef, parent, 'file_change', 'changes');
      const families = new Set();
      for (const file of files) {
        demand(file.parentRef === parent.ref && file.repositoryId === parent.repositoryId, 'FILE_PARENT_MISMATCH', 'rejected');
        const path = file.afterPath ?? file.beforePath;
        demand(typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..') && !/[\\\u0000]/u.test(path), 'FILE_PATH_UNSUPPORTED');
        if (policies.fileRules.exclusions.some(rule => rule.patterns.some(pattern => glob(pattern, path)))) { exclude('EXCLUDED_FILE'); continue; }
        demand(file.content?.mode === 'text_pair', 'FILE_CONTENT_PROOF_UNAVAILABLE');
        for (const side of ['before', 'after']) {
          const text = file.content[side + 'Text']; const oid = file[side + 'Oid'];
          demand(oid === null ? text === null : typeof text === 'string' && blobHash(text, oid) === oid, 'FILE_CONTENT_OID_MISMATCH', 'rejected');
        }
        const before = file.content.beforeText ?? ''; const after = file.content.afterText ?? '';
        demand(typeof before === 'string' && typeof after === 'string', 'FILE_CONTENT_PROOF_UNAVAILABLE');
        if (before.replace(/\s/gu, '') === after.replace(/\s/gu, '')) { exclude('WHITESPACE_ONLY_CHANGE'); continue; }
        let category = null;
        for (const current of policies.fileRules.precedence) if (policies.fileRules.categories.some(rule => rule.category === current && rule.patterns.some(pattern => glob(pattern, path)))) { category = current; break; }
        demand(category !== null, 'FILE_CATEGORY_UNSUPPORTED');
        if (category === 'source') throw new QualificationFailure('BUG_TEMPORAL_PROOF_UNSUPPORTED', 'hold', true);
        families.add({ deployment: 'operations', test: 'verification', documentation: 'knowledge' }[category]);
      }
      return ['knowledge', 'verification', 'operations'].filter(family => families.has(family));
    };
    for (const pr of resources.pullRequests) {
      if (pr.state !== 'MERGED') { exclude('PR_NOT_MERGED'); continue; }
      const actor = actorState(pr.author, accountId);
      if (actor === 'bot' || actor === 'other') { exclude(actor === 'bot' ? 'BOT_ACTOR' : 'OTHER_PR_AUTHOR'); continue; }
      if (!inWindow(pr.mergedAt)) { exclude('OUTSIDE_GROWTH_WINDOW'); continue; }
      if (!repositoryEligible(pr)) continue;
      demand(actor === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      demand(pr.baseRepositoryId === pr.repositoryId, 'PR_UPSTREAM_ATTRIBUTION_MISMATCH', 'rejected');
      rootCapture(pr, 'pull_request');
      const families = familiesFromFiles(pr);
      if (families.length === 0) { exclude('NO_QUALIFYING_CHANGE'); continue; }
      const id = source(pr);
      append({ eventKey: identity('merged_pr', pr.repositoryId, id), kind: 'merged_pr', repositoryId: pr.repositoryId, occurredAt: pr.mergedAt, families, prKey: identity('pull_request', pr.repositoryId, id), bugEvidenced: false }, pr.sourceId);
    }
    for (const commit of resources.commits) {
      const actor = actorState(commit.author, accountId);
      if (actor === 'bot' || actor === 'other') { exclude(actor === 'bot' ? 'BOT_ACTOR' : 'OTHER_COMMIT_AUTHOR'); continue; }
      if (!repositoryEligible(commit)) continue;
      if (repos.get(commit.repositoryId).fork) { exclude('FORK_DIRECT_COMMIT'); continue; }
      demand(actor === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      const associations = parentCapture(commit.pullRequestCollectionRef, commit, 'pr_association', 'relations');
      if (associations.some(pr => pr.state === 'MERGED')) { exclude('PR_REPRESENTED_COMMIT'); continue; }
      demand(commit.reflectedAt?.status === 'established', 'DEFAULT_BRANCH_REFLECTION_UNAVAILABLE', 'hold', true);
      if (!inWindow(commit.reflectedAt.value)) { exclude('OUTSIDE_GROWTH_WINDOW'); continue; }
      // v1 has a timestamp assertion, but no branch-transition/lifecycle basis.
      throw new QualificationFailure('DEFAULT_BRANCH_TEMPORAL_PROOF_UNSUPPORTED', 'hold', true);
    }
    const makeReviewFact = review => {
      const pr = byRef.get(review.pullRequestRef); demand(pr && resources.pullRequests.includes(pr), 'REVIEW_PR_REFERENCE_INVALID', 'rejected');
      demand(pr.repositoryId === review.repositoryId, 'REVIEW_PR_REPOSITORY_MISMATCH', 'rejected');
      const id = source(review); const prId = source(pr);
      demand(typeof review.reviewedCommitOid === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(review.reviewedCommitOid), 'REVIEWED_COMMIT_UNAVAILABLE');
      return { eventKey: identity('submitted_review', review.repositoryId, id), kind: 'submitted_review', repositoryId: review.repositoryId, occurredAt: review.submittedAt, families: ['guard'], prKey: identity('pull_request', review.repositoryId, prId), reviewedCommitKey: identity('reviewed_commit', review.repositoryId, { pullRequestId: prId, commitOid: review.reviewedCommitOid }) };
    };
    const seenReviewHistory = new Set();
    for (const review of resources.reviews) {
      if (review.state === 'PENDING') { exclude('PENDING_REVIEW'); continue; }
      const actor = actorState(review.reviewer, accountId);
      if (actor === 'bot' || actor === 'other') { exclude(actor === 'bot' ? 'BOT_ACTOR' : 'OTHER_REVIEWER'); continue; }
      if (!inWindow(review.submittedAt)) continue;
      if (!repositoryEligible(review)) continue;
      demand(actor === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      const pr = byRef.get(review.pullRequestRef); demand(pr && resources.pullRequests.includes(pr), 'REVIEW_PR_REFERENCE_INVALID', 'rejected');
      const author = actorState(pr.author, accountId);
      if (author === 'subject') { exclude('SELF_REVIEW'); continue; }
      if (author === 'bot') { exclude('BOT_PR_AUTHOR'); continue; }
      demand(author !== 'unknown', 'PR_AUTHOR_UNAVAILABLE');
      rootCapture(review, 'review');
      const historyCollections = evidence.collections.filter(item => item.resourceType === 'review' && item.target.kind === 'resource' && item.target.resourceRef === pr.ref && item.purpose === 'history');
      demand(historyCollections.length === 1, 'EARLIER_REVIEW_HISTORY_UNAVAILABLE');
      const history = historyCollections[0];
      demand(history.filters?.states === 'all', 'EARLIER_REVIEW_HISTORY_FILTER_MISMATCH', 'rejected');
      const refs = capture(history, { type: 'review', repositoryId: review.repositoryId, targetKind: 'resource', parentRef: pr.ref, purpose: 'history', windowKind: 'history', through: cutoff + 'T00:00:00Z' });
      demand(refs.includes(review.ref), 'REVIEW_HISTORY_MEMBERSHIP_MISMATCH', 'rejected');
      for (const historicalRef of refs) {
        const entry = byRef.get(historicalRef);
        demand(entry && resources.reviews.includes(entry) && entry.pullRequestRef === pr.ref, 'REVIEW_HISTORY_TARGET_MISMATCH', 'rejected');
        if (entry.state === 'PENDING') continue;
        const status = actorState(entry.reviewer, accountId);
        demand(status !== 'unknown', 'REVIEW_HISTORY_ACTOR_UNAVAILABLE');
        if (status !== 'subject') continue;
        demand(typeof entry.submittedAt === 'string' && day(entry.submittedAt) < cutoff, 'REVIEW_HISTORY_TIME_INVALID', 'rejected');
        const fact = makeReviewFact(entry);
        if (!seenReviewHistory.has(fact.eventKey)) { seenReviewHistory.add(fact.eventKey); reviewHistoryFacts.push(fact); }
      }
      append(makeReviewFact(review), review.sourceId);
    }
    for (const release of resources.releases) {
      const actor = actorState(release.author, accountId);
      if (actor === 'bot' || actor === 'other') { exclude(actor === 'bot' ? 'BOT_ACTOR' : 'OTHER_RELEASE_AUTHOR'); continue; }
      if (release.draft || release.prerelease) { exclude('DRAFT_OR_PRERELEASE'); continue; }
      if (!repositoryEligible(release)) continue;
      demand(actor === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      demand(release.firstPublication?.status === 'established', 'FIRST_PUBLICATION_UNAVAILABLE', 'hold', true);
      if (!inWindow(release.firstPublication.value.publishedAt)) { exclude('OUTSIDE_GROWTH_WINDOW'); continue; }
      // Current/publication snapshots cannot establish original lifecycle transitions.
      throw new QualificationFailure('RELEASE_LIFECYCLE_PROOF_UNSUPPORTED', 'hold', true);
    }
    const issueWork = new Map();
    for (const event of resources.issueEvents) {
      if (!inWindow(event.occurredAt)) continue;
      const actor = actorState(event.actor, accountId);
      if (actor === 'bot' || actor === 'other') { exclude(actor === 'bot' ? 'BOT_ACTOR' : 'OTHER_TRIAGE_ACTOR'); continue; }
      if (!repositoryEligible(event)) continue;
      demand(actor === 'subject', 'ACTOR_ATTRIBUTION_UNAVAILABLE');
      const issue = byRef.get(event.issueRef); demand(issue && resources.issues.includes(issue) && issue.repositoryId === event.repositoryId, 'TRIAGE_ISSUE_REFERENCE_INVALID', 'rejected');
      const author = actorState(issue.author, accountId);
      if (author === 'subject') { exclude('OWN_ISSUE_TRIAGE'); continue; }
      if (author === 'bot') { exclude('BOT_ISSUE_AUTHOR'); continue; }
      demand(author !== 'unknown', 'ISSUE_AUTHOR_UNAVAILABLE');
      rootCapture(event, 'issue_event');
      demand(['labeled', 'unlabeled', 'assigned', 'unassigned', 'milestoned', 'demilestoned'].includes(event.kind), 'TRIAGE_ACTION_UNSUPPORTED', 'rejected');
      const targetId = event.target.kind === 'assignee' ? event.target.accountId : source(event.target);
      const key = canonicalize([event.repositoryId, day(event.occurredAt), source(issue), event.target.kind, targetId]);
      const values = issueWork.get(key) ?? []; values.push({ event, issue }); issueWork.set(key, values);
    }
    const issueDays = new Map();
    for (const entries of issueWork.values()) {
      const kinds = new Set(entries.map(item => item.event.kind));
      if (entries.length > 1 || kinds.size > 1) { exclude('REPEATED_TRIAGE_TOGGLE'); continue; }
      const { event, issue } = entries[0]; const key = event.repositoryId + ':' + day(event.occurredAt);
      const issues = issueDays.get(key) ?? new Map();
      const id = source(issue); const old = issues.get(id);
      if (!old || event.occurredAt < old.event.occurredAt) issues.set(id, { event, issue });
      issueDays.set(key, issues);
    }
    for (const issues of issueDays.values()) {
      if (issues.size < 3) { exclude('TRIAGE_THRESHOLD_NOT_MET'); continue; }
      const entries = [...issues.values()].sort((a, b) => a.event.occurredAt < b.event.occurredAt ? -1 : a.event.occurredAt > b.event.occurredAt ? 1 : compareId(source(a.event), source(b.event)));
      const third = entries[2].event; const date = day(third.occurredAt);
      const issueKeys = [...issues.keys()].sort(compareId).map(id => identity('issue', third.repositoryId, id));
      append({ eventKey: identity('triage_day', third.repositoryId, date), kind: 'triage_day', repositoryId: third.repositoryId, occurredAt: third.occurredAt, families: ['operations'], issueKeys }, { type: 'opaque', value: date });
    }
    if (previousLedger) demand(previousLedger.owner?.accountId === accountId, 'PREVIOUS_OWNER_MISMATCH', 'rejected');
    const order = (a, b) => a.fact.eventKey < b.fact.eventKey ? -1 : a.fact.eventKey > b.fact.eventKey ? 1 : 0;
    activities.sort(order); reviewHistoryFacts.sort((a, b) => a.eventKey < b.eventKey ? -1 : a.eventKey > b.eventKey ? 1 : 0);
    return { decision: 'qualified', code: 'QUALIFIED_RELATIVE_TO_EVIDENCE', activities, reviewHistoryFacts, exclusions: orderedExclusions(), needsTemporalProof: [], sourceEligibility: 'passed_relative_to_evidence', coverageConsistency: 'not_checked', sourceAuthenticity: 'not_checked', progressionAuthorized: false };
  } catch (error) {
    const known = error instanceof QualificationFailure;
    return { decision: known ? error.decision : 'rejected', code: known ? error.code : 'EVIDENCE_INPUT_INVALID', activities: [], reviewHistoryFacts: [], exclusions: orderedExclusions(), needsTemporalProof: known && error.temporal ? [error.code] : [], sourceEligibility: 'not_checked', coverageConsistency: 'not_checked', sourceAuthenticity: 'not_checked', progressionAuthorized: false };
  }
}
