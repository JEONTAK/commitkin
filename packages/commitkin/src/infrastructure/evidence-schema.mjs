import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import formats from 'ajv-formats';

/** Fixed local URNs only. No caller-directed schema resolution or mutation. */
export function createEvidenceSchemaRegistry() {
  const ajv = new Ajv({
    strict: true, strictTypes: false, strictRequired: false, allErrors: false,
    coerceTypes: false, useDefaults: false, removeAdditional: false,
  });
  formats(ajv, { mode: 'full' });
  const root = new URL('../../../../schemas/', import.meta.url);
  const paths = ['v1/common.schema.json', ...[
    'common', 'resources', 'collections', 'evidence', 'context', 'preflight',
  ].map(name => `evidence/v1/${name}.schema.json`)];
  for (const path of paths) {
    const schema = JSON.parse(readFileSync(new URL(path, root), 'utf8'));
    if (!ajv.validateSchema(schema)) throw new Error('BUNDLED_SCHEMA_INVALID');
    ajv.addSchema(schema);
  }
  const validators = Object.fromEntries(['context', 'evidence', 'preflight'].map(name =>
    [name, ajv.getSchema(`urn:commitkin:schemas:evidence:v1:${name}`)]));
  return Object.freeze({ validate: (kind, input) => Boolean(Object.hasOwn(validators, kind) && validators[kind](input)) });
}
