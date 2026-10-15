import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { acquireInstallation } from '../src/infrastructure/github/installation.mjs';
import { createValidator } from '../../record-validator/src/index.js';
import { digest } from '../../record-validator/src/domain/hash.js';

const HEAD = 'a'.repeat(40); const TREE = 'b'.repeat(40);
const RECORD_PATHS = ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json'];
const TOKEN = 'private_token_must_never_be_returned';
const bytes = value => new TextEncoder().encode(value);
const blobHash = value => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const context = (extra = {}) => ({ serverUrl: 'https://github.com', apiUrl: 'https://api.github.com', eventName: 'workflow_dispatch', repository: 'Owner/OWNER', repositoryId: '9001', ownerAccountId: '1001', actorAccountId: '1001', ref: 'refs/heads/main', sha: HEAD, startedAt: '2026-10-15T02:00:00Z', ...extra });
const selection = (extra = {}) => ({ accountId: '1001', factionId: 'bloomguard', confirmation: 'CONFIRM_PERMANENT_FACTION', ...extra });
function savedFiles(name = 'ready-40xp') {
  return Object.fromEntries(['state', 'ledger', 'status'].map(role => [`.commitkin/${role}.json`, new Uint8Array(readFileSync(new URL(`../../../test/fixtures/records/v1/valid/${name}/${role}.json`, import.meta.url)))]));
}
function fixture({ files = {}, metadata = {}, head = HEAD, truncated = false, treeChanges = entry => entry, contentChanges = item => item, history = {}, historicalStates = {}, historicalTreeChanges = entry => entry, historicalContentChanges = item => item, historicalTruncated = false, failure = null, blobFallback = false } = {}) {
  const filesByPath = { 'README.md': bytes('# Profile\n<!-- COMMITKIN:START -->\n<!-- COMMITKIN:END -->\n안녕\n'), '.github/commitkin.yml': bytes('version: 1\nrepositories:\n  additional: []\n  exclude: []\n'), ...files };
  for (const [path, value] of Object.entries(filesByPath)) if (value === null) delete filesByPath[path];
  const entries = Object.entries(filesByPath).map(([path, value]) => treeChanges({ path, type: 'blob', mode: '100644', sha: blobHash(value), size: value.length }));
  if (Object.keys(filesByPath).some(path => path.startsWith('.commitkin/'))) entries.unshift({ path: '.commitkin', type: 'tree', mode: '040000', sha: TREE });
  if (Object.keys(filesByPath).some(path => path.startsWith('.github/'))) entries.unshift({ path: '.github', type: 'tree', mode: '040000', sha: TREE });
  const calls = [];
  const client = {
    async get(path) {
      calls.push({ method: 'GET', path });
      if (failure?.(path)) return { ok: false, code: 'ACCESS_DENIED' };
      const url = new URL(path, 'https://api.github.com'); const pathname = url.pathname;
      if (pathname === '/repos/Owner/OWNER') return { ok: true, data: { id: 9001, name: 'Owner', full_name: 'Owner/Owner', private: false, visibility: 'public', owner: { id: 1001, login: 'Owner', type: 'User' }, default_branch: 'main', ...metadata } };
      if (pathname === '/repos/Owner/OWNER/git/ref/heads/main') return { ok: true, data: { object: { sha: head } } };
      if (pathname === `/repos/Owner/OWNER/git/commits/${HEAD}`) return { ok: true, data: { sha: HEAD, tree: { sha: TREE } } };
      if (pathname === `/repos/Owner/OWNER/git/trees/${TREE}`) return { ok: true, data: { sha: TREE, truncated, tree: entries } };
      for (const [sha, value] of Object.entries(historicalStates)) {
        const treeSha = createHash('sha1').update('historical-tree:' + sha).digest('hex');
        if (pathname === `/repos/Owner/OWNER/git/commits/${sha}`) return { ok: true, data: { sha, tree: { sha: treeSha } } };
        if (pathname === `/repos/Owner/OWNER/git/trees/${treeSha}`) return { ok: true, data: { sha: treeSha, truncated: historicalTruncated, tree: value === null ? [] : [
          { path: '.commitkin', type: 'tree', mode: '040000', sha: TREE }, historicalTreeChanges({ path: RECORD_PATHS[0], type: 'blob', mode: '100644', sha: blobHash(value), size: value.length }),
        ] } };
      }
      if (pathname.startsWith('/repos/Owner/OWNER/contents/')) {
        const ref = url.searchParams.get('ref');
        assert.equal(ref === HEAD || Object.hasOwn(historicalStates, ref), true);
        const relative = pathname.slice('/repos/Owner/OWNER/contents/'.length); const value = ref === HEAD ? filesByPath[relative] : relative === RECORD_PATHS[0] ? historicalStates[ref] : null;
        if (!value) return { ok: false, code: 'REPOSITORY_UNAVAILABLE' };
        const transform = ref === HEAD ? contentChanges : historicalContentChanges;
        return { ok: true, data: transform({ path: relative, type: 'file', encoding: blobFallback ? 'none' : 'base64', sha: blobHash(value), size: value.length, content: blobFallback ? '' : Buffer.from(value).toString('base64') }, ref) };
      }
      if (pathname.startsWith('/repos/Owner/OWNER/git/blobs/')) {
        const sha = pathname.slice('/repos/Owner/OWNER/git/blobs/'.length); const value = [...Object.values(filesByPath), ...Object.values(historicalStates).filter(Boolean)].find(item => blobHash(item) === sha);
        return value ? { ok: true, data: { sha, size: value.length, encoding: 'base64', content: Buffer.from(value).toString('base64') } } : { ok: false, code: 'REPOSITORY_UNAVAILABLE' };
      }
      throw new Error('Unexpected mock request');
    },
    async paginate(path, options) {
      calls.push({ method: 'GET_PAGES', path, options });
      const url = new URL(path, 'https://api.github.com'); assert.equal(url.searchParams.get('sha'), HEAD);
      const entry = history[url.searchParams.get('path')];
      return entry ?? { ok: true, complete: true, items: [], pages: 1 };
    },
  };
  return { client, calls, filesByPath, entries };
}
const validateRecords = createValidator();
async function acquire(mock, extra = {}) { return acquireInstallation({ client: mock.client, workflowContext: context(), initialSelection: selection(), validateRecords, ...extra }); }
function pendingFiles(revision = 2) {
  const files = savedFiles('first-analysis-pending');
  const values = Object.fromEntries(RECORD_PATHS.map(path => [path, JSON.parse(new TextDecoder().decode(files[path]))]));
  for (const value of Object.values(values)) value.recordRevision = revision;
  values[RECORD_PATHS[0]].integrity.ledgerHash = digest(values[RECORD_PATHS[1]]);
  return Object.fromEntries(Object.entries(values).map(([path, value]) => [path, bytes(JSON.stringify(value))]));
}
const OLD = 'c'.repeat(40); const OLDEST = 'd'.repeat(40);
function pendingFixture(changes = {}) {
  return fixture({ files: pendingFiles(), historicalStates: { [OLD]: pendingFiles(1)[RECORD_PATHS[0]] },
    history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items: [{ sha: HEAD }, { sha: OLD }], pages: 1 } }, ...changes });
}

test('genuine first-use inputs require immutable-head absence, complete empty histories and explicit owner faction confirmation', async () => {
  const mock = fixture(); const result = await acquire(mock);
  assert.equal(result.decision, 'acquired'); assert.equal(result.firstInstallVerified, true); assert.equal(result.initialAssignmentVerified, true);
  assert.deepEqual(result.expectedOwner, { accountId: '1001', profileRepositoryId: '9001' }); assert.equal(result.expectedHead, HEAD);
  assert.equal(result.defaultBranch, 'main'); assert.equal(result.login, 'Owner');
  assert.deepEqual(result.records, { state: null, ledger: null, status: null }); assert.equal(result.initialSelection.factionId, 'bloomguard');
  assert.equal(result.publicationAuthorized, false); assert.equal(result.progressionAuthorized, false);
  assert.equal(result.provenance.perfectPriorInstallationDetection, false);
  assert.equal(mock.calls.filter(call => call.method === 'GET_PAGES').length, 3);
});
test('README and settings bytes remain lossless UTF-8 inputs, not rewritten public outputs', async () => {
  const mock = fixture(); const result = await acquire(mock);
  assert.deepEqual(result.readmeBytes, mock.filesByPath['README.md']); assert.deepEqual(result.settingsBytes, mock.filesByPath['.github/commitkin.yml']);
  assert.equal(new TextDecoder().decode(result.readmeBytes).includes('안녕'), true);
  assert.equal(mock.calls.every(call => call.method.startsWith('GET')), true);
});
test('scheduled execution, absent confirmation, wrong account and incomplete irreversible warning cannot initialize', async () => {
  for (const extra of [{ workflowContext: context({ eventName: 'schedule' }) }, { initialSelection: null }, { initialSelection: selection({ accountId: '999' }) }, { initialSelection: selection({ confirmation: 'yes' }) }, { initialSelection: selection({ factionId: 'random' }) }, { initialSelection: { ...selection(), reset: true } }]) {
    const result = await acquire(fixture(), extra); assert.equal(result.code, 'FIRST_INSTALL_CONFIRMATION_REQUIRED'); assert.equal(result.firstInstallVerified, false);
  }
});
test('owner actor mismatch rejects both first use and refresh without returning record contents', async () => {
  for (const files of [{}, savedFiles()]) {
    const result = await acquire(fixture({ files }), { workflowContext: context({ actorAccountId: '999' }) });
    assert.equal(result.code, 'INSTALLATION_ACTOR_MISMATCH'); assert.equal(Object.hasOwn(result, 'records'), false);
  }
});
test('non-GitHub servers, arbitrary API URLs, unsafe IDs and unsupported events fail before acquisition', async () => {
  for (const change of [{ serverUrl: 'https://ghe.test' }, { apiUrl: 'https://api.github.com.evil.test' }, { repositoryId: 9001 }, { ownerAccountId: '01' }, { eventName: 'pull_request' }, { sha: 'main' }, { startedAt: '2026-02-30T00:00:00Z' }]) {
    const mock = fixture(); assert.equal((await acquire(mock, { workflowContext: context(change) })).code, 'INSTALLATION_CONTEXT_INVALID'); assert.equal(mock.calls.length, 0);
  }
});
test('only public personal profile repository with matching durable owner and repository IDs is accepted', async () => {
  for (const metadata of [{ private: true, visibility: 'private' }, { visibility: 'internal' }, { id: 9002 }, { owner: { id: 999, login: 'Owner', type: 'User' } }, { owner: { id: 1001, login: 'Owner', type: 'Organization' } }, { name: 'project', full_name: 'Owner/project' }, { full_name: 'Other/Owner' }]) assert.equal((await acquire(fixture({ metadata }))).code, 'INSTALLATION_REPOSITORY_MISMATCH');
});
test('default-branch ref and immutable expected head must match trusted workflow context', async () => {
  assert.equal((await acquire(fixture(), { workflowContext: context({ ref: 'refs/heads/other' }) })).code, 'INSTALLATION_DEFAULT_BRANCH_REQUIRED');
  assert.equal((await acquire(fixture({ head: 'c'.repeat(40) }))).code, 'INSTALLATION_HEAD_MISMATCH');
});
test('one or two missing growth records is recovery, never first use', async () => {
  const saved = savedFiles();
  for (const count of [1, 2]) {
    const files = Object.fromEntries(Object.entries(saved).slice(0, count)); const result = await acquire(fixture({ files }));
    assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(result.firstInstallVerified, false);
  }
});
test('a retained card with absent records requires recovery instead of zero initialization', async () => {
  assert.equal((await acquire(fixture({ files: { '.commitkin/card.png': bytes('old PNG') } }))).code, 'RECOVERY_REQUIRED');
});
test('previously deleted record paths are detected from default-head commit history', async () => {
  for (const path of RECORD_PATHS) {
    const mock = fixture({ history: { [path]: { ok: true, complete: true, items: [{ sha: 'c'.repeat(40) }] } } });
    assert.equal((await acquire(mock)).code, 'RECOVERY_REQUIRED');
  }
});
test('history caps, errors or unknown completion prevent a genuine-first-use claim', async () => {
  for (const entry of [{ ok: false, complete: false, code: 'PAGE_LIMIT_REACHED', items: [] }, { ok: false, code: 'ACCESS_DENIED', items: [] }, { ok: true, items: [] }, { ok: true, complete: false, items: [] }]) {
    const result = await acquire(fixture({ history: { [RECORD_PATHS[0]]: entry } })); assert.equal(result.code, 'INSTALLATION_HISTORY_INCOMPLETE'); assert.equal(result.firstInstallVerified, false);
  }
});
test('tree truncation or unknown termination cannot prove missing files', async () => {
  assert.equal((await acquire(fixture({ truncated: true }))).code, 'INSTALLATION_TREE_INCOMPLETE');
});
test('record and reserved directory symlinks are rejected without following their targets', async () => {
  assert.equal((await acquire(fixture({ files: savedFiles(), treeChanges: entry => entry.path === RECORD_PATHS[0] ? { ...entry, mode: '120000' } : entry }))).code, 'INSTALLATION_FILE_INVALID');
  const mock = fixture(); mock.entries.find(entry => entry.path === '.github').mode = '120000';
  assert.equal((await acquire(mock)).code, 'INSTALLATION_SYMLINK_REJECTED');
});
test('Contents 404 for a tree-proven existing file is unavailable, not absent or a new installation', async () => {
  const mock = fixture({ files: savedFiles(), failure: path => path.includes('/contents/.commitkin/state.json') });
  const result = await acquire(mock, { initialSelection: null }); assert.equal(result.code, 'INSTALLATION_CONTENT_UNAVAILABLE'); assert.equal(result.firstInstallVerified, false);
});
test('contents must match fixed-head paths, sizes and Git blob identities', async () => {
  for (const contentChanges of [item => ({ ...item, path: 'other' }), item => ({ ...item, sha: 'f'.repeat(40) }), item => ({ ...item, size: item.size + 1 })]) assert.equal((await acquire(fixture({ contentChanges }))).code, 'INSTALLATION_CONTENT_UNAVAILABLE');
  const result = await acquire(fixture({ contentChanges: item => ({ ...item, content: Buffer.from('a'.repeat(item.size)).toString('base64') }) }));
  assert.equal(result.code, 'INSTALLATION_BLOB_MISMATCH');
});
test('base64 validation rejects invalid alphabet, padding and noncanonical encodings', async () => {
  for (const content of ['?', 'YWJj=', 'YQ=A', 'YQ==\t', 'YR==']) {
    const result = await acquire(fixture({ contentChanges: item => ({ ...item, content }) }));
    assert.equal(['INSTALLATION_BASE64_INVALID', 'INSTALLATION_CONTENT_SIZE_INVALID'].includes(result.code), true, result.code);
  }
});
test('strict UTF-8 rejects invalid source bytes without leaking content', async () => {
  const result = await acquire(fixture({ files: { 'README.md': new Uint8Array([0xff]) } }));
  assert.equal(result.code, 'INSTALLATION_UTF8_INVALID'); assert.equal(Object.hasOwn(result, 'readmeBytes'), false);
});
test('fixed SHA blob fallback handles encoding:none without following a supplied download URL', async () => {
  const mock = fixture({ files: savedFiles(), blobFallback: true });
  const result = await acquire(mock, { initialSelection: null }); assert.equal(result.decision, 'acquired');
  assert.equal(mock.calls.some(call => call.path.includes('/git/blobs/')), true); assert.equal(mock.calls.some(call => call.path.includes('download')), false);
});
test('refresh validates matched record bytes and preserves fixed faction without new assignment provenance', async () => {
  const mock = fixture({ files: savedFiles() }); const result = await acquire(mock, { initialSelection: null });
  assert.equal(result.decision, 'acquired'); assert.equal(result.firstInstallVerified, false); assert.equal(result.initialAssignmentVerified, false);
  assert.deepEqual(result.records.state, mock.filesByPath[RECORD_PATHS[0]]); assert.equal(result.initialSelection, null);
  assert.equal(mock.calls.some(call => call.method === 'GET_PAGES'), false);
});
test('existing pending state cannot infer genuine first-normal origin from empty history or reopen faction confirmation', async () => {
  const result = await acquire(fixture({ files: savedFiles('first-analysis-pending') }), { initialSelection: null });
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(result.firstInstallVerified, false); assert.equal(result.initialAssignmentVerified, false);
  assert.equal((await acquire(fixture({ files: savedFiles('first-analysis-pending') }))).code, 'FACTION_ALREADY_CONFIRMED');
});
test('existing complete records reject any reselection and cannot bypass record validation', async () => {
  assert.equal((await acquire(fixture({ files: savedFiles() }))).code, 'FACTION_ALREADY_CONFIRMED');
  assert.equal((await acquire(fixture({ files: savedFiles() }), { initialSelection: null, validateRecords: undefined })).code, 'INSTALLATION_VALIDATOR_REQUIRED');
});
test('mixed snapshot revisions, malformed JSON and wrong owners are held', async () => {
  for (const modify of [state => { state.recordRevision += 1; }, state => { state.owner.accountId = '999'; }]) {
    const files = savedFiles(); const state = JSON.parse(new TextDecoder().decode(files[RECORD_PATHS[0]])); modify(state); files[RECORD_PATHS[0]] = bytes(JSON.stringify(state));
    assert.equal((await acquire(fixture({ files }), { initialSelection: null })).code, 'INSTALLATION_RECORD_INVALID');
  }
  const files = savedFiles(); files[RECORD_PATHS[0]] = bytes('{ broken');
  assert.equal((await acquire(fixture({ files }), { initialSelection: null })).code, 'INSTALLATION_RECORD_INVALID');
});
test('missing README/settings remain explicit null bytes rather than fabricated defaults', async () => {
  const result = await acquire(fixture({ files: { 'README.md': null, '.github/commitkin.yml': null } }));
  assert.equal(result.decision, 'acquired'); assert.equal(result.readmeBytes, null); assert.equal(result.settingsBytes, null); assert.equal(result.settingsFileUsed, false);
});
test('errors and injected validator exceptions are sanitized and never disclose raw secrets', async () => {
  const mock = fixture({ files: savedFiles() });
  const result = await acquire(mock, { initialSelection: null, validateRecords: () => { throw new Error(TOKEN); } });
  assert.equal(result.code, 'INSTALLATION_ACQUISITION_UNAVAILABLE'); assert.equal(JSON.stringify(result).includes(TOKEN), false);
});
test('file byte ceilings and duplicate tree entries fail closed', async () => {
  const mock = fixture({ treeChanges: entry => entry.path === '.github/commitkin.yml' ? { ...entry, size: 65537 } : entry });
  assert.equal((await acquire(mock)).code, 'INSTALLATION_FILE_INVALID');
  const duplicate = fixture(); duplicate.entries.push({ ...duplicate.entries[0] }); assert.equal((await acquire(duplicate)).code, 'INSTALLATION_TREE_INVALID');
});
test('all contents are acquired by the original SHA even if branch moves after the initial head check', async () => {
  const mock = fixture({ files: savedFiles() }); const original = mock.client.get; let contentRequests = 0;
  mock.client.get = async path => { if (path.includes('/contents/')) { contentRequests += 1; assert.equal(new URL(path, 'https://api.github.com').searchParams.get('ref'), HEAD); } return original(path); };
  const result = await acquire(mock, { initialSelection: null }); assert.equal(result.expectedHead, HEAD); assert.equal(contentRequests, 5);
});

test('complete immutable history containing only supported pending snapshots proves first-normal assignment, not first installation', async () => {
  const mock = pendingFixture(); const result = await acquire(mock, { initialSelection: null });
  assert.equal(result.decision, 'acquired'); assert.equal(result.code, 'EXISTING_INSTALLATION_ACQUIRED');
  assert.equal(result.firstInstallVerified, false); assert.equal(result.initialAssignmentVerified, true); assert.equal(result.initialSelection, null);
  assert.equal(result.provenance.initialAssignmentSource, 'reachable-pending-state-chain');
  assert.equal(result.provenance.historicalAuthenticity, 'not_checked'); assert.equal(result.provenance.perfectPriorInstallationDetection, false);
  assert.equal(result.progressionAuthorized, false); assert.equal(result.publicationAuthorized, false);
  const history = mock.calls.filter(call => call.method === 'GET_PAGES'); assert.equal(history.length, 1);
  const query = new URL(history[0].path, 'https://api.github.com').searchParams;
  assert.equal(query.get('path'), RECORD_PATHS[0]); assert.equal(query.get('sha'), HEAD); assert.equal(query.get('per_page'), '100');
  assert.equal(history[0].options.maxPages, 2);
  assert.equal(mock.calls.some(call => call.path.includes('/contents/.commitkin/state.json?ref=' + OLD)), true);
});

test('a single original revision-one pending state is sufficient when its historical head blob is verified', async () => {
  const mock = pendingFixture({ files: pendingFiles(1), historicalStates: {}, history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items: [{ sha: HEAD }] } } });
  const result = await acquire(mock, { initialSelection: null }); assert.equal(result.initialAssignmentVerified, true); assert.equal(result.firstInstallVerified, false);
});

test('README-only newer commits do not require the latest state-changing commit to equal HEAD', async () => {
  const files = pendingFiles(); const mock = pendingFixture({ files, historicalStates: { [OLD]: files[RECORD_PATHS[0]], [OLDEST]: pendingFiles(1)[RECORD_PATHS[0]] },
    history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items: [{ sha: OLD }, { sha: OLDEST }] } } });
  assert.equal((await acquire(mock, { initialSelection: null })).initialAssignmentVerified, true);
});

test('format-only historical commits may repeat an identical canonical pending state without a revision decrease', async () => {
  const files = pendingFiles(); const state = JSON.parse(new TextDecoder().decode(files[RECORD_PATHS[0]]));
  const mock = pendingFixture({ files, historicalStates: { [OLD]: bytes(JSON.stringify(state, null, 4) + '\n'), [OLDEST]: pendingFiles(1)[RECORD_PATHS[0]] },
    history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items: [{ sha: HEAD }, { sha: OLD }, { sha: OLDEST }] } } });
  assert.equal((await acquire(mock, { initialSelection: null })).initialAssignmentVerified, true);
});

test('historical encoding:none uses only the verified Git blob SHA fallback', async () => {
  const mock = pendingFixture({ blobFallback: true });
  assert.equal((await acquire(mock, { initialSelection: null })).initialAssignmentVerified, true);
  assert.equal(mock.calls.every(call => call.method.startsWith('GET')), true);
});

test('historical ready snapshots require recovery even after current records have been replaced with pending ones', async () => {
  for (const name of ['ready-40xp', 'ready-empty']) {
    const mock = pendingFixture({ historicalStates: { [OLD]: savedFiles(name)[RECORD_PATHS[0]] } });
    const result = await acquire(mock, { initialSelection: null }); assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(result.initialAssignmentVerified, false);
  }
});

for (const [label, change] of [
  ['owner', state => { state.owner.accountId = '999'; }],
  ['profile repository', state => { state.owner.profileRepositoryId = '999'; }],
  ['faction', state => { state.faction.id = 'ashbound'; }],
  ['faction confirmation time', state => { state.faction.confirmedAt = '2026-10-15T00:40:00Z'; }],
  ['growth start', state => { state.growth.startDate = '2026-07-18'; }],
  ['unsupported schema', state => { state.schemaVersion = 2; }],
  ['unsupported ruleset', state => { state.rulesetVersion = '2.0.0'; }],
  ['unknown field', state => { state.hiddenSuccess = true; }],
  ['non-null XP', state => { state.growth.totalXp = '0'; }],
  ['non-null class', state => { state.class = { id: 'adventurer', history: [] }; }],
  ['earned achievement', state => { state.achievements = [{ seriesId: 'trailblazer', earned: [] }]; }],
  ['habit trait', state => { state.traits.habit.currentId = 'steadfast'; }],
  ['pending trait', state => { state.traits.activity.pending = { count: 1 }; }],
  ['normal clock', state => { state.observationClock.lastNormalEvaluationOn = '2026-10-15'; }],
  ['class clock', state => { state.observationClock.classLastCountedOn = '2026-10-15'; }],
  ['habit clock', state => { state.observationClock.habitLastCountedOn = '2026-10-15'; }],
  ['activity clock', state => { state.observationClock.activityLastCountedOn = '2026-10-15'; }],
  ['prior evaluation', state => { state.evaluation = {}; }],
  ['bad revision', state => { state.recordRevision = 0; }],
  ['unsafe revision', state => { state.recordRevision = 9007199254740992; }],
  ['bad settings type', state => { state.settings.filePreviouslyUsed = 'false'; }],
  ['bad settings hash', state => { state.settings.lastAcceptedHash = TOKEN; }],
  ['extra settings field', state => { state.settings.unknown = true; }],
  ['bad ledger hash', state => { state.integrity.ledgerHash = TOKEN; }],
  ['extra integrity field', state => { state.integrity.unknown = true; }],
]) {
  test(`historical pending invariant drift requires recovery: ${label}`, async () => {
    const state = JSON.parse(new TextDecoder().decode(pendingFiles(1)[RECORD_PATHS[0]])); change(state);
    const result = await acquire(pendingFixture({ historicalStates: { [OLD]: bytes(JSON.stringify(state)) } }), { initialSelection: null });
    assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(result.initialAssignmentVerified, false); assert.equal(JSON.stringify(result).includes(TOKEN), false);
  });
}

test('semantic historical revisions must decrease and terminate at the original revision one', async () => {
  for (const revision of [2, 3]) {
    const state = JSON.parse(new TextDecoder().decode(pendingFiles(revision)[RECORD_PATHS[0]])); state.settings.filePreviouslyUsed = false;
    const result = await acquire(pendingFixture({ historicalStates: { [OLD]: bytes(JSON.stringify(state)) } }), { initialSelection: null });
    assert.equal(result.code, 'RECOVERY_REQUIRED');
  }
  const mock = pendingFixture({ files: pendingFiles(3), historicalStates: { [OLD]: pendingFiles(2)[RECORD_PATHS[0]] } });
  assert.equal((await acquire(mock, { initialSelection: null })).code, 'RECOVERY_REQUIRED');
});

test('latest state-changing commit must match the captured HEAD blob, not merely an older pending lifecycle', async () => {
  const files = pendingFiles(); const state = JSON.parse(new TextDecoder().decode(files[RECORD_PATHS[0]]));
  const mock = pendingFixture({ historicalStates: { [OLD]: bytes(JSON.stringify(state, null, 2)), [OLDEST]: pendingFiles(1)[RECORD_PATHS[0]] },
    history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items: [{ sha: OLD }, { sha: OLDEST }] } } });
  assert.equal((await acquire(mock, { initialSelection: null })).code, 'RECOVERY_REQUIRED');
});

test('unknown or incomplete provider history cannot grant initial assignment', async () => {
  for (const entry of [{ ok: false, complete: false, code: 'PAGE_LIMIT_REACHED', items: [] }, { ok: true, complete: false, items: [{ sha: HEAD }] },
    { ok: true, items: [{ sha: HEAD }] }, { ok: true, complete: true, items: null }]) {
    const result = await acquire(pendingFixture({ history: { [RECORD_PATHS[0]]: entry } }), { initialSelection: null });
    assert.equal(result.code, 'INSTALLATION_HISTORY_INCOMPLETE'); assert.equal(result.initialAssignmentVerified, false);
  }
});

test('historical state cap is one hundred and rejects before reading over-limit snapshots', async () => {
  const states = Array.from({ length: 101 }, (_, n) => ({ sha: createHash('sha1').update('commit' + n).digest('hex') }));
  const mock = pendingFixture({ history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items: states } } });
  const result = await acquire(mock, { initialSelection: null }); assert.equal(result.code, 'INSTALLATION_HISTORY_INCOMPLETE');
  assert.equal(mock.calls.filter(call => call.path.includes('/contents/.commitkin/state.json')).length, 1);
});

test('the bounded proof accepts exactly one hundred verified formatting-only pending states', async () => {
  const files = pendingFiles(1); const historicalStates = {}; const items = [{ sha: HEAD }];
  for (let index = 1; index < 100; index += 1) {
    const sha = createHash('sha1').update('format-only-state-' + index).digest('hex');
    historicalStates[sha] = files[RECORD_PATHS[0]]; items.push({ sha });
  }
  const mock = pendingFixture({ files, historicalStates, history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items } } });
  const result = await acquire(mock, { initialSelection: null }); assert.equal(result.initialAssignmentVerified, true); assert.equal(result.firstInstallVerified, false);
  assert.equal(mock.calls.filter(call => call.path.includes('/contents/.commitkin/state.json')).length, 101);
});

test('shared client budget exhaustion during historical lookups preserves pending bytes and grants nothing', async () => {
  const mock = pendingFixture(); const original = mock.client.get; let used = 0;
  mock.client.get = async path => ++used > 12 ? { ok: false, code: 'REQUEST_BUDGET_EXHAUSTED' } : original(path);
  const originalBytes = mock.filesByPath[RECORD_PATHS[0]].slice();
  const result = await acquire(mock, { initialSelection: null });
  assert.equal(result.decision, 'hold'); assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(result.initialAssignmentVerified, false);
  assert.deepEqual(mock.filesByPath[RECORD_PATHS[0]], originalBytes); assert.equal(Object.hasOwn(result, 'records'), false);
});

test('malformed or repeated immutable commit IDs cannot establish a pending chain', async () => {
  for (const items of [[{ sha: 'main' }], [null], [{ sha: HEAD }, { sha: HEAD }]]) {
    const result = await acquire(pendingFixture({ history: { [RECORD_PATHS[0]]: { ok: true, complete: true, items } } }), { initialSelection: null });
    assert.equal(result.code, 'RECOVERY_REQUIRED');
  }
});

test('historical missing file, corrupt strict JSON, unsafe Unicode and byte tampering require recovery without echoing content', async () => {
  for (const historicalState of [null, bytes('{ broken ' + TOKEN), bytes('{"schemaVersion":1,"schemaVersion":1}'), bytes('{"x":"\\ud800"}'), new Uint8Array([0xff])]) {
    const result = await acquire(pendingFixture({ historicalStates: { [OLD]: historicalState } }), { initialSelection: null });
    assert.equal(result.code, 'RECOVERY_REQUIRED'); assert.equal(JSON.stringify(result).includes(TOKEN), false);
  }
  const mock = pendingFixture({ historicalContentChanges: file => ({ ...file, content: Buffer.from(TOKEN).toString('base64') }) });
  assert.equal((await acquire(mock, { initialSelection: null })).code, 'RECOVERY_REQUIRED');
});

test('historical tree modes, truncation, content identity and lookup failures cannot be mistaken for pending provenance', async () => {
  for (const changes of [
    { historicalTreeChanges: entry => ({ ...entry, mode: '120000' }) },
    { historicalTreeChanges: entry => ({ ...entry, type: 'commit', mode: '160000' }) },
    { historicalTruncated: true },
    { historicalContentChanges: file => ({ ...file, sha: 'f'.repeat(40) }) },
    { historicalContentChanges: file => ({ ...file, path: 'other.json' }) },
    { historicalContentChanges: file => ({ ...file, size: file.size + 1 }) },
    { failure: path => path.includes('/git/commits/' + OLD) },
    { failure: path => path.includes('/git/trees/' + createHash('sha1').update('historical-tree:' + OLD).digest('hex')) },
    { failure: path => path.includes('/contents/.commitkin/state.json?ref=' + OLD) },
  ]) assert.equal((await acquire(pendingFixture(changes), { initialSelection: null })).code, 'RECOVERY_REQUIRED');
});

test('a ready Adventurer with no activity remains a refresh, never a new initial-assignment exception', async () => {
  const mock = fixture({ files: savedFiles('ready-empty'), history: { [RECORD_PATHS[0]]: { ok: false } } });
  const result = await acquire(mock, { initialSelection: null });
  assert.equal(result.decision, 'acquired'); assert.equal(result.initialAssignmentVerified, false); assert.equal(result.firstInstallVerified, false);
  assert.equal(mock.calls.some(call => call.method === 'GET_PAGES'), false);
});
