import { createTransport } from './transport.mjs';
import { isCommitkinStorageRepository } from './storage.mjs';

const PATHS = ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/card.png', 'README.md'];
const FORK_PATHS = ['.commitkin/state.json', '.commitkin/ledger.json', '.commitkin/status.json', '.commitkin/character.png', '.commitkin/profile.json'];
const SHA = /^[a-f0-9]{40}$/;
// Fixed mutation and variables only; no caller-supplied GraphQL document or weaker
// REST fallback. beforeOid is an atomic precondition for the complete ref update.
const UPDATE_REFS = 'mutation CommitkinUpdateRefs($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }';
function nodeId(value) { return typeof value === 'string' && value.length >= 1 && value.length <= 1024 && /^[A-Za-z0-9_+/=-]+$/.test(value); }
function hold(code, actualRecordsChanged = false) { return { published: false, decision: 'hold', code, actualRecordsChanged, publicationOutcome: actualRecordsChanged === null ? 'outcome_unknown' : 'not_published' }; }
function published(code, commitSha) { return { published: true, decision: 'published', code, commitSha, actualRecordsChanged: true, publicationOutcome: 'published' }; }
function repositoryName(value) { return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/i.test(value) && !value.endsWith('/.') && !value.endsWith('/..'); }
function branchName(value) { return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[^a-zA-Z0-9_./-]|\.\.|\/\/|^\/|\/$|\.$/.test(value) && value.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock')); }

/** Explicit write capability. This module performs no request until publish is called. */
export function createGithubPublisher(options) {
  return createFixedPublisher(options, false);
}
/** A separate capability: this writer can never mutate growth/config/image paths. */
export function createGithubProfilePublisher(options) {
  return createFixedPublisher(options, true);
}
function createFixedPublisher(options, profileOnly) {
  const transport = createTransport(options);
  async function publish({ repository, defaultBranch, expectedHead, expectedRepositoryId, expectedOwnerAccountId, files }) {
    let casAttempted = false;
    try {
    const ceilings = { '.commitkin/state.json': 1024 * 1024, '.commitkin/ledger.json': 32 * 1024 * 1024, '.commitkin/status.json': 65536, '.commitkin/card.png': 8 * 1024 * 1024, '.commitkin/character.png': 8 * 1024 * 1024, '.commitkin/profile.json': 65536, 'README.md': 1024 * 1024 };
    const groups = profileOnly ? [['README.md']] : [PATHS, FORK_PATHS];
    const matchedPaths = Array.isArray(files) ? groups.find(paths => files.length === paths.length && new Set(files.map(item => item?.path)).size === paths.length && files.every(item => paths.includes(item?.path))) : null;
    if (!repositoryName(repository) || !branchName(defaultBranch) || typeof expectedHead !== 'string' || !SHA.test(expectedHead) || !matchedPaths || !files.every(item => item.content instanceof Uint8Array && item.content.length > 0 && item.content.length <= ceilings[item.path])) return hold('PUBLICATION_INPUT_INVALID');
    for (const file of files) {
      const text = new TextDecoder().decode(file.content);
      if (text.includes(options.token) || !file.path.endsWith('.png') && text.includes('-----BEGIN PRIVATE KEY-----')) return hold('PUBLICATION_SENSITIVE_CONTENT');
    }
    // Defensive copy prevents callers changing prepared bytes while awaiting HTTP.
    const prepared = files.map(file => ({ path: file.path, content: new Uint8Array(file.content) })).sort((left, right) => left.path < right.path ? -1 : 1);
    const root = '/repos/' + repository;
    const ref = `${root}/git/ref/heads/${defaultBranch.split('/').map(encodeURIComponent).join('/')}`;
    const metadata = await transport.request('GET', root);
    if (!metadata.ok) return hold(metadata.code);
    const stableId = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    if (expectedRepositoryId !== undefined && (!stableId(expectedRepositoryId) || stableId(metadata.data?.id) !== expectedRepositoryId) || expectedOwnerAccountId !== undefined && (!stableId(expectedOwnerAccountId) || stableId(metadata.data?.owner?.id) !== expectedOwnerAccountId)) return hold('PUBLICATION_OWNER_BINDING_MISMATCH');
    if (metadata.data.default_branch !== defaultBranch || metadata.data.private !== false || metadata.data.visibility && metadata.data.visibility !== 'public') return hold('PUBLICATION_REPOSITORY_MISMATCH');
    if (matchedPaths === FORK_PATHS && (!isCommitkinStorageRepository(metadata.data) || metadata.data.owner.login?.toLowerCase() === metadata.data.name?.toLowerCase())) return hold('PUBLICATION_REPOSITORY_MISMATCH');
    if ((profileOnly || matchedPaths === PATHS) && (metadata.data.owner?.type !== 'User' || typeof metadata.data.owner.login !== 'string' || typeof metadata.data.name !== 'string' || metadata.data.owner.login.toLowerCase() !== metadata.data.name.toLowerCase() || metadata.data.full_name?.toLowerCase() !== repository.toLowerCase())) return hold('PUBLICATION_REPOSITORY_MISMATCH');
    // Global node IDs are opaque: check the bounded wire form and obtain the ID
    // only from this repository's successful metadata response, never from input.
    if (!nodeId(metadata.data.node_id)) return hold('REPOSITORY_NODE_ID_INVALID');
    const head = await transport.request('GET', ref);
    if (!head.ok) return hold(head.code);
    if (head.data?.object?.sha !== expectedHead) return hold('REMOTE_CHANGED');
    const base = await transport.request('GET', `${root}/git/commits/${expectedHead}`);
    if (!base.ok) return hold(base.code);
    if (!SHA.test(base.data?.tree?.sha ?? '')) return hold('REMOTE_COMMIT_INVALID');
    const tree = [];
    for (const file of prepared) {
      const blob = await transport.request('POST', `${root}/git/blobs`, { content: Buffer.from(file.content).toString('base64'), encoding: 'base64' });
      if (!blob.ok) return hold(blob.code);
      if (!SHA.test(blob.data?.sha ?? '')) return hold('REMOTE_BLOB_INVALID');
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.data.sha });
    }
    const built = await transport.request('POST', `${root}/git/trees`, { base_tree: base.data.tree.sha, tree });
    if (!built.ok) return hold(built.code);
    if (!SHA.test(built.data?.sha ?? '')) return hold('REMOTE_TREE_INVALID');
    const commit = await transport.request('POST', `${root}/git/commits`, { message: profileOnly ? 'chore: sync Commitkin profile display' : 'chore: update Commitkin character', tree: built.data.sha, parents: [expectedHead] });
    if (!commit.ok) return hold(commit.code);
    if (!SHA.test(commit.data?.sha ?? '')) return hold('REMOTE_COMMIT_INVALID');
    // Avoid an unnecessary mutation if the branch has already changed. The
    // GraphQL beforeOid precondition still protects the remaining race atomically.
    const stillCurrent = await transport.request('GET', ref);
    if (!stillCurrent.ok) return hold(stillCurrent.code);
    if (stillCurrent.data?.object?.sha !== expectedHead) return hold('REMOTE_CHANGED');
    const input = { repositoryId: metadata.data.node_id, clientMutationId: 'commitkin-' + commit.data.sha,
      refUpdates: [{ name: 'refs/heads/' + defaultBranch, beforeOid: expectedHead, afterOid: commit.data.sha, force: false }] };
    casAttempted = true;
    const updated = await transport.request('POST', '/graphql', { query: UPDATE_REFS, variables: { input } });
    // A mutation is never retried. Even its nominal success needs authoritative
    // ref readback; a timeout is reconciled by reading, not by repeating the write.
    const confirmation = await transport.request('GET', ref);
    const confirmed = confirmation.ok && confirmation.data?.object?.sha === commit.data.sha;
    if (updated.ok && Object.hasOwn(updated.data ?? {}, 'errors') && (!Array.isArray(updated.data.errors) || updated.data.errors.length > 0)) return confirmed ? published('PUBLISHED_READBACK_CONFIRMED', commit.data.sha) : hold('GRAPHQL_MUTATION_REJECTED', null);
    if (!updated.ok) {
      const ambiguous = updated.code === 'WRITE_OUTCOME_UNKNOWN' || updated.status >= 500 || updated.status >= 200 && updated.status < 300;
      if (ambiguous && confirmed) return published('PUBLISHED_READBACK_CONFIRMED', commit.data.sha);
      const rejected = updated.code === 'REQUEST_BUDGET_EXHAUSTED' || updated.status >= 400 && updated.status < 500;
      return hold(updated.code === 'REMOTE_CONFLICT' ? 'REMOTE_CHANGED' : updated.code, rejected ? false : null);
    }
    if (updated.data?.data?.updateRefs?.clientMutationId !== input.clientMutationId) return confirmed ? published('PUBLISHED_READBACK_CONFIRMED', commit.data.sha) : hold('GRAPHQL_RESULT_INVALID', null);
    if (!confirmed) return hold('PUBLICATION_RESULT_UNCONFIRMED', null);
    return published('PUBLISHED', commit.data.sha);
    } catch { return hold('PUBLICATION_UNAVAILABLE', casAttempted ? null : false); }
  }
  return Object.freeze({ publish, budget: transport.budget });
}
