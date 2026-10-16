import { createHash } from 'node:crypto';
import { parseStrictJson } from '../../../../record-validator/src/infrastructure/strict-json.js';
import { digest } from '../../../../record-validator/src/domain/hash.js';
import { compareTimestamps } from '../../domain/character/activity.mjs';
import { isCommitkinStorageRepository } from './storage.mjs';

const RECORDS = Object.freeze({ state: '.commitkin/state.json', ledger: '.commitkin/ledger.json', status: '.commitkin/status.json' });
const LIMITS = Object.freeze({ '.commitkin/state.json': 1048576, '.commitkin/ledger.json': 33554432, '.commitkin/status.json': 65536, 'README.md': 1048576, '.github/commitkin.yml': 65536 });
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]*$/;
const HASH = /^v1:sha256:[a-f0-9]{64}$/;
const MAX_PENDING_STATES = 100;
const PENDING_INVARIANTS = Object.freeze(['schemaVersion', 'recordType', 'rulesetVersion', 'owner', 'faction', 'growth', 'class', 'traits', 'observationClock', 'achievements', 'evaluation']);
function exact(value, keys) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function identifier(value) { return typeof value === 'string' && ID.test(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null; }
function validTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const time = new Date(value);
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 19) === value.slice(0, 19);
}
function hold(code) { return { decision: 'hold', code, firstInstallVerified: false, initialAssignmentVerified: false, progressionAuthorized: false, publicationAuthorized: false }; }
function validContext(value) {
  return value && value.serverUrl === 'https://github.com' && value.apiUrl === 'https://api.github.com' &&
    ['workflow_dispatch', 'schedule'].includes(value.eventName) && typeof value.repository === 'string' &&
    /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9_.-]{1,100}$/i.test(value.repository) &&
    ['repositoryId', 'ownerAccountId', 'actorAccountId'].every(key => typeof value[key] === 'string' && ID.test(value[key])) &&
    typeof value.ref === 'string' && typeof value.sha === 'string' && SHA.test(value.sha) && validTimestamp(value.startedAt);
}
function decodeFile(data, expectedSha, expectedSize, path) {
  const limit = LIMITS[path];
  if (!data || data.sha !== expectedSha || data.size !== expectedSize || data.encoding !== 'base64' || typeof data.content !== 'string') throw new TypeError('INSTALLATION_CONTENT_INVALID');
  if (data.content.length > 4 * Math.ceil(limit / 3) + 2 * Math.ceil(limit / 45) + 128 || !/^[A-Za-z0-9+/=\r\n]*$/.test(data.content)) throw new TypeError('INSTALLATION_BASE64_INVALID');
  const encoded = data.content.replace(/[\r\n]/g, '');
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new TypeError('INSTALLATION_BASE64_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > limit || bytes.length !== expectedSize || bytes.toString('base64') !== encoded) throw new TypeError('INSTALLATION_CONTENT_SIZE_INVALID');
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (actual !== expectedSha) throw new TypeError('INSTALLATION_BLOB_MISMATCH');
  try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new TypeError('INSTALLATION_UTF8_INVALID'); }
  return new Uint8Array(bytes);
}

function supportedPendingState(state, current) {
  // The current matched bundle has already passed the bundled record validator.
  // Exact invariant equality therefore reuses its supported closed v1 shape;
  // only explicitly checked metadata may differ in historical pending states.
  return exact(state, [...PENDING_INVARIANTS, 'recordRevision', 'settings', 'integrity']) &&
    state.schemaVersion === 1 && state.recordType === 'state' && state.rulesetVersion === '1.0.0' &&
    Number.isSafeInteger(state.recordRevision) && state.recordRevision >= 1 &&
    state.growth?.phase === 'pending' && state.growth.totalXp === null && state.class === null && state.evaluation === null &&
    Array.isArray(state.achievements) && state.achievements.length === 0 &&
    ['habit', 'activity'].every(slot => state.traits?.[slot]?.currentId === null && state.traits[slot].pending === null) &&
    exact(state.observationClock, ['lastNormalEvaluationOn', 'classLastCountedOn', 'habitLastCountedOn', 'activityLastCountedOn']) && Object.values(state.observationClock).every(value => value === null) &&
    exact(state.settings, ['filePreviouslyUsed', 'lastAcceptedHash']) && typeof state.settings.filePreviouslyUsed === 'boolean' && HASH.test(state.settings.lastAcceptedHash ?? '') &&
    exact(state.integrity, ['ledgerHash']) && HASH.test(state.integrity.ledgerHash ?? '') &&
    PENDING_INVARIANTS.every(field => digest(state[field]) === digest(current[field]));
}

async function verifyPendingOrigin({ client, root, repositoryId, expectedHead, current, currentBlob, maxHistoryPages }) {
  const path = RECORDS.state;
  const history = await client.paginate(`${root}/commits?` + new URLSearchParams({ path, sha: expectedHead, per_page: '100' }), { maxPages: Math.min(maxHistoryPages, 2), repositoryId });
  if (!history.ok || history.complete !== true || !Array.isArray(history.items)) return { ok: false, code: 'INSTALLATION_HISTORY_INCOMPLETE' };
  if (history.items.length === 0) return { ok: false, code: 'RECOVERY_REQUIRED' };
  if (history.items.length > MAX_PENDING_STATES) return { ok: false, code: 'INSTALLATION_HISTORY_INCOMPLETE' };
  const commitShas = history.items.map(item => item?.sha);
  if (commitShas.some(sha => !SHA.test(sha ?? '')) || new Set(commitShas).size !== commitShas.length) return { ok: false, code: 'RECOVERY_REQUIRED' };
  let visited = 0; let previousSemanticHash = null; let previousRevision = null;
  for (const sha of commitShas) {
    visited += 1;
    const commit = await client.get(`${root}/git/commits/${sha}`);
    if (!commit.ok || commit.data?.sha !== sha || !SHA.test(commit.data?.tree?.sha ?? '')) return { ok: false, code: 'RECOVERY_REQUIRED' };
    const tree = await client.get(`${root}/git/trees/${commit.data.tree.sha}?recursive=1`);
    if (!tree.ok || tree.data?.sha !== commit.data.tree.sha || tree.data.truncated !== false || !Array.isArray(tree.data.tree)) return { ok: false, code: 'RECOVERY_REQUIRED' };
    const paths = new Set(); let entry = null;
    for (const candidate of tree.data.tree) {
      if (!candidate || typeof candidate.path !== 'string' || paths.has(candidate.path) ||
        candidate.path === '.commitkin' && (candidate.type !== 'tree' || candidate.mode !== '040000')) return { ok: false, code: 'RECOVERY_REQUIRED' };
      paths.add(candidate.path);
      if (candidate.path === path) entry = candidate;
    }
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || !SHA.test(entry.sha ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > LIMITS[path]) return { ok: false, code: 'RECOVERY_REQUIRED' };
    const response = await client.get(`${root}/contents/${path}?` + new URLSearchParams({ ref: sha }));
    const file = response.data;
    if (!response.ok || file?.type !== 'file' || file.path !== path || file.sha !== entry.sha || file.size !== entry.size) return { ok: false, code: 'RECOVERY_REQUIRED' };
    // The latest path-changing commit need not be HEAD (README-only commits may
    // follow it), but its actual blob must still be the exact captured HEAD blob.
    if (visited === 1 && file.sha !== currentBlob) return { ok: false, code: 'RECOVERY_REQUIRED' };
    let data = file;
    if (file.encoding === 'none') {
      const blob = await client.get(`${root}/git/blobs/${file.sha}`);
      if (!blob.ok) return { ok: false, code: 'RECOVERY_REQUIRED' };
      data = blob.data;
    }
    let state; let semanticHash;
    try {
      state = parseStrictJson(decodeFile(data, file.sha, file.size, path), 'state');
      if (!supportedPendingState(state, current)) return { ok: false, code: 'RECOVERY_REQUIRED' };
      semanticHash = digest(state);
    } catch { return { ok: false, code: 'RECOVERY_REQUIRED' }; }
    if (visited === 1 && semanticHash !== digest(current)) return { ok: false, code: 'RECOVERY_REQUIRED' };
    if (previousSemanticHash !== null && semanticHash !== previousSemanticHash && state.recordRevision >= previousRevision) return { ok: false, code: 'RECOVERY_REQUIRED' };
    previousSemanticHash = semanticHash; previousRevision = state.recordRevision;
  }
  return previousRevision === 1 ? { ok: true } : { ok: false, code: 'RECOVERY_REQUIRED' };
}

function unassignedAdventurer(state) {
  return state.growth.phase === 'ready' && state.class?.id === 'adventurer' && state.class.lastChangedOn === null && state.class.pending === null &&
    Array.isArray(state.class.history) && state.class.history.length === 0 && state.observationClock.classLastCountedOn === null &&
    !state.achievements.some(series => series.seriesId === 'class-codex' && series.earned.length > 0);
}

/** A current empty class is a reason to investigate, never proof of first use. */
async function verifyAdventurerOrigin({ client, root, repositoryId, expectedHead, current, currentEntries, currentRecords, maxHistoryPages, validateRecords, now }) {
  if (!unassignedAdventurer(current)) return { ok: false, code: 'RECOVERY_REQUIRED' };
  const history = await client.paginate(`${root}/commits?` + new URLSearchParams({ path: RECORDS.state, sha: expectedHead, per_page: '100' }), { maxPages: Math.min(maxHistoryPages, 2), repositoryId });
  if (!history.ok || history.complete !== true || !Array.isArray(history.items) || history.items.length > MAX_PENDING_STATES) return { ok: false, code: 'INSTALLATION_HISTORY_INCOMPLETE' };
  if (history.items.length === 0) return { ok: false, code: 'RECOVERY_REQUIRED' };
  const shas = history.items.map(item => item?.sha);
  if (shas.some(sha => !SHA.test(sha ?? '')) || new Set(shas).size !== shas.length) return { ok: false, code: 'RECOVERY_REQUIRED' };
  // Reuse only already verified immutable bytes, keyed by role and Git blob OID.
  // In particular, the common latest-history-SHA===HEAD needs no extra GETs.
  const byteCache = new Map(Object.entries(RECORDS).map(([role, path]) => [role + ':' + currentEntries.get(path).sha, currentRecords[role]]));
  let newer = null; let newerHash = null; let pendingSeen = false; let oldest = null;
  for (const sha of shas) {
    let entries = currentEntries;
    if (sha !== expectedHead) {
      const commit = await client.get(`${root}/git/commits/${sha}`);
      if (!commit.ok || commit.data?.sha !== sha || !SHA.test(commit.data?.tree?.sha ?? '')) return { ok: false, code: 'RECOVERY_REQUIRED' };
      const tree = await client.get(`${root}/git/trees/${commit.data.tree.sha}?recursive=1`);
      if (!tree.ok || tree.data?.sha !== commit.data.tree.sha || tree.data.truncated !== false || !Array.isArray(tree.data.tree)) return { ok: false, code: 'RECOVERY_REQUIRED' };
      entries = new Map();
      for (const entry of tree.data.tree) {
        if (!entry || typeof entry.path !== 'string' || entries.has(entry.path) || entry.path === '.commitkin' && (entry.type !== 'tree' || entry.mode !== '040000')) return { ok: false, code: 'RECOVERY_REQUIRED' };
        entries.set(entry.path, entry);
      }
    }
    const records = {};
    for (const [role, path] of Object.entries(RECORDS)) {
      const entry = entries.get(path);
      if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || !SHA.test(entry.sha ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > LIMITS[path]) return { ok: false, code: 'RECOVERY_REQUIRED' };
      const key = role + ':' + entry.sha;
      if (!byteCache.has(key)) {
        const content = await client.get(`${root}/contents/${path}?` + new URLSearchParams({ ref: sha }));
        if (!content.ok || content.data?.type !== 'file' || content.data.path !== path || content.data.sha !== entry.sha || content.data.size !== entry.size) return { ok: false, code: 'RECOVERY_REQUIRED' };
        let data = content.data;
        if (data.encoding === 'none') {
          const blob = await client.get(`${root}/git/blobs/${entry.sha}`);
          if (!blob.ok) return { ok: false, code: 'RECOVERY_REQUIRED' };
          data = blob.data;
        }
        try { byteCache.set(key, decodeFile(data, entry.sha, entry.size, path)); }
        catch { return { ok: false, code: 'RECOVERY_REQUIRED' }; }
      }
      records[role] = byteCache.get(key);
      if (records[role].byteLength !== entry.size) return { ok: false, code: 'RECOVERY_REQUIRED' };
    }
    const checked = validateRecords(records, { expectedOwner: current.owner, now, operation: 'normal' });
    if (!checked?.recordValid || !['ACCEPT', 'ANALYSIS_PENDING', 'RETAIN_SUCCESS'].includes(checked.code)) return { ok: false, code: 'RECOVERY_REQUIRED' };
    let state;
    try { state = parseStrictJson(records.state, 'state'); } catch { return { ok: false, code: 'RECOVERY_REQUIRED' }; }
    if (state.schemaVersion !== 1 || state.rulesetVersion !== '1.0.0' || digest(state.owner) !== digest(current.owner) || digest(state.faction) !== digest(current.faction) || state.growth.startDate !== current.growth.startDate) return { ok: false, code: 'RECOVERY_REQUIRED' };
    if (state.growth.phase === 'ready') {
      if (pendingSeen || !unassignedAdventurer(state)) return { ok: false, code: 'RECOVERY_REQUIRED' };
    } else pendingSeen = true;
    const semanticHash = digest(state);
    if (newer === null && (entries.get(RECORDS.state).sha !== currentEntries.get(RECORDS.state).sha || semanticHash !== digest(current))) return { ok: false, code: 'RECOVERY_REQUIRED' };
    if (newer !== null) {
      if (semanticHash !== newerHash && state.recordRevision >= newer.recordRevision || state.settings.filePreviouslyUsed && !newer.settings.filePreviouslyUsed) return { ok: false, code: 'RECOVERY_REQUIRED' };
      if (state.growth.phase === 'ready' && newer.growth.phase === 'ready' && (BigInt(state.growth.totalXp) > BigInt(newer.growth.totalXp) || compareTimestamps(state.evaluation.evaluatedAt, newer.evaluation.evaluatedAt) > 0)) return { ok: false, code: 'RECOVERY_REQUIRED' };
    }
    oldest = state; newer = state; newerHash = semanticHash;
  }
  // A successful first run prepares pending revision 1 in memory and persists
  // ready revision 2 directly. It must not require a nonexistent pending commit.
  const pendingOrigin = oldest.growth.phase === 'pending' && oldest.recordRevision === 1;
  const readyOrigin = oldest.growth.phase === 'ready' && oldest.recordRevision === 2 && oldest.evaluation.lastSuccessfulRevision === 2 && oldest.evaluation.activityCutoffExclusive === oldest.faction.confirmedAt.slice(0, 10);
  return pendingOrigin || readyOrigin ? { ok: true } : { ok: false, code: 'RECOVERY_REQUIRED' };
}

/**
 * Acquire immutable-head setup inputs through a supplied GET-only client.
 * The workflow context is provided by the trusted runner, never read from files
 * or inferred from submitted records. No network globals, writes or resets.
 */
export async function acquireInstallation({ client, workflowContext, initialSelection = null, validateRecords, maxHistoryPages = 10, deferReadyClassOrigin = false }) {
  try {
    if (!client || typeof client.get !== 'function' || typeof client.paginate !== 'function' || !validContext(workflowContext) || !Number.isSafeInteger(maxHistoryPages) || maxHistoryPages < 1 || maxHistoryPages > 100 || typeof deferReadyClassOrigin !== 'boolean') return hold('INSTALLATION_CONTEXT_INVALID');
    const context = { ...workflowContext };
    const selection = initialSelection === null ? null : structuredClone(initialSelection);
    const repository = context.repository;
    const root = '/repos/' + repository;
    const metadata = await client.get(root);
    if (!metadata.ok) return hold('INSTALLATION_METADATA_UNAVAILABLE');
    const actual = structuredClone(metadata.data);
    const parts = repository.toLowerCase().split('/');
    if (!actual || identifier(actual.id) !== context.repositoryId || identifier(actual.owner?.id) !== context.ownerAccountId || actual.owner?.type !== 'User' || actual.private !== false || actual.visibility && actual.visibility !== 'public' ||
      typeof actual.owner?.login !== 'string' || typeof actual.name !== 'string' || actual.owner.login.toLowerCase() !== parts[0] || actual.name.toLowerCase() !== parts[1] ||
      typeof actual.full_name !== 'string' || actual.full_name.toLowerCase() !== repository.toLowerCase() || typeof actual.default_branch !== 'string' || !actual.default_branch || actual.default_branch.length > 255 || /[\s\\\x00-\x1f]|\.\.|\/\/|^\/|\/$/.test(actual.default_branch)) return hold('INSTALLATION_REPOSITORY_MISMATCH');
    // Legacy profile installations remain readable in place. New distribution
    // binds storage to the owner's actual Commitkin fork, never a profile copy.
    const storageLayout = actual.owner.login.toLowerCase() === actual.name.toLowerCase() ? 'legacy-profile' : 'fork';
    if (storageLayout === 'fork' && !isCommitkinStorageRepository(actual)) return hold('INSTALLATION_REPOSITORY_MISMATCH');
    if (context.actorAccountId !== context.ownerAccountId) return hold('INSTALLATION_ACTOR_MISMATCH');
    if (context.ref !== 'refs/heads/' + actual.default_branch) return hold('INSTALLATION_DEFAULT_BRANCH_REQUIRED');
    const head = await client.get(`${root}/git/ref/heads/${actual.default_branch.split('/').map(encodeURIComponent).join('/')}`);
    if (!head.ok || head.data?.object?.sha !== context.sha) return hold('INSTALLATION_HEAD_MISMATCH');
    const expectedHead = context.sha;
    const commit = await client.get(`${root}/git/commits/${expectedHead}`);
    if (!commit.ok || commit.data?.sha !== expectedHead || !SHA.test(commit.data?.tree?.sha ?? '')) return hold('INSTALLATION_COMMIT_INVALID');
    const tree = await client.get(`${root}/git/trees/${commit.data.tree.sha}?recursive=1`);
    if (!tree.ok || tree.data?.sha !== commit.data.tree.sha || tree.data.truncated !== false || !Array.isArray(tree.data.tree)) return hold('INSTALLATION_TREE_INCOMPLETE');
    const entries = new Map();
    for (const entry of tree.data.tree) {
      if (!entry || typeof entry.path !== 'string' || entries.has(entry.path)) return hold('INSTALLATION_TREE_INVALID');
      entries.set(entry.path, structuredClone(entry));
    }
    for (const directory of ['.commitkin', '.github']) {
      const entry = entries.get(directory);
      if (entry && (entry.type !== 'tree' || entry.mode !== '040000')) return hold('INSTALLATION_SYMLINK_REJECTED');
    }
    const recordCount = Object.values(RECORDS).filter(path => entries.has(path)).length;
    if (recordCount !== 0 && recordCount !== 3 || recordCount === 0 && ['.commitkin/card.png', '.commitkin/character.png', '.commitkin/profile.json'].some(path => entries.has(path))) return hold('RECOVERY_REQUIRED');
    const contents = {};
    for (const path of Object.keys(LIMITS)) {
      // Fork documentation is neither an analysis input nor a publication
      // target. Do not make its format, size or presence an installation gate.
      if (storageLayout === 'fork' && path === 'README.md') { contents[path] = null; continue; }
      const entry = entries.get(path);
      if (!entry) { contents[path] = null; continue; }
      if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || !SHA.test(entry.sha ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > LIMITS[path]) return hold('INSTALLATION_FILE_INVALID');
      const response = await client.get(`${root}/contents/${path}?` + new URLSearchParams({ ref: expectedHead }));
      if (!response.ok || response.data?.type !== 'file' || response.data.path !== path || response.data.sha !== entry.sha || response.data.size !== entry.size) return hold('INSTALLATION_CONTENT_UNAVAILABLE');
      let data = response.data;
      // Contents returns encoding:none for some large files. The fixed tree SHA
      // permits a safe Git-blob lookup without following a supplied download URL.
      if (data.encoding === 'none') {
        const blob = await client.get(`${root}/git/blobs/${entry.sha}`);
        if (!blob.ok) return hold('INSTALLATION_CONTENT_UNAVAILABLE');
        data = blob.data;
      }
      contents[path] = decodeFile(data, entry.sha, entry.size, path);
    }
    const records = Object.fromEntries(Object.entries(RECORDS).map(([role, path]) => [role, contents[path]]));
    const expectedOwner = { accountId: context.ownerAccountId, profileRepositoryId: context.repositoryId };
    let firstInstallVerified = false; let pendingOriginVerified = false; let adventurerOriginVerified = false; let initialClassOriginDeferred = false;
    if (recordCount === 0) {
      // This proves absence only in history reachable from this captured default
      // head. Complete removal/rewrite of all history cannot be detected perfectly.
      for (const path of Object.values(RECORDS)) {
        const history = await client.paginate(`${root}/commits?` + new URLSearchParams({ path, sha: expectedHead, per_page: '100' }), { maxPages: maxHistoryPages, repositoryId: context.repositoryId });
        if (!history.ok || history.complete !== true || !Array.isArray(history.items)) return hold('INSTALLATION_HISTORY_INCOMPLETE');
        if (history.items.length > 0) return hold('RECOVERY_REQUIRED');
      }
      if (context.eventName !== 'workflow_dispatch' || !selection || Object.keys(selection).sort().join(',') !== 'accountId,confirmation,factionId' ||
        selection.accountId !== context.ownerAccountId || !['bloomguard', 'ashbound'].includes(selection.factionId) || selection.confirmation !== 'CONFIRM_PERMANENT_FACTION') return hold('FIRST_INSTALL_CONFIRMATION_REQUIRED');
      firstInstallVerified = true;
    } else {
      if (selection !== null) return hold('FACTION_ALREADY_CONFIRMED');
      if (typeof validateRecords !== 'function') return hold('INSTALLATION_VALIDATOR_REQUIRED');
      const report = validateRecords(records, { expectedOwner, now: context.startedAt, operation: 'normal', evaluationStartedAt: context.startedAt });
      if (!report || report.recordValid !== true || !['ACCEPT', 'ANALYSIS_PENDING', 'RETAIN_SUCCESS'].includes(report.code)) return hold('INSTALLATION_RECORD_INVALID');
      const current = parseStrictJson(records.state, 'state');
      if (current.growth?.phase === 'pending') {
        const pending = await verifyPendingOrigin({ client, root, repositoryId: context.repositoryId, expectedHead, current, currentBlob: entries.get(RECORDS.state).sha, maxHistoryPages });
        if (!pending.ok) return hold(pending.code);
        pendingOriginVerified = true;
      } else if (current.growth?.phase === 'ready' && current.class?.id === 'adventurer') {
        if (deferReadyClassOrigin) initialClassOriginDeferred = true;
        else {
          const origin = await verifyAdventurerOrigin({ client, root, repositoryId: context.repositoryId, expectedHead, current, currentEntries: entries, currentRecords: records, maxHistoryPages, validateRecords, now: context.startedAt });
          if (!origin.ok) return hold(origin.code);
          adventurerOriginVerified = true;
        }
      }
    }
    return {
      decision: 'acquired', code: firstInstallVerified ? 'FIRST_INSTALL_INPUTS_ACQUIRED' : 'EXISTING_INSTALLATION_ACQUIRED',
      expectedOwner, expectedHead, defaultBranch: actual.default_branch, login: actual.owner.login, storageLayout,
      repository: { id: context.repositoryId, name: actual.name, fullName: actual.full_name, ownerAccountId: context.ownerAccountId, ownerLogin: actual.owner.login, visibility: 'public' },
      records, readmeBytes: contents['README.md'], settingsBytes: contents['.github/commitkin.yml'], settingsFileUsed: contents['.github/commitkin.yml'] !== null,
      firstInstallVerified, initialAssignmentVerified: firstInstallVerified || pendingOriginVerified || adventurerOriginVerified,
      initialClassOriginDeferred,
      initialSelection: firstInstallVerified ? { accountId: expectedOwner.accountId, factionId: selection.factionId } : null,
      provenance: { source: 'fixed-head-repository-read', expectedHead, treeSha: commit.data.tree.sha, historyScope: 'reachable-default-branch-at-expected-head', historicalAuthenticity: 'not_checked', perfectPriorInstallationDetection: false,
        initialAssignmentSource: firstInstallVerified ? 'first-install-empty-history' : pendingOriginVerified ? 'reachable-pending-state-chain' : adventurerOriginVerified ? 'reachable-adventurer-state-chain' : null },
      progressionAuthorized: false, publicationAuthorized: false,
    };
  } catch (error) {
    const safe = new Set(['INSTALLATION_CONTENT_INVALID', 'INSTALLATION_BASE64_INVALID', 'INSTALLATION_CONTENT_SIZE_INVALID', 'INSTALLATION_BLOB_MISMATCH', 'INSTALLATION_UTF8_INVALID']);
    return hold(safe.has(error?.message) ? error.message : 'INSTALLATION_ACQUISITION_UNAVAILABLE');
  }
}
