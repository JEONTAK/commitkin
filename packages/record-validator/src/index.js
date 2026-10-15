import { createRecordValidator } from './application/validate-records.js';
import { parseStrictJson } from './infrastructure/strict-json.js';
import { createSchemaRegistry } from './infrastructure/schema-registry.js';

/** Local package composition; domain/application modules have no filesystem access. */
export function createValidator() {
  return createRecordValidator({ parse: parseStrictJson, schema: createSchemaRegistry() });
}
