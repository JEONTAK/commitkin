import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGithubClient, createReadonlyRefresh, createObservedReadonlyRefresh } from '../src/index.mjs';
import { AUTHOR_STORAGE, PRODUCT_OWNER_ID } from '../src/infrastructure/github/storage.mjs';
const hash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const owner = '1001', repositoryId = '9001', name = 'HeroA/HeroA', head = 'a'.repeat(40), tree = 'b'.repeat(40);
const workflowContext = { serverUrl: 'https://github.com', apiUrl: 'https://api.github.com', eventName: 'workflow_dispatch', repository: name, repositoryId, ownerAccountId: owner, actorAccountId: owner, ref: 'refs/heads/main', sha: head, startedAt: '2026-10-15T01:00:00Z' };
const metadata = { id: 9001, owner: { id: 1001, login: 'HeroA', type: 'User' }, name: 'HeroA', full_name: name, visibility: 'public', private: false, fork: false, archived: false, default_branch: 'main' };
function fixture({ prior = null, bom = false, fork = false, missingReadme = false, author = false } = {}) {
  const name = author ? 'JEONTAK/JEONTAK' : 'HeroA/HeroA';
  const login = name.split('/')[0];
  const installation = author ? AUTHOR_STORAGE.fullName : 'HeroA/commitkin';
  const owner = author ? PRODUCT_OWNER_ID : '1001', repositoryId = author ? AUTHOR_STORAGE.repositoryId : '9001';
  const baseMetadata = author ? { ...metadata, id: Number(repositoryId), owner: { id: Number(owner), login, type: 'User' }, name: login, full_name: name } : metadata;
  const stored = new Map([
    ['README.md', Buffer.from('# My profile\n\n<!-- COMMITKIN:START -->\n<!-- COMMITKIN:END -->\n\nKeep this text.\n')],
    ['.github/commitkin.yml', Buffer.from('version: 1\nrepositories:\n  additional: []\n  exclude:\n    - heroa/heroa\n')],
  ]);
  const repositoryMetadata = author ? { ...baseMetadata, name: 'commitkin-character', full_name: installation, fork: false } : fork ? { ...metadata, name: 'commitkin', full_name: installation, fork: true, source: { id: 1420061458, owner: { id: 76037656 } } } : metadata;
  if (fork || author) stored.set('.github/commitkin.yml', Buffer.from('version: 1\nrepositories:\n  additional: []\n  exclude:\n    - ' + installation.toLowerCase() + '\n'));
  if (missingReadme) stored.delete('README.md');
  if (bom) stored.set('README.md', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), stored.get('README.md')]));
  if (prior) for (const role of ['state', 'ledger', 'status']) stored.set('.commitkin/' + role + '.json', Buffer.from(JSON.stringify(prior[role])));
  const requests = [];
  const client = createGithubClient({ token: 'synthetic-token-only', maxRetries: 0, fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); requests.push(url);
    const parsed = new URL(url), path = fork || author ? parsed.pathname.replace('/repos/' + installation, '/repos/' + name).replace('/repos/' + installation.toLowerCase(), '/repos/' + name.toLowerCase()) : parsed.pathname;
    let data;
    if (path.toLowerCase() === '/repos/' + name.toLowerCase()) data = repositoryMetadata;
    else if (path === '/repos/' + name + '/git/ref/heads/main') data = { object: { sha: head } };
    else if (path === '/repos/' + name + '/git/commits/' + head) data = { sha: head, tree: { sha: tree } };
    else if (path === '/repos/' + name + '/git/trees/' + tree) data = { sha: tree, truncated: false, tree: [
      { path: '.github', mode: '040000', type: 'tree', sha: 'c'.repeat(40) },
      ...(prior ? [{ path: '.commitkin', mode: '040000', type: 'tree', sha: 'd'.repeat(40) }] : []),
      ...[...stored].map(([file, content]) => ({ path: file, mode: '100644', type: 'blob', sha: hash(content), size: content.length })),
    ] };
    else if (path.startsWith('/repos/' + name + '/contents/')) {
      assert.equal(parsed.searchParams.get('ref'), head);
      const file = path.slice(('/repos/' + name + '/contents/').length), content = stored.get(file);
      assert.ok(content); data = { type: 'file', path: file, sha: hash(content), size: content.length, encoding: 'base64', content: content.toString('base64') };
    }
    else if (path === '/repos/' + name + '/commits') { assert.ok(parsed.searchParams.get('path')); data = prior ? [{ sha: head }] : []; }
    else if (path === '/users/' + login + '/repos') data = [repositoryMetadata];
    else if (path === '/users/' + login + '/events/public') data = [];
    else throw new TypeError('UNEXPECTED_MOCK_REQUEST');
    return new Response(JSON.stringify(data), { status: 200 });
  } });
  return { client, requests, stored, context: { ...workflowContext, repository: author || fork ? installation : name, repositoryId, ownerAccountId: owner, actorAccountId: owner }, owner };
}
test('actual GET-only composition acquires fixed-head first setup, discovers excluded empty scope and prepares five bytes without writing', async () => {
  const input = fixture(), before = [...input.stored].map(([path, bytes]) => [path, Buffer.from(bytes)]);
  const run = createReadonlyRefresh({ client: input.client, clock: () => '2026-10-15T01:01:00Z' });
  const result = await run({ workflowContext, initialSelection: { accountId: owner, factionId: 'bloomguard', confirmation: 'CONFIRM_PERMANENT_FACTION' } });
  assert.equal(result.decision, 'prepared', JSON.stringify(result));
  assert.equal(result.files.length, 5); assert.equal(result.summary.totalXp, '0');
  assert.equal(result.summary.knownRepositories, 0); assert.equal(result.candidate.state.class.id, 'adventurer');
  assert.equal(result.verification.decision, 'accept_relative_to_evidence');
  assert.equal(result.progressionAuthorized, false); assert.equal(result.published, false);
  assert.deepEqual([...input.stored], before); assert.equal(input.requests.length, input.client.budget().used);
});
test('actual fixed-head refresh reuses valid records and retains same-date successful timestamp', async () => {
  const firstFixture = fixture(), initial = await createReadonlyRefresh({ client: firstFixture.client, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext, initialSelection: { accountId: owner, factionId: 'ashbound', confirmation: 'CONFIRM_PERMANENT_FACTION' } });
  assert.equal(initial.decision, 'prepared');
  const next = fixture({ prior: initial.candidate });
  const result = await createReadonlyRefresh({ client: next.client, clock: () => '2026-10-15T02:01:00Z' })({ workflowContext: { ...workflowContext, startedAt: '2026-10-15T02:00:00Z' } });
  assert.equal(result.decision, 'unchanged', JSON.stringify(result)); assert.deepEqual(result.files, []);
  assert.deepEqual(result.candidate, initial.candidate); assert.equal(result.progressionAuthorized, false);
  const origin = next.requests.filter(url => url.includes('?path=')); assert.equal(origin.length, 1); assert.ok(origin[0].includes('path=.commitkin%2Fstate.json'));
});
test('composition needs an explicit injected read-only client and clock', () => {
  for (const options of [{}, { client: {} }, { client: { get() {}, paginate() {} }, clock: null }]) assert.throws(() => createReadonlyRefresh(options), /REFRESH_PORTS_INVALID/);
});
test('UTF-8 BOM and every README byte outside the managed region survive the full acquisition/presentation path', async () => {
  const input = fixture({ bom: true }), original = input.stored.get('README.md');
  const result = await createReadonlyRefresh({ client: input.client, clock: () => '2026-10-15T01:01:00Z' })({ workflowContext, initialSelection: { accountId: owner, factionId: 'bloomguard', confirmation: 'CONFIRM_PERMANENT_FACTION' } });
  assert.equal(result.decision, 'prepared', JSON.stringify(result));
  const output = Buffer.from(result.files.find(file => file.path === 'README.md').content);
  const start = Buffer.from('<!-- COMMITKIN:START -->'), end = Buffer.from('<!-- COMMITKIN:END -->');
  assert.deepEqual(output.subarray(0, output.indexOf(start) + start.length), original.subarray(0, original.indexOf(start) + start.length));
  assert.deepEqual(output.subarray(output.indexOf(end)), original.subarray(original.indexOf(end)));
  assert.deepEqual([...output.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});
test('actual observed fork composition prepares growth plus a display projection, never profile or fork README writes', async () => {
  for (const factionId of ['bloomguard', 'ashbound']) for (const missingReadme of [false, true]) {
    const input = fixture({ fork: true, missingReadme });
    const before = [...input.stored].map(([path, content]) => [path, Buffer.from(content)]);
    const result = await createObservedReadonlyRefresh({ client: input.client, clock: () => '2026-10-15T01:01:00Z' })({
      workflowContext: { ...workflowContext, repository: 'HeroA/commitkin' },
      initialSelection: { accountId: owner, factionId, confirmation: 'CONFIRM_PERMANENT_FACTION' },
    });
    assert.equal(result.decision, 'prepared', JSON.stringify(result));
    assert.equal(result.verification.decision, 'accept_relative_to_capture');
    assert.deepEqual(result.files.map(file => file.path).sort(), ['.commitkin/character.png', '.commitkin/ledger.json', '.commitkin/profile.json', '.commitkin/state.json', '.commitkin/status.json']);
    const model = JSON.parse(Buffer.from(result.files.find(file => file.path === '.commitkin/profile.json').content));
    assert.deepEqual(model.owner, { accountId: owner, storageRepositoryId: repositoryId });
    assert.equal(result.candidate.state.faction.id, factionId); assert.equal(result.summary.totalXp, '0');
    assert.deepEqual([...input.stored], before); assert.equal(result.published, false); assert.equal(result.progressionAuthorized, false);
    assert.equal(input.requests.some(url => new URL(url).pathname.toLowerCase().startsWith('/repos/heroa/heroa')), false);
  }
});
test('bound ordinary author installation uses the same read-only growth/display composition without a fork or README dependency', async () => {
  const input = fixture({ author: true, missingReadme: true });
  const before = [...input.stored].map(([path, content]) => [path, Buffer.from(content)]);
  const result = await createObservedReadonlyRefresh({ client: input.client, clock: () => '2026-10-15T01:01:00Z' })({
    workflowContext: input.context,
    initialSelection: { accountId: input.owner, factionId: 'ashbound', confirmation: 'CONFIRM_PERMANENT_FACTION' },
  });
  assert.equal(result.decision, 'prepared', JSON.stringify(result));
  assert.deepEqual(result.files.map(file => file.path).sort(), ['.commitkin/character.png', '.commitkin/ledger.json', '.commitkin/profile.json', '.commitkin/state.json', '.commitkin/status.json']);
  const model = JSON.parse(Buffer.from(result.files.find(file => file.path === '.commitkin/profile.json').content));
  assert.deepEqual(model.owner, { accountId: PRODUCT_OWNER_ID, storageRepositoryId: AUTHOR_STORAGE.repositoryId });
  assert.equal(result.published, false); assert.equal(result.progressionAuthorized, false);
  assert.deepEqual([...input.stored], before);
  assert.equal(input.requests.some(url => new URL(url).pathname.startsWith('/repos/JEONTAK/JEONTAK')), false);
});
