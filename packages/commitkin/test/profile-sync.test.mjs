import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createProfileSyncUseCase } from '../src/application/sync-profile.mjs';
import { acquireProfileSync, createGithubProfileSync } from '../src/infrastructure/github/profile-sync.mjs';
import { createGithubProfilePublisher } from '../src/infrastructure/github/publication.mjs';
import { renderProfileMarkdown, validateProfileModel } from '../src/presentation/profile.mjs';
import { updateManagedReadme, START, END } from '../src/presentation/readme.mjs';
import { canvas, encodePng } from '../src/presentation/pixel.mjs';
import { AUTHOR_STORAGE, PRODUCT_OWNER_ID } from '../src/infrastructure/github/storage.mjs';

// All provider calls and CAS effects are in-memory fixtures, never real GitHub.
const TOKEN = 'synthetic-profile-sync-token';
const TARGET = 'HeroA/HeroA'; const SOURCE = 'HeroA/commitkin';
const HEAD = 'a'.repeat(40); const TREE = 'b'.repeat(40); const SOURCE_HEAD = 'c'.repeat(40); const SOURCE_TREE = 'd'.repeat(40);
const OWNER_ID = '1001'; const TARGET_ID = '9001'; const SOURCE_ID = '9002';
const ORIGINAL = '\ufeff# Keep my profile\r\n한글 🧑\r\n'+START+'\r\nold block\r\n'+END+'\r\nUntouched **footer**\r\n';
const hash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const objectId = value => createHash('sha1').update(JSON.stringify(value)).digest('hex');
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
const workflow = change => ({ serverUrl: 'https://github.com', apiUrl: 'https://api.github.com', eventName: 'workflow_dispatch', repository: TARGET,
  repositoryId: TARGET_ID, ownerAccountId: OWNER_ID, actorAccountId: OWNER_ID, ref: 'refs/heads/main', sha: HEAD, startedAt: '2026-10-16T01:00:00Z', ...change });
function modelAndPng() {
  const png = encodePng(canvas(192, 216, [12, 34, 56, 0]));
  const model = { schemaVersion: 1, recordType: 'profile', owner: { accountId: OWNER_ID, storageRepositoryId: SOURCE_ID }, username: 'HeroA', factionId: 'bloomguard', classId: 'adventurer',
    growth: { totalXp: '0', level: '1', xpIntoLevel: '0', xpForNextLevel: '100', appearanceStage: 0 }, traits: { habitId: null, activityId: null }, badges: [],
    analysis: { phase: 'ready', dataStatus: 'ok', growthStartDate: '2026-10-01', evaluatedAt: '2026-10-15T01:00:00Z', cutoffExclusive: '2026-10-15', classWindowStart: '2026-10-01', recentWindowStart: '2026-10-01', knownRepositories: 0, hasUnobservedGaps: false },
    familyScores: { craft: 0, guard: 0, knowledge: 0, verification: 0, recovery: 0, operations: 0 },
    recentActivity: { activeDays: 0, mergedPrs: 0, reviewedPrs: 0, reviewedCommits: 0, releases: 0, directContributions: 0, triageDays: 0 },
    details: { classification: { reason: 'adventurer', family: null, ownership: null, distribution: null }, classPending: null, traitPending: { habit: null, activity: null }, earnedAchievements: [] },
    character: { path: '.commitkin/character.png', sha256: createHash('sha256').update(png).digest('hex'), width: 192, height: 216 } };
  validateProfileModel(model); return { model, png };
}
function metadata(source = false) {
  return { id: source ? 9002 : 9001, node_id: source ? 'R_source' : 'R_target', owner: { id: 1001, login: 'HeroA', type: 'User' },
    name: source ? 'commitkin' : 'HeroA', full_name: source ? SOURCE : TARGET, private: false, visibility: 'public', default_branch: 'main',
    fork: source, ...(source ? { source: { id: 1420061458, owner: { id: 76037656 } } } : {}) };
}
function fixture(options = {}) {
  const TARGET = options.author ? 'JEONTAK/JEONTAK' : 'HeroA/HeroA', SOURCE = options.author ? AUTHOR_STORAGE.fullName : 'HeroA/commitkin';
  const OWNER_ID = options.author ? PRODUCT_OWNER_ID : '1001', TARGET_ID = options.author ? '773666201' : '9001', SOURCE_ID = options.author ? AUTHOR_STORAGE.repositoryId : '9002';
  const repositoryMetadata = source => options.author ? { ...metadata(source), id: Number(source ? SOURCE_ID : TARGET_ID), owner: { id: Number(OWNER_ID), login: 'JEONTAK', type: 'User' }, name: source ? 'commitkin-character' : 'JEONTAK', full_name: source ? SOURCE : TARGET, fork: false, source: undefined } : metadata(source);
  const value = modelAndPng();
  if (options.author) { value.model.owner = { accountId: OWNER_ID, storageRepositoryId: SOURCE_ID }; value.model.username = 'JEONTAK'; }
  options.changeModel?.(value.model);
  if (options.pending) {
    value.model.classId = null; for (const key of Object.keys(value.model.growth)) value.model.growth[key] = null;
    Object.assign(value.model.analysis, { phase: 'pending', dataStatus: 'analysis_pending', evaluatedAt: null, cutoffExclusive: null, classWindowStart: null, recentWindowStart: null, knownRepositories: null });
    value.model.familyScores = null; value.model.recentActivity = null;
    value.model.details = null;
  }
  const targetFiles = new Map([['README.md', options.readmeBytes ?? Buffer.from(options.readme ?? ORIGINAL)], ['src/keep.txt', Buffer.from('Must remain exact\n')], ['.commitkin/state.json', Buffer.from('Do not read or write profile growth records\n')]]);
  const sourceFiles = new Map([['.commitkin/profile.json', options.profileBytes ?? Buffer.from(JSON.stringify(value.model))], ['.commitkin/character.png', options.png ?? value.png], ['README.md', Buffer.from('<script>REMOTE_MARKDOWN_MUST_NOT_COPY</script>')]]);
  const trees = new Map([[TREE, targetFiles], [SOURCE_TREE, sourceFiles]]);
  const commits = new Map([[HEAD, { sha: HEAD, tree: { sha: TREE } }], [SOURCE_HEAD, { sha: SOURCE_HEAD, tree: { sha: SOURCE_TREE } }]]);
  const blobs = new Map([...targetFiles.values(), ...sourceFiles.values()].map(content => [hash(content), Buffer.from(content)]));
  const calls = []; let targetMetadataReads = 0; const controls = { head: HEAD, casSubmitted: false };
  async function fetchImpl(url, init) {
    const parsed = new URL(url); const path = parsed.pathname; const method = init.method;
    assert.equal(parsed.origin, 'https://api.github.com'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer '+TOKEN);
    const body = init.body === undefined ? null : JSON.parse(init.body); calls.push({ path, search: parsed.search, method, body });
    if (method === 'GET') {
      if (path === '/repos/'+TARGET) { const data = repositoryMetadata(false); targetMetadataReads += 1; options.changeTarget?.(data, targetMetadataReads); return response(data); }
      if (path === '/repos/'+SOURCE) { const data = repositoryMetadata(true); options.changeSource?.(data); return response(data); }
      if (path === `/repos/${TARGET}/git/ref/heads/main`) {
        if (controls.casSubmitted && options.readbackFailure) return response({ message: TOKEN }, 503);
        return response({ object: { type: 'commit', sha: options.targetHead ?? controls.head } });
      }
      if (path === `/repos/${SOURCE}/git/ref/heads/main`) return response({ object: { type: 'commit', sha: options.sourceHead ?? SOURCE_HEAD } });
      const repo = path.startsWith('/repos/'+SOURCE+'/') ? SOURCE : TARGET; const root = '/repos/'+repo;
      if (path.startsWith(root+'/git/commits/')) return response(commits.get(path.split('/').at(-1)) ?? {}, commits.has(path.split('/').at(-1)) ? 200 : 404);
      if (path.startsWith(root+'/git/trees/')) {
        const sha = path.split('/').at(-1); const files = trees.get(sha);
        if (!files) return response({}, 404);
        const data = { sha, truncated: false, tree: [
          ...(repo === SOURCE ? [{ path: '.commitkin', mode: '040000', type: 'tree', sha: SOURCE_TREE }] : []),
          ...[...files].map(([path, bytes]) => ({ path, type: 'blob', mode: '100644', sha: hash(bytes), size: bytes.length })),
        ] };
        options.changeTree?.(data, repo); return response(data);
      }
      if (path.startsWith(root+'/contents/')) {
        const relative = path.slice((root+'/contents/').length); const ref = parsed.searchParams.get('ref');
        assert.equal(ref, repo === SOURCE ? SOURCE_HEAD : HEAD); const files = repo === SOURCE ? sourceFiles : targetFiles; const bytes = files.get(relative);
        if (!bytes) return response({}, 404);
        const data = { type: 'file', path: relative, sha: hash(bytes), size: bytes.length, encoding: options.blobFallback ? 'none' : 'base64', content: options.blobFallback ? '' : bytes.toString('base64') };
        options.changeContents?.(data, relative, repo); return response(data);
      }
      if (path.startsWith(root+'/git/blobs/')) {
        const sha = path.split('/').at(-1); const bytes = blobs.get(sha); return bytes ? response({ sha, size: bytes.length, encoding: 'base64', content: bytes.toString('base64') }) : response({}, 404);
      }
      throw new TypeError('UNEXPECTED_MOCK_GET');
    }
    assert.equal(method, 'POST'); assert.ok(path.startsWith('/repos/'+TARGET+'/') || path === '/graphql', 'no source writes');
    if (path === `/repos/${TARGET}/git/blobs`) {
      if (options.blobFailure) throw new Error(TOKEN);
      const bytes = Buffer.from(body.content, 'base64'); const sha = hash(bytes); blobs.set(sha, bytes); return response({ sha }, 201);
    }
    if (path === `/repos/${TARGET}/git/trees`) {
      assert.deepEqual(body.tree.map(entry => entry.path), ['README.md']); const files = new Map(trees.get(body.base_tree));
      for (const entry of body.tree) files.set(entry.path, blobs.get(entry.sha));
      const sha = objectId(body); trees.set(sha, files); return response({ sha }, 201);
    }
    if (path === `/repos/${TARGET}/git/commits`) {
      assert.deepEqual(body.parents, [HEAD]); const sha = objectId(body); commits.set(sha, { sha, tree: { sha: body.tree } }); return response({ sha }, 201);
    }
    if (path === '/graphql') {
      assert.match(body.query, /^mutation CommitkinUpdateRefs/); const input = body.variables.input; assert.equal(input.repositoryId, 'R_target');
      assert.deepEqual(input.refUpdates, [{ name: 'refs/heads/main', beforeOid: HEAD, afterOid: input.refUpdates[0].afterOid, force: false }]);
      controls.casSubmitted = true;
      if (options.casRejected) return response({ message: TOKEN }, 422);
      controls.head = input.refUpdates[0].afterOid;
      if (options.casLost) throw new Error(TOKEN);
      return response({ data: { updateRefs: { clientMutationId: input.clientMutationId } } });
    }
    throw new TypeError('UNEXPECTED_MOCK_WRITE');
  }
  const run = createGithubProfileSync({ token: TOKEN, fetchImpl, clock: () => workflow().startedAt });
  return { run, fetchImpl, calls, value, targetFiles, sourceFiles, controls, stored: () => trees.get(commits.get(controls.head).tree.sha) };
}
const input = extra => ({ workflowContext: workflow(), sourceRepository: SOURCE, ...extra });
function assertSafeHold(report, code) {
  assert.equal(report.decision, 'hold', JSON.stringify(report)); if (code) assert.equal(report.code, code);
  assert.equal(report.growthRecordsChanged, false); assert.equal(report.progressionAuthorized, false); assert.equal(report.published, false); assert.doesNotMatch(JSON.stringify(report), new RegExp(TOKEN));
}
function assertOutsideSame(before, after) {
  const start = Buffer.from(START); const end = Buffer.from(END);
  assert.deepEqual(after.subarray(0, after.indexOf(start)+start.length), before.subarray(0, before.indexOf(start)+start.length));
  assert.deepEqual(after.subarray(after.indexOf(end)), before.subarray(before.indexOf(end)));
}

test('production profile sync defaults to dry run and reads only display JSON, PNG and target README at immutable heads', async () => {
  const mock = fixture(); const result = await mock.run(input());
  assert.equal(result.decision, 'prepared', JSON.stringify(result)); assert.equal(result.dryRun, true); assert.equal(result.filesPrepared, 1); assert.equal(result.profileChanged, false); assert.equal(result.growthRecordsChanged, false);
  assert.equal(mock.calls.every(call => call.method === 'GET'), true); assert.equal(mock.controls.head, HEAD);
  assert.equal(mock.calls.some(call => /state\.json|ledger\.json|status\.json|\/contents\/README\.md/.test(call.path) && call.path.startsWith('/repos/'+SOURCE)), false);
  const readPaths = mock.calls.filter(call => call.path.includes('/contents/')).map(call => call.path);
  assert.deepEqual(readPaths.sort(), [`/repos/${SOURCE}/contents/.commitkin/character.png`, `/repos/${SOURCE}/contents/.commitkin/profile.json`, `/repos/${TARGET}/contents/README.md`].sort());
  assert.equal(mock.calls.some(call => call.path.includes('/git/blobs/')), false);
});
test('bound ordinary author source supports the same projection/PNG dry-run and missing-data safety hold', async () => {
  const authorInput = { workflowContext: workflow({ repository: 'JEONTAK/JEONTAK', repositoryId: '773666201', ownerAccountId: PRODUCT_OWNER_ID, actorAccountId: PRODUCT_OWNER_ID }), sourceRepository: AUTHOR_STORAGE.fullName };
  const mock = fixture({ author: true }), before = [...mock.targetFiles];
  const result = await mock.run(authorInput);
  assert.equal(result.decision, 'prepared', JSON.stringify(result)); assert.equal(result.profileChanged, false);
  assert.equal(result.growthRecordsChanged, false); assert.equal(result.progressionAuthorized, false);
  assert.equal(mock.calls.every(call => call.method === 'GET'), true); assert.deepEqual([...mock.targetFiles], before);
  const writer = fixture({ author: true }), sourceBefore = [...writer.sourceFiles];
  const published = await writer.run({ ...authorInput, dryRun: false });
  assert.equal(published.decision, 'published', JSON.stringify(published)); assert.equal(published.growthRecordsChanged, false);
  assertOutsideSame(writer.targetFiles.get('README.md'), writer.stored().get('README.md'));
  assert.deepEqual([...writer.sourceFiles], sourceBefore);
  const missing = fixture({ author: true, changeTree(data, repo) { if (repo === AUTHOR_STORAGE.fullName) data.tree = data.tree.filter(entry => entry.path !== '.commitkin'); } });
  assertSafeHold(await missing.run(authorInput), 'PROFILE_SOURCE_DIRECTORY_INVALID');
  assert.equal(missing.calls.every(call => call.method === 'GET'), true);
  const rebound = fixture({ author: true, changeSource(data) { data.id += 1; } });
  assertSafeHold(await rebound.run(authorInput), 'PROFILE_SOURCE_BINDING_INVALID');
});

test('only explicit live mock capability publishes a single README CAS commit, preserving unrelated files and BOM/CRLF', async () => {
  const mock = fixture(); const result = await mock.run(input({ dryRun: false }));
  assert.equal(result.decision, 'published', JSON.stringify(result)); assert.equal(result.profileChanged, true); assert.equal(result.growthRecordsChanged, false); assert.equal(result.progressionAuthorized, false); assert.equal(result.publicationOutcome, 'published');
  const posts = mock.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 4); assert.equal(posts.filter(call => call.path === '/graphql').length, 1);
  assertOutsideSame(mock.targetFiles.get('README.md'), mock.stored().get('README.md'));
  for (const path of ['src/keep.txt', '.commitkin/state.json']) assert.deepEqual(mock.stored().get(path), mock.targetFiles.get(path));
  const markdown = mock.stored().get('README.md').toString('utf8');
  assert.match(markdown, new RegExp(`raw.githubusercontent.com/HeroA/commitkin/${SOURCE_HEAD}/.commitkin/character.png`));
  assert.doesNotMatch(markdown, /REMOTE_MARKDOWN_MUST_NOT_COPY|storageRepositoryId|accountId|sourceId/);
  assert.equal(mock.calls.at(-1).path, `/repos/${TARGET}/git/ref/heads/main`);
  assert.deepEqual(mock.sourceFiles.get('README.md'), Buffer.from('<script>REMOTE_MARKDOWN_MUST_NOT_COPY</script>'));
});

test('unchanged block invokes no writer even in explicit live mode', async () => {
  const { model } = modelAndPng(); const body = renderProfileMarkdown({ model, characterImageUrl: `https://raw.githubusercontent.com/${SOURCE}/${SOURCE_HEAD}/.commitkin/character.png` });
  const mock = fixture({ readme: updateManagedReadme(ORIGINAL, body) }); const result = await mock.run(input({ dryRun: false }));
  assert.equal(result.decision, 'unchanged', JSON.stringify(result)); assert.equal(result.filesPrepared, 0); assert.equal(mock.calls.some(call => call.method !== 'GET'), false); assert.equal(result.profileChanged, false);
});

test('byte-verified Git blob fallback supports source and README without following download URLs', async () => {
  const mock = fixture({ blobFallback: true }); const result = await mock.run(input()); assert.equal(result.decision, 'prepared', JSON.stringify(result));
  assert.equal(mock.calls.filter(call => call.path.includes('/git/blobs/')).length, 3); assert.equal(mock.calls.every(call => call.method === 'GET'), true);
});

for (const [label, context] of [['schedule', { eventName: 'schedule' }], ['pull request', { eventName: 'pull_request' }], ['other actor', { actorAccountId: '9999' }], ['enterprise host', { apiUrl: 'https://example.com' }], ['non-profile repo', { repository: SOURCE }], ['unsafe ID', { ownerAccountId: '0' }], ['bad time', { startedAt: 'yesterday' }], ['bad SHA', { sha: 'bad' }]]) {
  test(`trusted context rejects ${label} before any provider request`, async () => {
    const mock = fixture(); const result = await mock.run(input({ workflowContext: workflow(context) })); assertSafeHold(result, 'PROFILE_SYNC_CONTEXT_INVALID'); assert.deepEqual(mock.calls, []);
  });
}
for (const sourceRepository of [TARGET, 'Other/commitkin', 'https://github.com/HeroA/commitkin', 'HeroA/..', 'HeroA/a/b', 'HeroA/a?token='+TOKEN]) {
  test('source slug rejects unrelated/unsafe scope '+sourceRepository.replace(TOKEN, 'secret'), async () => {
    const mock = fixture(); const result = await mock.run(input({ sourceRepository })); assertSafeHold(result, 'PROFILE_SOURCE_REPOSITORY_INVALID'); assert.deepEqual(mock.calls, []);
  });
}
test('default source is same-owner commitkin, never arbitrary caller URL', async () => {
  const mock = fixture(); const result = await mock.run({ workflowContext: workflow() }); assert.equal(result.decision, 'prepared', JSON.stringify(result)); assert.ok(mock.calls.some(call => call.path === '/repos/'+SOURCE));
});

for (const [label, change] of [['private', data => { data.private = true; }], ['organization', data => { data.owner.type = 'Organization'; }], ['wrong owner', data => { data.owner.id = 9999; }], ['impostor product network', data => { data.source.id = 2; }], ['wrong upstream owner', data => { data.source.owner.id = 2; }], ['not fork', data => { data.fork = false; }], ['same durable target ID', data => { data.id = 9001; }], ['canonical name changed', data => { data.full_name = 'HeroA/other'; }]]) {
  test(`storage source rejects ${label}`, async () => {
    const mock = fixture({ changeSource: change }); const result = await mock.run(input({ dryRun: false })); assertSafeHold(result, 'PROFILE_SOURCE_BINDING_INVALID'); assert.equal(mock.calls.some(call => call.method !== 'GET'), false);
  });
}
for (const [label, change] of [['repository replacement', data => { data.id = 9999; }], ['owner replacement', data => { data.owner.id = 9999; }], ['private', data => { data.visibility = 'private'; }], ['not personal', data => { data.owner.type = 'Organization'; }]]) {
  test(`profile target rejects ${label}`, async () => {
    const mock = fixture({ changeTarget: change }); assertSafeHold(await mock.run(input()), 'PROFILE_TARGET_BINDING_INVALID'); assert.equal(mock.calls.length, 1);
  });
}

for (const [label, options, expected] of [
  ['changed target head', { targetHead: 'f'.repeat(40) }, 'PROFILE_TARGET_HEAD_CHANGED'],
  ['nondefault branch', {}, 'PROFILE_DEFAULT_BRANCH_REQUIRED'],
  ['invalid source head', { sourceHead: 'bad' }, 'PROFILE_SOURCE_HEAD_INVALID'],
  ['truncated tree', { changeTree: data => { data.truncated = true; } }, 'PROFILE_TREE_INCOMPLETE'],
  ['duplicate tree paths', { changeTree: data => { data.tree.push(data.tree[0]); } }, 'PROFILE_TREE_INCOMPLETE'],
  ['source directory symlink', { changeTree: (data, repo) => { if (repo === SOURCE) data.tree[0].mode = '120000'; } }, 'PROFILE_SOURCE_DIRECTORY_INVALID'],
  ['projection symlink', { changeTree: data => { const entry = data.tree.find(entry => entry.path === '.commitkin/profile.json'); if (entry) entry.mode = '120000'; } }, 'PROFILE_SOURCE_CONTENT_INVALID'],
  ['file hash mismatch', { changeContents: data => { data.sha = 'f'.repeat(40); } }, 'PROFILE_SOURCE_CONTENT_INVALID'],
  ['base64 tamper', { changeContents: data => { data.content = Buffer.from(TOKEN).toString('base64'); } }, 'PROFILE_SOURCE_CONTENT_INVALID'],
  ['noncanonical base64', { changeContents: data => { data.content = '!!!!'; } }, 'PROFILE_SOURCE_CONTENT_INVALID'],
  ['mismatched content size', { changeContents: data => { data.size += 1; } }, 'PROFILE_SOURCE_CONTENT_INVALID'],
  ['missing managed markers', { readme: '# personal content' }, 'PROFILE_SYNC_UNAVAILABLE'],
  ['duplicate managed markers', { readme: ORIGINAL+START }, 'PROFILE_SYNC_UNAVAILABLE'],
  ['UTF8 README invalid', { readmeBytes: Buffer.from([0xff, 0xfe]) }, 'PROFILE_README_INVALID'],
]) {
  test(`fixed snapshot validation holds on ${label}`, async () => {
    const mock = fixture(options); const request = label === 'nondefault branch' ? input({ workflowContext: workflow({ ref: 'refs/heads/other' }), dryRun: false }) : input({ dryRun: false });
    assertSafeHold(await mock.run(request), expected); assert.equal(mock.calls.some(call => call.method !== 'GET'), false);
  });
}

for (const [label, bytes] of [['duplicate keys', Buffer.from('{"schemaVersion":1,"schemaVersion":1}')], ['syntax', Buffer.from('{broken')], ['comments', Buffer.from('{/* no */}')], ['invalid UTF8', Buffer.from([255])], ['too large', Buffer.alloc(65537, 32)]]) {
  test('strict bounded projection rejects '+label, async () => {
    const mock = fixture({ profileBytes: bytes }); const result = await mock.run(input()); assertSafeHold(result); assert.ok(['PROFILE_MODEL_INVALID', 'PROFILE_SOURCE_CONTENT_INVALID'].includes(result.code));
  });
}
for (const [label, change, code] of [
  ['owner', model => { model.owner.accountId = '9999'; }, 'PROFILE_MODEL_BINDING_INVALID'],
  ['storage', model => { model.owner.storageRepositoryId = '9999'; }, 'PROFILE_MODEL_BINDING_INVALID'],
  ['username', model => { model.username = 'Other'; }, 'PROFILE_MODEL_BINDING_INVALID'],
  ['foreign Markdown', model => { model.readme = '<script>'+TOKEN+'</script>'; }, 'PROFILE_MODEL_INVALID'],
  ['tampered levels', model => { model.growth.level = '50'; }, 'PROFILE_MODEL_INVALID'],
  ['future observation', model => { model.analysis.evaluatedAt = '2026-10-17T00:00:00Z'; }, 'PROFILE_MODEL_TIME_INVALID'],
  ['submillisecond future observation', model => { model.analysis.evaluatedAt = '2026-10-16T01:00:00.000001Z'; }, 'PROFILE_MODEL_TIME_INVALID'],
  ['image hash', model => { model.character.sha256 = '0'.repeat(64); }, 'PROFILE_CHARACTER_INVALID'],
]) {
  test('projection binding/consistency rejects '+label, async () => {
    const mock = fixture({ changeModel: change }); assertSafeHold(await mock.run(input({ dryRun: false })), code); assert.equal(mock.calls.some(call => call.method !== 'GET'), false);
  });
}
test('source pending never erases an existing profile or fabricates zero XP/class', async () => {
  const mock = fixture({ pending: true }); const result = await mock.run(input({ dryRun: false })); assertSafeHold(result, 'PROFILE_SOURCE_ANALYSIS_PENDING'); assert.equal(result.profileChanged, false);
  assert.equal(mock.calls.some(call => call.method !== 'GET'), false); assert.deepEqual(mock.stored().get('README.md'), Buffer.from(ORIGINAL)); assert.doesNotMatch(JSON.stringify(result), /totalXp|adventurer/);
});
test('ready partial projection retains truthful freshness and unknown gap labels', async () => {
  const mock = fixture({ changeModel: model => { model.analysis.dataStatus = 'partial'; model.analysis.hasUnobservedGaps = true; } });
  const result = await mock.run(input({ dryRun: false })); assert.equal(result.decision, 'published', JSON.stringify(result));
  const readme = mock.stored().get('README.md').toString('utf8'); assert.match(readme, /Partial current data/); assert.match(readme, /2026-10-15T01:00:00Z/); assert.match(readme, /Unobserved gaps remain unknown/); assert.doesNotMatch(readme, /Complete for the last successful/);
});
test('non-PNG or wrong-size image cannot be accepted through matching owner/model metadata', async () => {
  for (const png of [Buffer.from('<svg onload="bad"/>'), encodePng(canvas(1, 1, [0, 0, 0, 0]))]) {
    const mock = fixture({ png, changeModel: model => { model.character.sha256 = createHash('sha256').update(png).digest('hex'); } }); assertSafeHold(await mock.run(input()), 'PROFILE_CHARACTER_INVALID');
  }
});
test('matching image digest cannot hide PNG corruption, truncation or trailing data', async () => {
  const { png } = modelAndPng(); const corrupt = Buffer.from(png); corrupt[corrupt.length - 1] ^= 1;
  for (const bytes of [corrupt, png.subarray(0, 33), Buffer.concat([png, Buffer.from('<script>never</script>')])]) {
    const mock = fixture({ png: bytes, changeModel: model => { model.character.sha256 = createHash('sha256').update(bytes).digest('hex'); } });
    assertSafeHold(await mock.run(input()), 'PROFILE_CHARACTER_INVALID');
  }
});

for (const [label, options, changed, outcome] of [
  ['confirmed', {}, true, 'published'], ['lost CAS with confirmed ref', { casLost: true }, true, 'published'],
  ['CAS unknown', { casLost: true, readbackFailure: true }, null, 'outcome_unknown'],
  ['unconfirmed success', { readbackFailure: true }, null, 'outcome_unknown'], ['CAS conflict', { casRejected: true }, false, 'not_published'],
  ['failed pre-CAS object', { blobFailure: true }, false, 'not_published'],
  ['owner replaced before writing', { changeTarget: (data, read) => { if (read > 1) data.owner.id = 9999; } }, false, 'not_published'],
]) {
  test(`profile publication preserves ${label} tri-state without claiming growth mutation`, async () => {
    const mock = fixture(options); const result = await mock.run(input({ dryRun: false }));
    assert.equal(result.profileChanged, changed, JSON.stringify(result)); assert.equal(result.publicationOutcome, outcome); assert.equal(result.growthRecordsChanged, false); assert.equal(result.progressionAuthorized, false); assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
    assert.equal(mock.calls.filter(call => call.path === '/graphql').length, ['failed pre-CAS object', 'owner replaced before writing'].includes(label) ? 0 : 1);
  });
}

test('pure use case does not construct writer in default dry run or unchanged mode', async () => {
  let constructed = 0; const { model } = modelAndPng();
  const base = { decision: 'acquired', model, readme: ORIGINAL, characterImageUrl: 'safe', target: { expectedOwnerAccountId: OWNER_ID, expectedRepositoryId: TARGET_ID, expectedHead: HEAD } };
  const ports = { acquire: async () => base, render: () => 'safe', updateReadme: () => 'new', createPublisher: () => { constructed += 1; throw new Error(TOKEN); } };
  assert.equal((await createProfileSyncUseCase(ports)(input())).decision, 'prepared'); assert.equal(constructed, 0);
  assert.equal((await createProfileSyncUseCase({ ...ports, updateReadme: () => ORIGINAL })(input({ dryRun: false }))).decision, 'unchanged'); assert.equal(constructed, 0);
});
test('ambiguous injected publisher/exception cannot become a false unchanged claim', async () => {
  const { model } = modelAndPng();
  const base = { decision: 'acquired', model, readme: ORIGINAL, characterImageUrl: 'safe', target: { expectedOwnerAccountId: OWNER_ID, expectedRepositoryId: TARGET_ID, expectedHead: HEAD } };
  for (const result of [null, {}, { published: true, actualRecordsChanged: false }, { published: false, actualRecordsChanged: false, publicationOutcome: 'outcome_unknown' }]) {
    const report = await createProfileSyncUseCase({ acquire: async () => base, render: () => 'safe', updateReadme: () => 'new', createPublisher: () => ({ publish: async () => result }) })(input({ dryRun: false }));
    assertSafeHold(report); assert.equal(report.profileChanged, null); assert.equal(report.publicationOutcome, 'outcome_unknown');
  }
  const report = await createProfileSyncUseCase({ acquire: async () => base, render: () => 'safe', updateReadme: () => 'new', createPublisher: () => ({ publish: async () => { throw new Error(TOKEN); } }) })(input({ dryRun: false })); assertSafeHold(report); assert.equal(report.profileChanged, null);
});
test('README-only publication rejects growth/config/extra files before HTTP', async () => {
  let requests = 0; const publisher = createGithubProfilePublisher({ token: TOKEN, fetchImpl: async () => { requests += 1; throw new Error(TOKEN); } });
  const binding = { repository: TARGET, defaultBranch: 'main', expectedHead: HEAD, expectedRepositoryId: TARGET_ID, expectedOwnerAccountId: OWNER_ID };
  for (const files of [[{ path: '.commitkin/state.json', content: Buffer.from('{}') }], [{ path: 'README.md', content: Buffer.from('x') }, { path: '.commitkin/profile.json', content: Buffer.from('{}') }]]) {
    const result = await publisher.publish({ ...binding, files }); assert.equal(result.code, 'PUBLICATION_INPUT_INVALID'); assert.equal(result.actualRecordsChanged, false);
  }
  assert.equal(requests, 0);
});
test('acquisition requires supplied read port and rejects malformed contexts without global fetch', async () => {
  assert.equal((await acquireProfileSync({ client: null, workflowContext: workflow() })).code, 'PROFILE_SYNC_CONTEXT_INVALID');
  assert.throws(() => createGithubProfileSync({ token: TOKEN, fetchImpl: null }), /OPTIONS/);
});

for (const [label, changes, args = []] of [['outside Actions', { GITHUB_ACTIONS: '' }], ['schedule forbidden', { GITHUB_EVENT_NAME: 'schedule' }], ['invalid boolean', { COMMITKIN_DRY_RUN: 'TRUE' }], ['args forbidden', {}, ['--live']]]) {
  test('profile CLI fails closed before network: '+label, () => {
    const env = { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_TOKEN: TOKEN, ...changes };
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/commitkin-profile-sync.mjs', import.meta.url)), ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr); const report = JSON.parse(result.stdout); assertSafeHold(report, 'PROFILE_ACTION_CONTEXT_INVALID'); assert.equal(report.profileChanged, false);
  });
}
test('profile CLI with trusted manual env uses mocked GET only and defaults to dry-run prepared', () => {
  const { model, png } = modelAndPng(); const profile = Buffer.from(JSON.stringify(model)); const readme = Buffer.from(ORIGINAL);
  const entry = (path, bytes) => ({ path, mode: '100644', type: 'blob', sha: hash(bytes), size: bytes.length });
  const content = (path, bytes) => ({ type: 'file', path, sha: hash(bytes), size: bytes.length, encoding: 'base64', content: bytes.toString('base64') });
  const routes = {
    ['/repos/'+TARGET]: metadata(), ['/repos/'+SOURCE]: metadata(true),
    [`/repos/${TARGET}/git/ref/heads/main`]: { object: { sha: HEAD } }, [`/repos/${SOURCE}/git/ref/heads/main`]: { object: { sha: SOURCE_HEAD } },
    [`/repos/${TARGET}/git/commits/${HEAD}`]: { sha: HEAD, tree: { sha: TREE } }, [`/repos/${SOURCE}/git/commits/${SOURCE_HEAD}`]: { sha: SOURCE_HEAD, tree: { sha: SOURCE_TREE } },
    [`/repos/${TARGET}/git/trees/${TREE}?recursive=1`]: { sha: TREE, truncated: false, tree: [entry('README.md', readme)] },
    [`/repos/${SOURCE}/git/trees/${SOURCE_TREE}?recursive=1`]: { sha: SOURCE_TREE, truncated: false, tree: [{ path: '.commitkin', mode: '040000', type: 'tree', sha: SOURCE_TREE }, entry('.commitkin/profile.json', profile), entry('.commitkin/character.png', png)] },
    [`/repos/${TARGET}/contents/README.md?ref=${HEAD}`]: content('README.md', readme),
    [`/repos/${SOURCE}/contents/.commitkin/profile.json?ref=${SOURCE_HEAD}`]: content('.commitkin/profile.json', profile),
    [`/repos/${SOURCE}/contents/.commitkin/character.png?ref=${SOURCE_HEAD}`]: content('.commitkin/character.png', png),
  };
  const program = `const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : ['2026-10-16T01:00:00Z'])); } };
    const routes = ${JSON.stringify(routes)};
    globalThis.fetch = async (url, options) => { const u = new URL(url); if (u.origin !== 'https://api.github.com' || options.method !== 'GET' || !Object.hasOwn(routes, u.pathname+u.search)) throw new Error('UNEXPECTED_MOCK_REQUEST'); return new Response(JSON.stringify(routes[u.pathname+u.search])); };
    process.argv = [process.execPath, 'synthetic-profile-cli']; await import(${JSON.stringify(new URL('../bin/commitkin-profile-sync.mjs', import.meta.url).href)});`;
  const context = workflow(); const env = { PATH: process.env.PATH, GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: context.eventName, GITHUB_TOKEN: TOKEN,
    GITHUB_SERVER_URL: context.serverUrl, GITHUB_API_URL: context.apiUrl, GITHUB_REPOSITORY: context.repository, GITHUB_REPOSITORY_ID: context.repositoryId,
    GITHUB_REPOSITORY_OWNER_ID: context.ownerAccountId, GITHUB_ACTOR_ID: context.actorAccountId, GITHUB_REF: context.ref, GITHUB_SHA: context.sha };
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.decision, 'prepared'); assert.equal(report.dryRun, true); assert.equal(report.profileChanged, false); assert.equal(report.growthRecordsChanged, false);
});
