import { createValidator } from '../../../record-validator/src/index.js';
import { parseStrictJson } from '../../../record-validator/src/infrastructure/strict-json.js';
import { createPreflightUseCase } from '../application/preflight.mjs';
import { createEvidenceSchemaRegistry } from './evidence-schema.mjs';

/** Local composition root: only bundled adapters, never caller-directed loaders. */
export function createPreflightValidator() {
  return createPreflightUseCase({
    parse: parseStrictJson,
    schema: createEvidenceSchemaRegistry(),
    validateRecords: createValidator(),
  });
}
