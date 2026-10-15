import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { qualifyEvidence, activityIdentity } from '../src/domain/evidence/qualify.mjs';
import { settleQualifiedActivities } from '../src/domain/growth/settlement.mjs';

const fixtureRoot = new URL('../../../test/fixtures/evidence/', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, fixtureRoot), 'utf8'));
const fixed = read('v1/fixture-context.json');
const registry = { fileRules: [fixed.policies.fileRules], bugLabels: [fixed.policies.bugLabels] };
function trueBlob(text, algorithm = 'sha1') { return createHash(algorithm).update('blob ' + Buffer.byteLength(text, 'utf8') + '\0').update(text, 'utf8').digest('hex'); }
function repairInMemoryBlobOids(evidence) {
  for (const file of evidence.resources.fileChanges) if (file.content.mode === 'text_pair') for (const side of ['before', 'after']) {
    const text = file.content[side + 'Text']; file[side + 'Oid'] = text === null ? null : trueBlob(text);
  }
  return evidence;
}
function request(id = 'ES-N04') {
  // New in-memory semantic cases. Preserved historical fixtures remain byte-identical;
  // their repeated fake blob OIDs are NOT asserted as semantically accepted.
  return { evidence: repairInMemoryBlobOids(read(`preflight-v1/normal/${id}/evidence.json`)), context: read(`preflight-v1/normal/${id}/context.json`), growthStartDate: '2026-07-17', policyRegistry: structuredClone(registry) };
}
function qualified(input) {
  const result = qualifyEvidence(input); assert.equal(result.decision, 'qualified', result.code);
  assert.equal(result.sourceAuthenticity, 'not_checked'); assert.equal(result.progressionAuthorized, false);
  assert.equal(result.coverageConsistency, 'not_checked'); return result;
}
function hold(input, code) { const result = qualifyEvidence(input); assert.equal(result.decision, 'hold'); assert.equal(result.code, code); assert.deepEqual(result.activities, []); return result; }
function rootCollection(input, type) { return input.evidence.collections.find(item => item.resourceType === type && item.target.kind === 'repository' && item.purpose === 'activity'); }

test('all fixed activity hash namespaces reproduce independent existing vectors', () => {
  for (const vector of fixed.identityVectors) assert.equal(activityIdentity(vector.input), vector.expectedHash, vector.name);
});

test('complete observed empty evidence is zero activities, not a failed collection', () => {
  const result = qualified(request('ES-N01')); assert.equal(result.activities.length, 0);
});

test('docs-only authored merged PR qualifies by author and meaningful full file content', () => {
  const result = qualified(request('ES-N02')); const activity = result.activities[0];
  assert.equal(activity.fact.kind, 'merged_pr'); assert.deepEqual(activity.fact.families, ['knowledge']);
  assert.equal(activity.fact.eventKey, fixed.identityVectors.find(item => item.name === 'prEventA').expectedHash);
  assert.equal(settleQualifiedActivities({ activities: result.activities }).totalXp, '40');
});

test('preserved structural PR fixture is not falsely accepted with synthetic repeated blob OIDs', () => {
  const input = request('ES-N02'); input.evidence = read('preflight-v1/normal/ES-N02/evidence.json');
  const result = qualifyEvidence(input); assert.equal(result.decision, 'rejected'); assert.equal(result.code, 'FILE_CONTENT_OID_MISMATCH');
});

test('exact UTF8 Git blob hashes support SHA1/SHA256 and detect fulltext tampering', () => {
  for (const algorithm of ['sha1', 'sha256']) {
    const input = request('ES-N02'); const file = input.evidence.resources.fileChanges[0];
    file.content.beforeText = '한글 😀 before\n'; file.content.afterText = '한글 😀 after\n';
    file.beforeOid = trueBlob(file.content.beforeText, algorithm); file.afterOid = trueBlob(file.content.afterText, algorithm);
    assert.equal(qualified(input).activities.length, 1);
    file.content.afterText += 'tampered';
    const result = qualifyEvidence(input); assert.equal(result.decision, 'rejected'); assert.equal(result.code, 'FILE_CONTENT_OID_MISMATCH');
  }
});

test('review of another author needs complete earlier PR history and preserves distinct identities', () => {
  const result = qualified(request()); const activity = result.activities[0];
  assert.equal(activity.fact.kind, 'submitted_review');
  assert.equal(activity.fact.eventKey, fixed.identityVectors.find(item => item.name === 'reviewEventA').expectedHash);
  assert.equal(activity.fact.prKey, fixed.identityVectors.find(item => item.name === 'reviewPrA').expectedHash);
  assert.equal(activity.fact.reviewedCommitKey, fixed.identityVectors.find(item => item.name === 'reviewCommitA').expectedHash);
  const growth = settleQualifiedActivities({ activities: result.activities, reviewHistoryFacts: result.reviewHistoryFacts });
  assert.equal(growth.totalXp, '25');
});

test('three distinct other-authored issues create one repo/date triage and20XP', () => {
  const result = qualified(request('ES-N06')); const activity = result.activities[0];
  assert.equal(activity.fact.kind, 'triage_day'); assert.equal(activity.fact.issueKeys.length, 3);
  assert.equal(activity.fact.eventKey, fixed.identityVectors.find(item => item.name === 'triageEvent').expectedHash);
  assert.equal(settleQualifiedActivities({ activities: result.activities }).totalXp, '20');
});

test('no registry supports arbitrary descriptor bodies, matching digest alone is insufficient', () => {
  const input = request(); input.policyRegistry = {};
  hold(input, 'POLICY_UNSUPPORTED');
});

test('inline policy body must equal fixed registry version, not just use known ID', () => {
  const input = request(); input.evidence.policies.fileRules.body.categories[0].patterns.push('**');
  const result = qualifyEvidence(input); assert.equal(result.decision, 'rejected'); assert.equal(result.code, 'POLICY_BODY_MISMATCH');
});

test('missing external growth start never inferred from capture or previous coverage', () => {
  const input = request(); delete input.growthStartDate;
  hold(input, 'GROWTH_WINDOW_REQUIRED');
});

test('self review and PENDING are conclusively excluded without unrelated earlier-history proof', () => {
  for (const kind of ['self', 'pending']) {
    const input = request(); input.evidence.collections = input.evidence.collections.filter(item => item.purpose !== 'history');
    if (kind === 'self') input.evidence.resources.pullRequests[0].author.accountId = '1001';
    else { input.evidence.resources.reviews[0].state = 'PENDING'; input.evidence.resources.reviews[0].submittedAt = null; }
    const result = qualified(input); assert.equal(result.activities.length, 0);
    assert.ok(result.exclusions[kind === 'self' ? 'SELF_REVIEW' : 'PENDING_REVIEW'] > 0);
  }
});

test('unknown reviewer attribution is not inactivity and holds the whole candidate', () => {
  const input = request(); input.evidence.resources.reviews[0].reviewer = { status: 'unavailable', reason: 'SOURCE_UNAVAILABLE' };
  hold(input, 'ACTOR_ATTRIBUTION_UNAVAILABLE');
});

test('unknown parent author cannot prove other-person review', () => {
  const input = request(); input.evidence.resources.pullRequests[0].author = { status: 'unavailable', reason: 'SOURCE_UNAVAILABLE' };
  hold(input, 'PR_AUTHOR_UNAVAILABLE');
});

test('bot-authored PRs/issues are not other-person targets', () => {
  const review = request(); review.evidence.resources.pullRequests[0].author.type = 'Bot';
  assert.equal(qualified(review).activities.length, 0);
  const triage = request('ES-N06'); triage.evidence.resources.issues[0].author.type = 'Bot';
  assert.equal(qualified(triage).activities.length, 0);
});

test('same provider resource under different local refs is rejected instead of first-wins', () => {
  const input = request(); const duplicate = structuredClone(input.evidence.resources.reviews[0]); duplicate.ref = 'duplicate-source-ref'; duplicate.submittedAt = '2026-10-14T12:00:00Z';
  input.evidence.resources.reviews.push(duplicate);
  const result = qualifyEvidence(input); assert.equal(result.decision, 'rejected'); assert.equal(result.code, 'DUPLICATE_RESOURCE_IDENTITY');
});

test('missing/truncated earlier history is not absence of earlier reviews', () => {
  const input = request(); const history = input.evidence.collections.find(item => item.resourceType === 'review' && item.purpose === 'history');
  history.state = 'not_collected'; history.pages = []; history.reason = 'INSUFFICIENT_HISTORY';
  hold(input, 'REQUIRED_COLLECTION_INCOMPLETE');
  const missing = request(); missing.evidence.collections = missing.evidence.collections.filter(item => !(item.resourceType === 'review' && item.purpose === 'history'));
  hold(missing, 'EARLIER_REVIEW_HISTORY_UNAVAILABLE');
});

test('advertised missing next page and mismatched cursor remain insufficient versus contradictory', () => {
  const input = request(); const history = input.evidence.collections.find(item => item.resourceType === 'review' && item.purpose === 'history');
  history.pages[0].response.pagination = { state: 'more', nextCursor: 'private-cursor' };
  hold(input, 'REQUIRED_COLLECTION_INCOMPLETE');
  const second = structuredClone(history.pages[0]); second.sequence = 2; second.ref = 'other-page'; second.requestCursor = 'wrong-cursor'; second.response.pagination = { state: 'end', nextCursor: null };
  history.pages.push(second);
  const result = qualifyEvidence(input); assert.equal(result.decision, 'rejected'); assert.equal(result.code, 'PAGE_CHAIN_CONTRADICTION');
  assert.equal(JSON.stringify(result).includes('private-cursor'), false);
});

test('prior history before growth start suppresses first-review XP without backfilling old growth', () => {
  const input = request(); const history = input.evidence.collections.find(item => item.resourceType === 'review' && item.purpose === 'history');
  const old = structuredClone(input.evidence.resources.reviews[0]); old.ref = 'review-before-growth'; old.sourceId.value = '1'; old.submittedAt = '2026-01-01T00:00:00Z'; old.reviewedCommitOid = 'b'.repeat(40); old.captureRefs = [history.pages[0].ref];
  input.evidence.resources.reviews.push(old); history.pages[0].response.itemRefs.push(old.ref); history.pages[0].response.total.value = 2;
  const result = qualified(input);
  assert.equal(result.activities.length, 1); assert.equal(result.reviewHistoryFacts.length, 2);
  const growth = settleQualifiedActivities({ activities: result.activities, reviewHistoryFacts: result.reviewHistoryFacts });
  assert.equal(growth.totalXp, '10'); assert.equal(growth.days.length, 1); assert.equal(growth.facts.length, 1);
});

test('repeated reviewed commit from prior history cannot create a new valid day', () => {
  const input = request(); const history = input.evidence.collections.find(item => item.resourceType === 'review' && item.purpose === 'history');
  const old = structuredClone(input.evidence.resources.reviews[0]); old.ref = 'prior-same-commit'; old.sourceId.value = '1'; old.submittedAt = '2026-01-01T00:00:00Z'; old.captureRefs = [history.pages[0].ref];
  input.evidence.resources.reviews.push(old); history.pages[0].response.itemRefs.push(old.ref); history.pages[0].response.total.value = 2;
  const result = qualified(input); const growth = settleQualifiedActivities({ activities: result.activities, reviewHistoryFacts: result.reviewHistoryFacts });
  assert.equal(growth.totalXp, '0'); assert.equal(growth.days.length, 0);
});

test('DISMISSED submitted review retains original activity, never grants new event XP', () => {
  const input = request(); input.evidence.resources.reviews[0].state = 'DISMISSED';
  const result = qualified(input); assert.equal(result.activities.length, 1);
  assert.equal(settleQualifiedActivities({ activities: result.activities, reviewHistoryFacts: result.reviewHistoryFacts }).totalXp, '25');
});

test('current labels and established flag do not prove historical bug or no-bug classification', () => {
  const input = request('ES-N02'); input.evidence.resources.fileChanges[0].beforePath = 'fixture-src/main.js'; input.evidence.resources.fileChanges[0].afterPath = 'fixture-src/main.js';
  const result = hold(input, 'BUG_TEMPORAL_PROOF_UNSUPPORTED');
  assert.deepEqual(result.needsTemporalProof, ['BUG_TEMPORAL_PROOF_UNSUPPORTED']);
});

test('full file-list and content are necessary for an otherwise eligible authored PR', () => {
  const input = request('ES-N02'); input.evidence.resources.fileChanges[0].content = { mode: 'unavailable', reason: 'CONTENT_UNAVAILABLE' };
  hold(input, 'FILE_CONTENT_PROOF_UNAVAILABLE');
  const truncated = request('ES-N02'); const files = truncated.evidence.collections.find(item => item.resourceType === 'file_change'); files.pages[0].response.truncation = 'reported';
  hold(truncated, 'REQUIRED_COLLECTION_INCOMPLETE');
});

test('nonmerged/bot PR does not demand unavailable content or labels', () => {
  for (const kind of ['open', 'bot']) {
    const input = request('ES-N02'); input.evidence.resources.fileChanges[0].content = { mode: 'unavailable', reason: 'CONTENT_UNAVAILABLE' };
    if (kind === 'open') { input.evidence.resources.pullRequests[0].state = 'OPEN'; input.evidence.resources.pullRequests[0].mergedAt = null; }
    else input.evidence.resources.pullRequests[0].author.type = 'Bot';
    const result = qualified(input); assert.equal(result.activities.length, 0);
  }
});

test('unknown file is not automatically source, whitespace-only and fixed exclusions are no contribution', () => {
  const unknown = request('ES-N02'); unknown.evidence.resources.fileChanges[0].beforePath = 'unknown.bin'; unknown.evidence.resources.fileChanges[0].afterPath = 'unknown.bin';
  hold(unknown, 'FILE_CATEGORY_UNSUPPORTED');
  const whitespace = request('ES-N02'); whitespace.evidence.resources.fileChanges[0].content = { mode: 'text_pair', beforeText: 'a b\n', afterText: ' a\tb  \n' };
  repairInMemoryBlobOids(whitespace.evidence);
  assert.equal(qualified(whitespace).activities.length, 0);
  const excluded = request('ES-N02'); excluded.evidence.resources.fileChanges[0].beforePath = 'fixture-card/card.png'; excluded.evidence.resources.fileChanges[0].afterPath = 'fixture-card/card.png'; excluded.evidence.resources.fileChanges[0].content = { mode: 'unavailable', reason: 'CONTENT_UNAVAILABLE' };
  assert.equal(qualified(excluded).activities.length, 0);
});

test('fork-origin authored PR is attributed once to public upstream, not rejected for different head repo', () => {
  const input = request('ES-N02'); input.evidence.resources.pullRequests[0].headRepositoryId = '9999';
  const result = qualified(input); assert.equal(result.activities.length, 1); assert.equal(result.activities[0].fact.repositoryId, '9001');
});

test('known fork direct contribution and associated merged PR are excluded before missing temporal proof', () => {
  const fork = request('ES-N03'); fork.evidence.resources.repositories[0].fork = true;
  assert.equal(qualified(fork).activities.length, 0);
  const represented = request('ES-N03');
  const parent = request('ES-N02').evidence.resources.pullRequests[0]; parent.author.accountId = '2002';
  represented.evidence.resources.pullRequests.push(parent);
  const association = represented.evidence.collections.find(item => item.resourceType === 'pr_association'); association.pages[0].response.itemRefs.push(parent.ref); association.pages[0].response.total.value = 1;
  const result = qualified(represented); assert.equal(result.activities.length, 0); assert.equal(result.exclusions.PR_REPRESENTED_COMMIT, 1);
});

test('established direct reflection and release publication flags cannot fabricate missing lifecycle basis', () => {
  hold(request('ES-N03'), 'DEFAULT_BRANCH_TEMPORAL_PROOF_UNSUPPORTED');
  hold(request('ES-N05'), 'RELEASE_LIFECYCLE_PROOF_UNSUPPORTED');
});

test('draft/prerelease/bot releases exclude conclusively without unavailable first-publication basis', () => {
  for (const state of ['draft', 'prerelease', 'bot']) {
    const input = request('ES-N05'); const release = input.evidence.resources.releases[0]; release.firstPublication = { status: 'unavailable', reason: 'INSUFFICIENT_HISTORY', captureRefs: [] };
    if (state === 'bot') release.author.type = 'Bot'; else release[state] = true;
    assert.equal(qualified(input).activities.length, 0);
  }
});

test('triage own issue or repeated target toggles cannot satisfy three-issue threshold', () => {
  const own = request('ES-N06'); own.evidence.resources.issues[0].author.accountId = '1001';
  assert.equal(qualified(own).activities.length, 0);
  const toggled = request('ES-N06'); const event = structuredClone(toggled.evidence.resources.issueEvents[0]); event.ref = 'reverted-triage'; event.sourceId.value = '999'; event.kind = 'unlabeled';
  toggled.evidence.resources.issueEvents.push(event); const capture = rootCollection(toggled, 'issue_event'); capture.pages[0].response.itemRefs.push(event.ref); capture.pages[0].response.total.value += 1;
  const result = qualified(toggled); assert.equal(result.activities.length, 0); assert.equal(result.exclusions.REPEATED_TRIAGE_TOGGLE, 1);
});

test('unknown triage issue author is insufficient evidence rather than zero work', () => {
  const input = request('ES-N06'); input.evidence.resources.issues[0].author = { status: 'unavailable', reason: 'SOURCE_UNAVAILABLE' };
  hold(input, 'ISSUE_AUTHOR_UNAVAILABLE');
});

test('private/out-of-scope activity is excluded without demand for irrelevant actor proof', () => {
  const privateInput = request(); privateInput.evidence.resources.repositories[0].visibility = 'private';
  assert.equal(qualified(privateInput).activities.length, 0);
  const outside = request(); outside.context.scope.repositoryIds = [];
  assert.equal(qualified(outside).activities.length, 0);
});

test('failed qualification never returns partial eligible activities or raw diagnostics', () => {
  const input = request('ES-N02'); const missing = request('ES-N05').evidence.resources.releases[0];
  input.evidence.resources.releases.push(missing);
  const result = hold(input, 'RELEASE_LIFECYCLE_PROOF_UNSUPPORTED');
  assert.equal(JSON.stringify(result).includes('beforeText'), false); assert.equal(JSON.stringify(result).includes('captureRefs'), false);
});

test('permutations and frozen inputs preserve exact outputs and source artifacts', () => {
  const input = request('ES-N06'); const original = structuredClone(input); const baseline = qualified(input);
  const permuted = structuredClone(input); for (const values of Object.values(permuted.evidence.resources)) values.reverse(); permuted.evidence.collections.reverse();
  assert.deepEqual(qualified(permuted), baseline);
  const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };
  assert.deepEqual(qualified(freeze(input)), baseline); assert.deepEqual(input, original);
});

test('page array permutation follows explicit sequence without input mutation', () => {
  const input = request('ES-N02'); const collection = rootCollection(input, 'pull_request');
  const first = collection.pages[0]; const second = structuredClone(first);
  first.response.itemRefs = []; first.response.pagination = { state: 'more', nextCursor: 'next-page' };
  second.ref = 'page-root-pull-request-2'; second.sequence = 2; second.requestCursor = 'next-page';
  collection.pages.push(second);
  input.evidence.resources.pullRequests[0].captureRefs = [second.ref];
  const baseline = qualified(input);
  collection.pages.reverse();
  const before = structuredClone(input);
  assert.deepEqual(qualified(input), baseline);
  assert.deepEqual(input, before);
  assert.equal(collection.pages[0].sequence, 2);
});
