const REPOSITORY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\/[a-z0-9._-]+$/;
const ID = /^[1-9][0-9]*$/;
const fail = code => { throw new TypeError(code); };

export function normalizeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'repositories,version' || input.version !== 1) fail('SETTINGS_INVALID');
  const repositories = input.repositories;
  if (!repositories || typeof repositories !== 'object' || Object.keys(repositories).sort().join(',') !== 'additional,exclude') fail('SETTINGS_INVALID');
  const output = { version: 1, repositories: {} };
  for (const kind of ['additional', 'exclude']) {
    if (!Array.isArray(repositories[kind]) || repositories[kind].length > 200) fail('SETTINGS_INVALID');
    const names = repositories[kind].map(value => {
      if (typeof value !== 'string' || value.length > 256 || !REPOSITORY.test(value.toLowerCase())) fail('SETTINGS_INVALID');
      return value.toLowerCase();
    });
    output.repositories[kind] = [...new Set(names)].sort();
  }
  return output;
}

/** Inputs are acquisition-port results, not evidence suppliers' eligibility flags. */
export function effectiveRepositories({ automatic = [], additional = [], tracked = [], excludedNames = [], excludedIds = [] }) {
  const names = new Set(excludedNames.map(name => String(name).toLowerCase()));
  const ids = new Set(excludedIds);
  const byId = new Map();
  for (const [origin, rows] of [['automatic', automatic], ['additional', additional], ['tracked', tracked]]) {
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || !ID.test(row.id) || typeof row.name !== 'string' || !REPOSITORY.test(row.name.toLowerCase())) fail('REPOSITORY_RESOLUTION_INVALID');
      if (names.has(row.name.toLowerCase()) || ids.has(row.id)) continue;
      if (row.availability !== 'available') return { decision: 'hold', code: 'REPOSITORY_UNAVAILABLE', repositories: [] };
      if (row.visibility !== 'public') {
        if (!['private', 'internal'].includes(row.visibility)) return { decision: 'hold', code: 'REPOSITORY_VISIBILITY_UNKNOWN', repositories: [] };
        continue;
      }
      const prior = byId.get(row.id);
      if (prior && (prior.ownerId !== row.ownerId || prior.fork !== row.fork)) return { decision: 'hold', code: 'REPOSITORY_RESOLUTION_CONFLICT', repositories: [] };
      byId.set(row.id, { ...row, discoveredVia: [...new Set([...(prior?.discoveredVia ?? []), origin === 'additional' ? 'additional' : 'automatic'])] });
    }
  }
  return { decision: 'resolved', code: 'SCOPE_RESOLVED', repositories: [...byId.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1) };
}

export function chooseFaction({ savedFaction = null, requestedFaction = null, firstInstallVerified = false }) {
  if (savedFaction) {
    if (!['bloomguard', 'ashbound'].includes(savedFaction)) fail('FACTION_INVALID');
    if (requestedFaction && requestedFaction !== savedFaction) return { decision: 'hold', code: 'FACTION_PERMANENT' };
    return { decision: 'retained', faction: savedFaction };
  }
  if (!firstInstallVerified) return { decision: 'hold', code: 'RECOVERY_REQUIRED' };
  if (!['bloomguard', 'ashbound'].includes(requestedFaction)) return { decision: 'hold', code: 'FACTION_CONFIRMATION_REQUIRED' };
  return { decision: 'confirmed', faction: requestedFaction };
}
