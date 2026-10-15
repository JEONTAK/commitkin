import { visit, ParseErrorCode } from 'jsonc-parser';
import { ValidationFailure } from '../domain/failure.js';

export const LIMITS_BYTES = Object.freeze({ state: 1048576, ledger: 33554432, status: 65536 });
export const MAXIMUM_DEPTH = 16;

export function parseStrictJson(bytes, role) {
  const limit = LIMITS_BYTES[role];
  if (!limit || !(bytes instanceof Uint8Array)) throw new ValidationFailure('raw', 'INPUT_INVALID');
  if (bytes.byteLength > limit) throw new ValidationFailure('raw', 'INPUT_TOO_LARGE');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new ValidationFailure('raw', 'INVALID_UTF8'); }
  const containers = [];
  let invalid = false;
  let nonFinite = false;
  function enter(object) {
    if (containers.length >= MAXIMUM_DEPTH) throw new ValidationFailure('raw', 'INPUT_TOO_DEEP');
    containers.push(object ? new Set() : null);
  }
  visit(text, {
    onObjectBegin() { enter(true); },
    onArrayBegin() { enter(false); },
    onObjectProperty(key) {
      const keys = containers.at(-1);
      if (keys.has(key)) throw new ValidationFailure('parse', 'DUPLICATE_OBJECT_KEY');
      keys.add(key);
      if (!key.isWellFormed()) throw new ValidationFailure('parse', 'INVALID_UNICODE');
    },
    onObjectEnd() { containers.pop(); },
    onArrayEnd() { containers.pop(); },
    onLiteralValue(value) {
      if (typeof value === 'number' && !Number.isFinite(value)) nonFinite = true;
      if (typeof value === 'string' && !value.isWellFormed()) throw new ValidationFailure('parse', 'INVALID_UNICODE');
    },
    onError(code, offset, length) {
      invalid = true;
      // Bare NaN/Infinity are forbidden JSON, with the contract's specific diagnostic.
      if (code === ParseErrorCode.InvalidSymbol && /^(?:NaN|[-+]?Infinity)$/.test(text.slice(offset, offset + length))) nonFinite = true;
    },
  }, { disallowComments: true, allowTrailingComma: false, allowEmptyContent: false });
  if (nonFinite) throw new ValidationFailure('parse', 'JSON_NON_FINITE');
  if (invalid) throw new ValidationFailure('parse', 'JSON_SYNTAX');
  try { return JSON.parse(text); }
  catch { throw new ValidationFailure('parse', 'JSON_SYNTAX'); }
}
