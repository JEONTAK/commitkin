const NAME = /^[a-z0-9](?:[a-z0-9-]{0,38})\/[a-z0-9_.-]{1,100}$/i;
const ID = /^[1-9][0-9]*$/;
function stableId(value) { return typeof value === 'string' && ID.test(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null; }
function normalizeName(value) { return typeof value === 'string' && NAME.test(value) && !value.endsWith('/.') && !value.endsWith('/..') ? value.toLowerCase() : null; }
function metadata(value, via) {
  const id = stableId(value?.id); const name = normalizeName(value?.full_name); const owner = stableId(value?.owner?.id);
  const visibility = value?.visibility ?? (value?.private === false ? 'public' : value?.private === true ? 'private' : null);
  if (!id || !name || !owner || !['public', 'private', 'internal'].includes(visibility) || typeof value?.fork !== 'boolean' || typeof value?.archived !== 'boolean' || visibility === 'public' && value.private === true) return null;
  return { id, name, ownerAccountId: owner, visibility, fork: value.fork, archived: value.archived, discoveredVia: [via] };
}

/** Discovery is bounded and non-exhaustive; never interprets a 404 as private/deleted. */
export async function discoverRepositories({ client, login, additional = [], exclude = [], tracked = [] }) {
  if (!client || typeof client.get !== 'function' || typeof client.paginate !== 'function' || typeof login !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,38})$/i.test(login) || !Array.isArray(additional) || !Array.isArray(exclude) || !Array.isArray(tracked) || ![...additional, ...exclude].every(normalizeName) || !tracked.every(item => stableId(item?.id) && (item.discoveredVia === undefined || Array.isArray(item.discoveredVia) && item.discoveredVia.length >= 1 && item.discoveredVia.length <= 2 && item.discoveredVia.every(via => ['automatic', 'additional'].includes(via))))) return { decision: 'hold', code: 'DISCOVERY_INPUT_INVALID', repositories: [], tracked: [], codes: ['DISCOVERY_INPUT_INVALID'], limitations: ['KNOWN_SCOPE_ONLY'] };
  const found = new Map(); const blocked = new Set(); const codes = new Set();
  const excludedNames = new Set(exclude.map(normalizeName));
  const trackedIds = new Set(tracked.map(item => stableId(item.id)));
  const excludedIds = new Set();
  function merge(value, via) {
    const item = metadata(value, via);
    if (!item) { codes.add('REPOSITORY_METADATA_INVALID'); return; }
    if (found.has(item.id)) item.discoveredVia = [...new Set([...found.get(item.id).discoveredVia, via])].sort();
    found.set(item.id, item);
  }
  // Explicit exclusions apply to names and verified stable IDs, including aliases.
  for (const name of excludedNames) {
    const response = await client.get('/repos/' + name);
    if (response.ok) {
      const item = metadata(response.data, 'automatic');
      if (item) excludedIds.add(item.id); else codes.add('REPOSITORY_METADATA_INVALID');
    } else if (response.code !== 'REPOSITORY_UNAVAILABLE') codes.add(response.code);
  }
  const owned = await client.paginate(`/users/${login}/repos?type=owner&sort=full_name&per_page=100`, { maxPages: 100 });
  if (!owned.ok) codes.add(owned.code);
  for (const item of owned.items ?? []) merge(item, 'automatic');
  const events = await client.paginate(`/users/${login}/events/public?per_page=100`, { maxPages: 3 });
  if (!events.ok && events.code !== 'PAGE_LIMIT_REACHED') codes.add(events.code);
  const eventIds = new Set();
  for (const event of events.items ?? []) {
    const id = stableId(event?.repo?.id);
    const name = normalizeName(event?.repo?.name);
    if (!id || !name) { codes.add('DISCOVERY_EVENT_INVALID'); continue; }
    if (!excludedIds.has(id) && !excludedNames.has(name)) eventIds.add(id);
  }
  const added = new Set(additional.map(normalizeName));
  for (const name of added) {
    if (excludedNames.has(name)) continue;
    const response = await client.get('/repos/' + name);
    if (!response.ok) { codes.add(response.code); continue; }
    merge(response.data, 'additional');
  }
  for (const id of new Set([...trackedIds, ...eventIds])) {
    if (excludedIds.has(id)) continue;
    const response = await client.get('/repositories/' + id);
    if (!response.ok) { codes.add(response.code); blocked.add(id); continue; }
    const item = metadata(response.data, 'automatic');
    if (!item || item.id !== id) { codes.add('REPOSITORY_ID_MISMATCH'); blocked.add(id); continue; }
    const previousVia = tracked.find(entry => stableId(entry.id) === id)?.discoveredVia ?? ['automatic'];
    for (const via of previousVia) if (['automatic', 'additional'].includes(via)) merge(response.data, via);
  }
  const result = [];
  const continuity = [];
  for (const item of found.values()) {
    const excluded = excludedIds.has(item.id) || excludedNames.has(item.name);
    const tracking = excluded ? 'excluded' : item.visibility !== 'public' ? 'outside_public_scope' : blocked.has(item.id) ? 'unavailable' : 'active';
    continuity.push({ id: item.id, tracking, discoveredVia: item.discoveredVia });
    if (tracking === 'active') result.push(item);
  }
  for (const old of tracked) if (!found.has(stableId(old.id))) continuity.push({ id: stableId(old.id), tracking: excludedIds.has(stableId(old.id)) ? 'excluded' : 'unavailable', discoveredVia: old.discoveredVia ?? ['automatic'] });
  const compare = (left, right) => BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0;
  return { decision: codes.size ? 'hold' : 'ready', code: codes.size ? 'DISCOVERY_PARTIAL' : 'DISCOVERED_KNOWN_SCOPE', repositories: result.sort(compare), tracked: continuity.sort(compare), codes: [...codes].sort(), limitations: ['KNOWN_SCOPE_ONLY', 'PUBLIC_EVENTS_LIMITED_TO_RECENT_30_DAYS_AND_300_EVENTS', 'OTHER_PUBLIC_REPOSITORIES_MAY_BE_MISSING'] };
}
