import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPreflightValidator } from '../src/infrastructure/preflight-factory.mjs';
import { createEvidenceSchemaRegistry } from '../src/infrastructure/evidence-schema.mjs';

const ROOT = new URL('../../../test/fixtures/evidence/preflight-v1/', import.meta.url);
const read = ref => JSON.parse(readFileSync(new URL(ref, ROOT), 'utf8'));
const bytes = value => Buffer.from(JSON.stringify(value));
const manifest = read('cases.json').cases;
const validate = createPreflightValidator();
const schema = createEvidenceSchemaRegistry();
function bundle(ref) {
  if (ref.includes('#')) {
    const [file, pointer] = ref.split('#');
    let value = read(file);
    for (const key of pointer.split('/').filter(Boolean)) value = value[key];
    return Object.fromEntries(Object.entries(value).map(([role, data]) => [role, bytes(data)]));
  }
  return Object.fromEntries(['state', 'ledger', 'status'].map(role => [role, readFileSync(new URL(`${ref}/${role}.json`, ROOT))]));
}
function inputs(caseId = 'ES-N02') {
  const c = manifest.find(value => value.caseId === caseId);
  return {
    context: readFileSync(new URL(c.contextFixture, ROOT)), evidence: readFileSync(new URL(c.evidenceFixture, ROOT)),
    candidate: bundle(c.baseRecordFixture), previous: c.previousRecordFixture ? bundle(c.previousRecordFixture) : null,
  };
}
function mutate(caseId, change) {
  const input = inputs(caseId), context = JSON.parse(input.context), evidence = JSON.parse(input.evidence);
  change(context, evidence, input);
  return { ...input, context: bytes(context), evidence: bytes(evidence) };
}
const fingerprints = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');

for (const c of manifest) test(`preflight fixture ${c.caseId}: ${c.expectedPreflight.decision}`, () => {
  const input = inputs(c.caseId), before = fingerprints(input), result = validate(input);
  assert.equal(result.decision, c.expectedPreflight.decision);
  // Independent owner expectations deliberately retain the older record gate's precedence.
  assert.equal(result.stage, c.caseId === 'CTX-E01' ? 'record' : c.expectedPreflight.stage);
  assert.equal(result.progressionAuthorized, false);
  assert.equal(result.sourceAuthenticity, 'not_checked');
  for (const check of ['sourceEligibility', 'coverageConsistency', 'rewardOrder', 'rewardAllocation', 'sourceAuthenticity', 'policyCatalogSemantics']) assert.ok(result.notChecked.includes(check));
  assert.equal(fingerprints(input), before);
  assert.deepEqual(validate(input), result);
});

test('schema registry has only fixed roles, without coercion or caller schema retrieval', () => {
  const value = JSON.parse(inputs().context), before = JSON.stringify(value);
  assert.equal(schema.validate('context', value), true);
  assert.equal(schema.validate('https://example.invalid/schema', value), false);
  for (const role of ['toString', '__proto__', 'constructor', 'hasOwnProperty']) assert.equal(schema.validate(role, value), false);
  value.contextVersion = '1';
  assert.equal(schema.validate('context', value), false);
  assert.equal(value.contextVersion, '1');
  assert.equal(typeof JSON.parse(before).contextVersion, 'number');
});

for (const c of read('context-probes.json').cases) test(`context schema probe ${c.caseId}`, () => {
  assert.equal(schema.validate('context', c.input), c.expected === 'SCHEMA_ACCEPT');
});

for (const c of read('raw-cases.json').cases) test(`strict context raw ${c.caseId}`, () => {
  const input = inputs();
  input.context = c.encodingDescriptor ? Buffer.from(read(c.fixture).bytes, 'hex') : readFileSync(new URL(c.fixture, ROOT));
  const result = validate(input);
  assert.equal(result.decision, 'rejected');
  assert.equal(result.code, c.expectedRaw);
  assert.equal(result.stage, 'input');
});

for (const c of read('boundary-cases.json').cases) test(`context raw boundary ${c.caseId}`, () => {
  const input = inputs();
  if (c.bytes) {
    const n = c.bytes - Buffer.byteLength('{"padding":""}');
    const fill = c.encoding === 'multibyte' ? '한'.repeat(Math.floor(n / 3)) + 'x'.repeat(n % 3) : 'x'.repeat(n);
    input.context = Buffer.from('{"padding":"' + fill + '"}');
    assert.equal(input.context.byteLength, c.bytes);
  } else input.context = Buffer.from('['.repeat(c.depth) + '0' + ']'.repeat(c.depth));
  assert.equal(validate(input).code, c.expectedRaw === 'RAW_ACCEPT' ? 'CONTEXT_SCHEMA_INVALID' : c.expectedRaw);
});

const injected = [
  ['wrong evidence subject', 'ES-N02', (_c, e) => { e.subject.accountId = '2002'; }, 'SUBJECT_BINDING_MISMATCH'],
  ['wrong actual candidate digest', 'ES-N02', (_c, e) => { e.binding.candidateLedgerHash = 'v1:sha256:' + '0'.repeat(64); }, 'CANDIDATE_LEDGER_BINDING_MISMATCH'],
  ['unsorted effective IDs', 'CTX-N03', c => { c.scope.repositoryIds.reverse(); }, 'SCOPE_NOT_NORMALIZED'],
  ['unsorted normalized settings', 'ES-N02', c => { c.normalizedSettings.repositories.additional = ['z/r', 'a/r']; }, 'SETTINGS_NOT_NORMALIZED'],
  ['wrong previous mode with actual prior bundle', 'ES-N10', c => { c.comparison.mode = 'snapshot_only'; }, 'PREVIOUS_MODE_MISMATCH'],
  ['inline body digest mismatch', 'ES-N02', (_c, e) => { e.policies.fileRules.body.version = '1'; e.policies.fileRules.body.categories[0].patterns.push('new-fixture/**'); }, 'POLICY_DIGEST_MISMATCH'],
  ['duplicate cross-namespace local reference', 'ES-N02', (_c, e) => { e.collections[0].pages[0].ref = e.collections[0].ref; }, 'LOCAL_REFERENCE_COLLISION'],
  ['duplicate source identity', 'ES-N02', (_c, e) => { const r = structuredClone(e.resources.pullRequests[0]); r.ref = 'pr-copy'; e.resources.pullRequests.push(r); }, 'DUPLICATE_RESOURCE_IDENTITY'],
  ['unknown capture reference', 'ES-N02', (_c, e) => { e.resources.pullRequests[0].captureRefs = ['page-missing']; }, 'CAPTURE_REFERENCE_MISSING'],
  ['wrong provenance page', 'ES-N02', (_c, e) => { e.resources.pullRequests[0].captureRefs = ['page-root-review']; }, 'CAPTURE_PROVENANCE_MISMATCH'],
  ['wrong file collection kind', 'ES-N02', (_c, e) => { e.resources.pullRequests[0].fileCollectionRef = 'root-repository'; }, 'COLLECTION_PARENT_MISMATCH'],
  ['missing review PR parent', 'ES-N04', (_c, e) => { e.resources.reviews[0].pullRequestRef = 'pr-missing'; }, 'RESOURCE_REFERENCE_MISSING'],
  ['unknown returned resource', 'ES-N02', (_c, e) => { e.collections.find(x => x.ref === 'root-review').pages[0].response.itemRefs = ['missing-review']; }, 'RESOURCE_REFERENCE_MISSING'],
  ['wrong returned kind', 'ES-N02', (_c, e) => { e.collections.find(x => x.ref === 'root-review').pages[0].response.itemRefs = ['repo-9001']; }, 'RESOURCE_REFERENCE_KIND'],
  ['capture past completion', 'ES-N02', (_c, e) => { e.collections[0].pages[0].capturedAt = '2026-10-15T01:00:01Z'; }, 'CAPTURE_AFTER_COMPLETION'],
  ['snapshot past completion', 'ES-N02', (_c, e) => { e.collections[0].window.observedAt = '2026-10-15T01:00:01Z'; }, 'SNAPSHOT_AFTER_COMPLETION'],
  ['history after frozen cutoff', 'ES-N02', (_c, e) => { e.collections.find(x => x.purpose === 'history').window.throughExclusive = '2026-10-16T00:00:00Z'; }, 'HISTORY_AFTER_CUTOFF'],
  ['first request cursor not null', 'ES-N02', (_c, e) => { e.collections.find(x => x.ref === 'root-review').pages[0].requestCursor = 'not-first'; }, 'FIRST_CURSOR_NOT_NULL'],
  ['noncontiguous page sequence', 'ES-N02', (_c, e) => { e.collections.find(x => x.ref === 'root-review').pages[0].sequence = 2; }, 'PAGE_SEQUENCE_INVALID'],
  ['cursor cycle', 'REG-N03', (_c, e) => { const x = e.collections.find(x => x.ref === 'root-pull-request'); x.pages[1].response.pagination = { state: 'more', nextCursor: x.pages[1].requestCursor }; }, 'CURSOR_CYCLE'],
  ['duplicate across capture pages', 'REG-N03', (_c, e) => { const x = e.collections.find(x => x.ref === 'root-pull-request'); x.pages[1].response.itemRefs.push(x.pages[0].response.itemRefs[0]); }, 'DUPLICATE_PAGE_ITEM'],
  ['different comparable totals', 'REG-N03', (_c, e) => { e.collections.find(x => x.ref === 'root-pull-request').pages[1].response.total.value += 1; }, 'COMPARABLE_TOTAL_CONFLICT'],
  ['duplicate logical request', 'ES-N02', (_c, e) => { const x = structuredClone(e.collections.find(x => x.ref === 'root-review')); x.ref = 'duplicate-review-request'; x.pages[0].ref = 'page-duplicate-review'; e.collections.push(x); }, 'DUPLICATE_LOGICAL_REQUEST'],
];
for (const [name, caseId, change, code] of injected) test(`preflight rejects ${name}`, () => {
  const result = validate(mutate(caseId, change));
  assert.equal(result.decision, 'rejected');
  assert.equal(result.code, code);
});

test('missing totals are not zero; explicit terminal pages can pass their narrow closure check', () => {
  const input = mutate('REG-N03', (_c, e) => { for (const x of e.collections) for (const p of x.pages) if (p.response.status === 'success') p.response.total = { status: 'not_provided' }; });
  assert.equal(validate(input).decision, 'preflight_passed');
});

test('truncated enumeration with larger total holds rather than inventing a count contradiction', () => {
  const input = mutate('ES-N02', (_c, e) => { const p = e.collections.find(x => x.ref === 'root-pull-request').pages[0]; p.response.total.value += 5; p.response.truncation = 'reported'; });
  assert.equal(validate(input).decision, 'hold');
});

test('required failure cannot hide a later contradictory capture', () => {
  const input = mutate('CAT-E03', (_c, e) => { e.collections.find(x => x.ref === 'root-pull-request').pages[0].response.total.value = 0; });
  const result = validate(input);
  assert.equal(result.decision, 'rejected');
  assert.equal(result.code, 'COMPARABLE_TOTAL_MISMATCH');
});

test('evidence arrays and page array ordering do not change passing reports', () => {
  const input = inputs('REG-N03'), expected = validate(input), e = JSON.parse(input.evidence);
  e.collections.reverse(); for (const c of e.collections) c.pages.reverse();
  for (const values of Object.values(e.resources)) values.reverse();
  input.evidence = bytes(e);
  assert.deepEqual(validate(input), expected);
});

test('record errors keep original sanitized reports and never request data mutation', () => {
  const input = inputs(); input.candidate.status = Buffer.from('{');
  const result = validate(input);
  assert.equal(result.decision, 'hold');
  assert.equal(result.code, 'RECORD_REPAIR_REQUIRED');
  assert.equal(result.recordReport.statusRepairAllowed, true);
  assert.equal(result.progressionAuthorized, false);
});

test('unsupported record interpretation is held, never silently downgraded', () => {
  const input = inputs(), state = JSON.parse(input.candidate.state); state.schemaVersion = 2; input.candidate.state = bytes(state);
  const result = validate(input);
  assert.equal(result.decision, 'hold'); assert.equal(result.recordReport.code, 'UPDATE_REQUIRED');
});

test('previous snapshot corruption cannot be treated as snapshot_only', () => {
  const input = inputs('ES-N10'); input.previous.ledger = Buffer.from('{');
  const result = validate(input);
  assert.equal(result.decision, 'rejected'); assert.equal(result.stage, 'record');
});

test('untrusted directives and diagnostics cannot trigger retrieval or leak inputs', () => {
  const input = inputs(); input.remoteSchema = 'https://example.invalid/private-marker';
  const result = validate(input), output = JSON.stringify(result);
  assert.equal(result.code, 'INPUT_ARGUMENTS_INVALID');
  assert.ok(!output.includes('private-marker')); assert.ok(!output.includes('stack'));
});

test('input role types are explicit; no default evidence/context is inferred', () => {
  for (const value of [undefined, null, {}, [], 'raw']) {
    const input = inputs(); input.context = value;
    assert.equal(validate(input).code, 'INPUT_INVALID');
  }
});

for (const [role, field, value] of [
  ['evidence', 'evidenceVersion', 2], ['evidence', 'rulesetVersion', '2.0.0'],
  ['evidence', 'adapter', { id: 'github.enterprise', version: '1' }],
  ['evidence', 'adapter', { id: 'github.com', version: '2' }],
  ['context', 'expected', { subject: { accountId: '1001', profileRepositoryId: '9001' }, evidenceVersion: 2, rulesetVersion: '1.0.0', adapter: { id: 'github.com', version: '1' } }],
]) test(`unsupported interpreter ${role}/${field} is held before current-schema checks`, () => {
  const input = mutate('ES-N02', (c, e) => { (role === 'context' ? c : e)[field] = value; });
  const result = validate(input);
  assert.equal(result.stage, 'compatibility'); assert.equal(result.code, 'COMPATIBLE_TOOL_REQUIRED'); assert.equal(result.decision, 'hold');
});

test('evidence has its own 32 MiB boundary, not the smaller context limit', () => {
  const input = inputs(), limit = 33_554_432;
  input.evidence = Buffer.alloc(limit, 0x20); input.evidence.write('{}');
  assert.equal(validate(input).code, 'EVIDENCE_SCHEMA_INVALID');
  input.evidence = Buffer.alloc(limit + 1, 0x20); input.evidence.write('{}');
  assert.equal(validate(input).code, 'INPUT_TOO_LARGE');
});

test('successful empty detail cannot stand in for a required referenced PR detail', () => {
  const input = mutate('ES-N02', (_c, e) => {
    const collection = e.collections.find(x => x.ref === 'pr-17-detail');
    collection.pages[0].response.itemRefs = []; collection.pages[0].response.total.value = 0;
    e.resources.pullRequests[0].captureRefs = e.resources.pullRequests[0].captureRefs.filter(ref => ref !== collection.pages[0].ref);
  });
  const result = validate(input);
  assert.equal(result.decision, 'rejected'); assert.equal(result.code, 'DETAIL_RESPONSE_MISSING');
});
