import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { digest } from '../src/domain/hash.js';

export const FIXTURES = fileURLToPath(new URL('../../../test/fixtures/records/v1/', import.meta.url));
export const PACKAGE = fileURLToPath(new URL('../', import.meta.url));
export const CONTEXT = Object.freeze({ expectedOwner: { accountId: '1001', profileRepositoryId: '9001' }, now: '2026-10-15T02:00:00Z', operation: 'normal' });
export function json(relative) { return JSON.parse(readFileSync(join(FIXTURES, relative), 'utf8')); }
export function inputs(relative = 'valid/ready-40xp') {
  return Object.fromEntries(['state', 'ledger', 'status'].map(role => {
    const path = join(FIXTURES, relative, role + '.json');
    return [role, existsSync(path) ? readFileSync(path) : null];
  }));
}
export function objects(relative = 'valid/ready-40xp') {
  return Object.fromEntries(Object.entries(inputs(relative)).map(([role, bytes]) => [role, bytes ? JSON.parse(bytes) : null]));
}
export function encoded(bundle, repairHash = true) {
  const copy = structuredClone(bundle);
  if (repairHash) copy.state.integrity.ledgerHash = digest(copy.ledger);
  return Object.fromEntries(Object.entries(copy).map(([role, value]) => [role, value === null ? null : Buffer.from(JSON.stringify(value))]));
}
export function next(previous = objects(), date = '2026-10-16') {
  const candidate = structuredClone(previous);
  candidate.state.recordRevision++;
  candidate.ledger.recordRevision++;
  candidate.status.recordRevision++;
  candidate.state.evaluation.lastSuccessfulRevision = candidate.state.recordRevision;
  candidate.status.lastSuccessfulRevision = candidate.state.recordRevision;
  candidate.state.evaluation.evaluatedAt = date + 'T01:00:00Z';
  candidate.state.evaluation.activityCutoffExclusive = date;
  candidate.state.observationClock.lastNormalEvaluationOn = date;
  candidate.status.changedAt = date + 'T01:00:00Z';
  return candidate;
}
