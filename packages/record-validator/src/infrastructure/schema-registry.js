import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';

const ROLES = ['common', 'state', 'ledger', 'status'];
const PREFIX = 'urn:commitkin:schemas:v1:';

/** Only bundled, compile-time schema URLs. No loadSchema/fetch or caller-supplied schema. */
export function createSchemaRegistry() {
  // Existing Draft 2020-12 conditional subschemas inherit types through their refs.
  // Disable only AJV's extra schema lint for that pattern, not input type validation.
  const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allErrors: false,
    coerceTypes: false, useDefaults: false, removeAdditional: false, validateFormats: true });
  addFormats(ajv, { mode: 'full' });
  for (const role of ROLES) {
    const schema = JSON.parse(readFileSync(new URL(`../../../../schemas/v1/${role}.schema.json`, import.meta.url), 'utf8'));
    if (schema.$id !== PREFIX + role || !ajv.validateSchema(schema)) throw new Error('BUNDLED_SCHEMA_INVALID');
    ajv.addSchema(schema);
  }
  // Compile at initialization. AJV cannot turn record strings into schemas or remote refs.
  for (const role of ROLES) ajv.getSchema(PREFIX + role);
  return Object.freeze({
    validate(role, input) { return ROLES.includes(role) && ajv.getSchema(PREFIX + role)(input); },
    validateReference(reference, input) {
      if (typeof reference !== 'string' || !ROLES.some(role => reference === PREFIX + role || reference.startsWith(PREFIX + role + '#/$defs/'))) return false;
      return Boolean(ajv.getSchema(reference)?.(input));
    },
  });
}
