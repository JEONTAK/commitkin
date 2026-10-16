import test from 'node:test';
import assert from 'node:assert/strict';
import { isCommitkinStorageRepository, isCommitkinPreviewRepository } from '../src/infrastructure/github/storage.mjs';
import { createGithubPublisher, createGithubProfilePublisher } from '../src/infrastructure/github/publication.mjs';

const HEAD = 'a'.repeat(40), AFTER = 'e'.repeat(40), TOKEN = 'synthetic-fork-token';
const metadata = () => ({ id: 9001, node_id: 'R_ForkFixture', name: 'commitkin', full_name: 'Owner/commitkin', private: false, visibility: 'public', default_branch: 'main',
  owner: { id: 1001, login: 'Owner', type: 'User' }, fork: true, source: { id: 1420061458, owner: { id: 76037656 } } });
const files = () => ['state.json', 'ledger.json', 'status.json', 'character.png', 'profile.json'].map(file => ({ path: '.commitkin/' + file, content: Buffer.from(file) }));
const request = () => ({ repository: 'Owner/commitkin', defaultBranch: 'main', expectedHead: HEAD, expectedRepositoryId: '9001', expectedOwnerAccountId: '1001', files: files() });
function fixture(change = {}) {
  const calls = []; let current = HEAD;
  const publisher = createGithubPublisher({ token: TOKEN, maxRetries: 0, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method, body });
    let data;
    if (path === '/repos/Owner/commitkin') data = { ...metadata(), ...change };
    else if (path.endsWith('/git/ref/heads/main')) data = { object: { sha: current } };
    else if (path.endsWith('/git/commits/' + HEAD)) data = { sha: HEAD, tree: { sha: 'b'.repeat(40) } };
    else if (path.endsWith('/git/blobs')) data = { sha: 'c'.repeat(40) };
    else if (path.endsWith('/git/trees')) data = { sha: 'd'.repeat(40) };
    else if (path.endsWith('/git/commits')) data = { sha: AFTER };
    else if (path === '/graphql') { current = AFTER; data = { data: { updateRefs: { clientMutationId: body.variables.input.clientMutationId } } }; }
    else throw new Error('UNEXPECTED_MOCK_PATH');
    return new Response(JSON.stringify(data), { status: 200 });
  } });
  return { publisher, calls };
}
test('storage roots use durable network/owner IDs across rename, not names or loose numeric coercion', () => {
  assert.equal(isCommitkinStorageRepository(metadata()), true);
  const upstream = { ...metadata(), id: 1420061458, owner: { id: 76037656, type: 'User' }, fork: false, source: null };
  assert.equal(isCommitkinStorageRepository(upstream), false); assert.equal(isCommitkinPreviewRepository(upstream), true);
  assert.equal(isCommitkinPreviewRepository(metadata()), true); assert.equal(isCommitkinPreviewRepository({ ...upstream, private: true }), false);
  for (const change of [{ private: true }, { visibility: 'internal' }, { fork: false }, { source: null }, { owner: { type: 'Organization' } }, { source: { id: 1420061458 } }, { source: { id: '01420061458', owner: { id: 76037656 } } }, { id: 1420061458 }]) assert.equal(isCommitkinStorageRepository({ ...metadata(), ...change }), false);
});
test('the product upstream can preview but can never publish owner records inherited by future forks', async () => {
  const legacy = ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/card.png', 'README.md'].map(path => ({ path, content: Buffer.from('fixture') }));
  for (const paths of [files(), legacy]) {
    const input = fixture({ id: 1420061458, owner: { id: 76037656, login: 'Owner', type: 'User' }, fork: false, source: null });
    const result = await input.publisher.publish({ ...request(), files: paths, expectedRepositoryId: '1420061458', expectedOwnerAccountId: '76037656' });
    assert.equal(result.code, 'UPSTREAM_PREVIEW_ONLY'); assert.equal(result.actualRecordsChanged, false);
    assert.equal(input.calls.some(call => call.method === 'POST'), false);
  }
});
test('fork publication is exactly three records, character PNG and safe display model in one atomic group', async () => {
  const input = fixture(), result = await input.publisher.publish(request());
  assert.equal(result.published, true); assert.equal(result.commitSha, AFTER);
  const tree = input.calls.find(call => call.path.endsWith('/git/trees')).body;
  assert.equal(tree.base_tree, 'b'.repeat(40)); assert.deepEqual(tree.tree.map(item => item.path).sort(), files().map(file => file.path).sort());
  assert.equal(tree.tree.some(item => item.path === 'README.md' || item.path.startsWith('.github/')), false);
  const mutation = input.calls.find(call => call.path === '/graphql').body.variables.input;
  assert.equal(mutation.refUpdates[0].beforeOid, HEAD); assert.equal(mutation.refUpdates[0].force, false);
});
test('fork writer rejects mixed layouts, arbitrary paths, duplicate paths and partial bundles before HTTP', async () => {
  for (const replacement of [files().slice(1), [...files(), { path: 'README.md', content: Buffer.from('x') }], files().map((file, index) => index === 4 ? { ...file, path: 'README.md' } : file), files().map((file, index) => index === 4 ? files()[0] : file)]) {
    const input = fixture(); assert.equal((await input.publisher.publish({ ...request(), files: replacement })).code, 'PUBLICATION_INPUT_INVALID'); assert.equal(input.calls.length, 0);
  }
});
test('fork mutation rejects unrelated or rebound repositories before preparing blobs', async () => {
  for (const change of [{ id: 9002 }, { fork: false }, { source: { id: 999, owner: { id: 76037656 } } }, { name: 'Owner' }]) {
    const input = fixture(change); assert.equal((await input.publisher.publish(request())).published, false); assert.equal(input.calls.some(call => call.method === 'POST'), false);
  }
});
test('profile-only publisher cannot be repurposed for growth, image or settings writes', async () => {
  let calls = 0; const publisher = createGithubProfilePublisher({ token: TOKEN, fetchImpl: async () => { calls += 1; throw new Error('NO_NETWORK'); } });
  for (const content of [files(), [{ path: '.github/commitkin.yml', content: Buffer.from('x') }], [{ path: '.commitkin/character.png', content: Buffer.from('x') }]]) {
    assert.equal((await publisher.publish({ ...request(), files: content })).code, 'PUBLICATION_INPUT_INVALID');
  }
  assert.equal(calls, 0);
});
test('even a complete legacy five-file bundle cannot mutate the fork README', async () => {
  const input = fixture();
  const legacy = ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/card.png', 'README.md'].map(path => ({ path, content: Buffer.from('fixture') }));
  const result = await input.publisher.publish({ ...request(), files: legacy });
  assert.equal(result.code, 'PUBLICATION_REPOSITORY_MISMATCH'); assert.equal(result.actualRecordsChanged, false);
  assert.equal(input.calls.some(call => call.method === 'POST'), false);
});
