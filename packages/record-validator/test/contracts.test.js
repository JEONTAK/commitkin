import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createValidator } from '../src/index.js';
import { createSchemaRegistry } from '../src/infrastructure/schema-registry.js';
import { parseStrictJson, LIMITS_BYTES } from '../src/infrastructure/strict-json.js';
import { canonicalJson, digest } from '../src/domain/hash.js';
import { FIXTURES, CONTEXT, json, inputs, objects, encoded } from './helpers.js';

const validate = createValidator();
const schemas = createSchemaRegistry();
const manifest = json('cases.json');
function caseInputs(entry) {
  const result = inputs(entry.baseFixture);
  for (const [role, path] of Object.entries(entry.overrides)) result[role] = readFileSync(join(FIXTURES, path));
  if (entry.rawInput) {
    const descriptor = json(entry.rawInput.descriptor);
    result[entry.rawInput.role] = Buffer.from(descriptor.hex, 'hex');
  }
  return result;
}

for (const entry of manifest.cases) {
  test('bundle contract: ' + entry.caseId, () => {
    const raw = caseInputs(entry);
    const before = Object.fromEntries(Object.entries(raw).map(([key, bytes]) => [key, bytes?.toString('hex')]));
    const report = validate(raw, CONTEXT);
    assert.equal(report.progressionAuthorized, false);
    if (entry.expected.stage === 'contract-example') {
      // Legacy oracle cases require source context/allocator, intentionally outside phase 1.
      assert.ok(report.notChecked.includes('source_identity_and_reward_order'));
      assert.ok(report.notChecked.includes('source_eligibility_and_completeness'));
      assert.notEqual(report.stage, 'internal');
      assert.equal(report.code, entry.caseId === 'wrong-cap-allocation' ? 'CREDITED_XP_INVALID' : 'ACCEPT');
    } else {
      assert.equal(report.code, entry.expected.code, JSON.stringify(report));
      assert.equal(report.stage, entry.expected.stage);
      assert.equal(report.decision, entry.expected.decision);
    }
    assert.deepEqual(Object.fromEntries(Object.entries(raw).map(([key, bytes]) => [key, bytes?.toString('hex')])), before);
  });
}

test('reverse bundle replay is deterministic', () => {
  const forward = manifest.cases.map(entry => validate(caseInputs(entry), CONTEXT));
  const reverse = [...manifest.cases].reverse().map(entry => validate(caseInputs(entry), CONTEXT)).reverse();
  assert.deepEqual(reverse, forward);
});

for (const entry of json('schema-probes.json').cases) {
  test('schema probe: ' + entry.caseId, () => {
    const before = structuredClone(entry.input);
    assert.equal(schemas.validateReference(entry.schemaRef, entry.input), entry.expected === 'SCHEMA_ACCEPT');
    assert.deepEqual(entry.input, before);
  });
}
for (const vector of json('hash-vectors.json').vectors) {
  test('independent fixed hash: ' + vector.id, () => {
    assert.equal(canonicalJson(vector.input), vector.canonical);
    assert.equal(digest(vector.input), vector.expectedHash);
  });
}
for (const entry of json('boundary-cases.json').cases) {
  test('boundary: ' + entry.caseId, () => {
    if (entry.kind === 'byte-limit') {
      const bytes = Buffer.from('{}' + ' '.repeat(LIMITS_BYTES[entry.role] + entry.delta - 2));
      if (entry.delta > 0) assert.throws(() => parseStrictJson(bytes, entry.role), { code: entry.expectedCode });
      else assert.deepEqual(parseStrictJson(bytes, entry.role), {});
    } else if (entry.kind === 'depth') {
      const bytes = Buffer.from('['.repeat(entry.depth) + '0' + ']'.repeat(entry.depth));
      if (entry.depth > 16) assert.throws(() => parseStrictJson(bytes, entry.role), { code: entry.expectedCode });
      else assert.doesNotThrow(() => parseStrictJson(bytes, entry.role));
    } else if (entry.kind === 'day-total') {
      assert.equal(schemas.validateReference('urn:commitkin:schemas:v1:ledger#/$defs/day', { ...objects().ledger.days[0], xp: { ...objects().ledger.days[0].xp, total: entry.total } }), entry.expectedCode === 'SCHEMA_ACCEPT');
    } else if (entry.kind === 'date') {
      assert.equal(schemas.validateReference('urn:commitkin:schemas:v1:common#/$defs/utcDate', entry.value), entry.expectedCode === 'SCHEMA_ACCEPT');
    } else if (entry.kind === 'timestamp') {
      assert.equal(schemas.validateReference('urn:commitkin:schemas:v1:common#/$defs/utcTimestamp', entry.value), entry.expectedCode === 'SCHEMA_ACCEPT');
    } else if (entry.kind === 'unknown-ref') {
      assert.equal(schemas.validateReference('https://example.invalid/schema', {}), false);
    } else assert.fail('Unrecognized boundary case: ' + entry.kind);
  });
}

for (const [name, text, code] of [
  ['escaped duplicate', '{"a":1,"\\u0061":2}', 'DUPLICATE_OBJECT_KEY'],
  ['nested duplicate', '{"x":{"a":1,"a":2}}', 'DUPLICATE_OBJECT_KEY'],
  ['trailing comma', '{"a":1,}', 'JSON_SYNTAX'],
  ['BOM', '\uFEFF{}', 'JSON_SYNTAX'],
  ['overflow', '{"n":1e999}', 'JSON_NON_FINITE'],
  ['lone surrogate', '{"s":"\\ud800"}', 'INVALID_UNICODE'],
  ['lone key surrogate', '{"\\udfff":0}', 'INVALID_UNICODE'],
]) test('strict parser: ' + name, () => assert.throws(() => parseStrictJson(Buffer.from(text), 'state'), { code }));

test('separate objects may reuse keys; null/arrays/scalars parse but are not records', () => {
  assert.deepEqual(parseStrictJson(Buffer.from('[{"a":1},{"a":2}]'), 'state'), [{ a: 1 }, { a: 2 }]);
  for (const text of ['null', '[]', '1']) {
    const raw = inputs(); raw.state = Buffer.from(text);
    assert.notEqual(validate(raw, CONTEXT).code, 'ACCEPT');
  }
  assert.throws(() => parseStrictJson('not bytes', 'state'), { code: 'INPUT_INVALID' });
  assert.throws(() => parseStrictJson(Buffer.from('{}'), 'other'), { code: 'INPUT_INVALID' });
});
test('unknown schemas/remote refs are not fetched', () => {
  for (const ref of ['https://example.invalid/schema', 'file:///secret', 'urn:commitkin:schemas:v1:evil']) assert.equal(schemas.validateReference(ref, {}), false);
  assert.equal(schemas.validate('evil', {}), false);
});
test('unpaired Unicode is rejected before canonical hashing', () => {
  assert.throws(() => digest({ a: '\ud800' }), { code: 'INVALID_UNICODE' });
  assert.throws(() => digest({ a: Infinity }), { code: 'JSON_NON_FINITE' });
});
test('missing/corrupt primary records never initialize a character', () => {
  for (const role of ['state', 'ledger']) {
    const raw = inputs(); raw[role] = null;
    assert.equal(validate(raw, CONTEXT).code, 'RECORD_MISSING');
    assert.equal(validate(raw, CONTEXT).progressionAuthorized, false);
  }
});
test('status-only repair guidance requires valid compatible primary pair', () => {
  const raw = inputs(); raw.status = Buffer.from('{');
  assert.equal(validate(raw, CONTEXT).statusRepairAllowed, true);
  assert.equal(validate(raw, CONTEXT).code, 'JSON_SYNTAX');
  raw.state = Buffer.from('{');
  assert.equal(validate(raw, CONTEXT).statusRepairAllowed, false);
  const newer = objects(); newer.status.schemaVersion = 2;
  assert.equal(validate(encoded(newer), CONTEXT).code, 'UPDATE_REQUIRED');
  assert.equal(validate(encoded(newer), CONTEXT).statusRepairAllowed, false);
});
