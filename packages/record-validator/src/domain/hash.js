import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { requireValid } from './failure.js';

export function canonicalJson(value) {
  // RFC 8785 rejects lone UTF-16 surrogates rather than silently replacing them.
  function inspect(item) {
    if (typeof item === 'string') requireValid(item.isWellFormed(), 'INVALID_UNICODE', 'parse');
    if (typeof item === 'number') requireValid(Number.isFinite(item), 'JSON_NON_FINITE', 'parse');
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) { inspect(key); inspect(child); }
    }
  }
  inspect(value);
  return canonicalize(value);
}

export function digest(value) {
  return 'v1:sha256:' + createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function equivalent(left, right) { return canonicalJson(left) === canonicalJson(right); }

export function scopeDigest(scope) {
  const repositoryIds = [...new Set(scope.repositoryIds)].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0);
  return digest({ rulesetVersion: scope.rulesetVersion, analysisConfigHash: scope.analysisConfigHash, repositoryIds });
}
