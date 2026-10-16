import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { parseStrictJson } from '../../../../record-validator/src/infrastructure/strict-json.js';
import { createProfileSyncUseCase } from '../../application/sync-profile.mjs';
import { compareTimestamps } from '../../domain/character/activity.mjs';
import { updateManagedReadme } from '../../presentation/readme.mjs';
import { validateProfileModel, renderProfileMarkdown } from '../../presentation/profile.mjs';
import { usesApprovedCharacter } from '../../presentation/character-art.mjs';
import { createGithubClient } from './client.mjs';
import { createGithubProfilePublisher } from './publication.mjs';
import { isCommitkinStorageRepository } from './storage.mjs';

const SHA = /^[a-f0-9]{40}$/;
const ID = /^[1-9][0-9]*$/;
const LOGIN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const LIMITS = Object.freeze({ 'README.md': 1048576, '.commitkin/profile.json': 65536, '.commitkin/character.png': 8 * 1048576 });
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index; for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0;
});
const fail = code => ({ decision: 'hold', code, progressionAuthorized: false });
const id = value => typeof value === 'string' && ID.test(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
function repositoryName(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 2 && LOGIN.test(parts[0]) && /^[a-z0-9_.-]{1,100}$/i.test(parts[1]) && !['.', '..'].includes(parts[1]);
}
function branchName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !/[^a-zA-Z0-9_./-]|\.\.|\/\/|^\/|\/$|\.$/.test(value) && value.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock'));
}
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function contextValid(value) {
  return value && value.serverUrl === 'https://github.com' && value.apiUrl === 'https://api.github.com' && value.eventName === 'workflow_dispatch' &&
    repositoryName(value.repository) && value.repository.split('/')[0].toLowerCase() === value.repository.split('/')[1].toLowerCase() &&
    ['repositoryId', 'ownerAccountId', 'actorAccountId'].every(key => typeof value[key] === 'string' && ID.test(value[key])) &&
    value.ownerAccountId === value.actorAccountId && typeof value.ref === 'string' && SHA.test(value.sha ?? '') && timestamp(value.startedAt);
}
function publicMetadata(data, repository, ownerId) {
  return data && id(data.id) !== null && id(data.owner?.id) === ownerId && data.owner?.type === 'User' && data.private === false && (!data.visibility || data.visibility === 'public') &&
    typeof data.full_name === 'string' && data.full_name.toLowerCase() === repository.toLowerCase() && repositoryName(data.full_name) &&
    typeof data.owner.login === 'string' && LOGIN.test(data.owner.login) && typeof data.name === 'string' && data.full_name === data.owner.login + '/' + data.name && branchName(data.default_branch);
}
async function snapshot(client, repository, head) {
  const root = '/repos/' + repository;
  const commit = await client.get(`${root}/git/commits/${head}`);
  if (!commit.ok || commit.data?.sha !== head || !SHA.test(commit.data?.tree?.sha ?? '')) return null;
  const tree = await client.get(`${root}/git/trees/${commit.data.tree.sha}?recursive=1`);
  if (!tree.ok || tree.data?.sha !== commit.data.tree.sha || tree.data.truncated !== false || !Array.isArray(tree.data.tree)) return null;
  const entries = new Map();
  for (const entry of tree.data.tree) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.isWellFormed() || entries.has(entry.path)) return null;
    entries.set(entry.path, entry);
  }
  return entries;
}
function decodeBlob(data, entry, limit) {
  if (!data || data.sha !== entry.sha || data.size !== entry.size || data.encoding !== 'base64' || typeof data.content !== 'string' || data.content.length > 4 * Math.ceil(limit / 3) + 2 * Math.ceil(limit / 45) + 128 || !/^[A-Za-z0-9+/=\r\n]*$/.test(data.content)) throw new TypeError('PROFILE_CONTENT_INVALID');
  const encoded = data.content.replace(/[\r\n]/g, '');
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new TypeError('PROFILE_CONTENT_INVALID');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== entry.size || bytes.length > limit || bytes.toString('base64') !== encoded || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== entry.sha) throw new TypeError('PROFILE_CONTENT_INVALID');
  return new Uint8Array(bytes);
}
async function fileAtHead(client, repository, head, entries, path) {
  const limit = LIMITS[path]; const entry = entries.get(path);
  if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode) || !SHA.test(entry.sha ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > limit) throw new TypeError('PROFILE_CONTENT_INVALID');
  const root = '/repos/' + repository;
  const response = await client.get(`${root}/contents/${path}?` + new URLSearchParams({ ref: head }));
  if (!response.ok || response.data?.type !== 'file' || response.data.path !== path || response.data.sha !== entry.sha || response.data.size !== entry.size) throw new TypeError('PROFILE_CONTENT_INVALID');
  let data = response.data;
  if (data.encoding === 'none') {
    const blob = await client.get(`${root}/git/blobs/${entry.sha}`);
    if (!blob.ok) throw new TypeError('PROFILE_CONTENT_INVALID');
    data = blob.data;
  }
  return decodeBlob(data, entry, limit);
}
function pngMatches(bytes, model) {
  const data = Buffer.from(bytes);
  const header = data.length >= 33 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.readUInt32BE(8) === 13 && data.toString('ascii', 12, 16) === 'IHDR' && data.readUInt32BE(16) === model.character.width && data.readUInt32BE(20) === model.character.height &&
    data[24] === 8 && data[25] === 6 && data[26] === 0 && data[27] === 0 && data[28] === 0 &&
    createHash('sha256').update(bytes).digest('hex') === model.character.sha256;
  if (!header) return false;
  // Only the exact hash-pinned approved original may carry its caBX provenance.
  // Other images retain the strict static, metadata-free legacy PNG contract.
  const allowedChunks = usesApprovedCharacter(model) ? ['caBX', 'IDAT', 'IEND'] : ['IDAT', 'IEND'];
  let offset = 8; let chunks = 0; let ended = false; const compressed = [];
  while (offset + 12 <= data.length && chunks < 128) {
    const length = data.readUInt32BE(offset); const end = offset + length + 12;
    if (end > data.length) return false;
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (chunks === 0 ? type !== 'IHDR' : !allowedChunks.includes(type)) return false;
    let crc = 0xffffffff;
    for (const byte of data.subarray(offset + 4, end - 4)) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
    if (((crc ^ 0xffffffff) >>> 0) !== data.readUInt32BE(end - 4)) return false;
    if (type === 'IDAT') compressed.push(data.subarray(offset + 8, end - 4));
    if (type === 'IEND') { if (length !== 0 || end !== data.length) return false; ended = true; }
    offset = end; chunks += 1;
    if (ended) break;
  }
  if (!ended || compressed.length === 0) return false;
  const stride = model.character.width * 4 + 1; const expected = model.character.height * stride;
  try {
    const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
    return raw.length === expected && Array.from({ length: model.character.height }, (_, row) => raw[row * stride]).every(filter => filter <= 4);
  } catch { return false; }
}

/** Only fixed metadata/tree/blob GETs; remote Markdown and executable code are never read. */
export async function acquireProfileSync({ client, workflowContext, sourceRepository }) {
  try {
    if (!client || typeof client.get !== 'function' || !contextValid(workflowContext)) return fail('PROFILE_SYNC_CONTEXT_INVALID');
    const context = { ...workflowContext };
    const requestedSource = sourceRepository === undefined ? context.repository.split('/')[0] + '/commitkin' : sourceRepository;
    if (!repositoryName(requestedSource) || requestedSource.split('/')[0].toLowerCase() !== context.repository.split('/')[0].toLowerCase() || requestedSource.toLowerCase() === context.repository.toLowerCase()) return fail('PROFILE_SOURCE_REPOSITORY_INVALID');
    const targetResponse = await client.get('/repos/' + context.repository);
    if (!targetResponse.ok || !publicMetadata(targetResponse.data, context.repository, context.ownerAccountId) || id(targetResponse.data.id) !== context.repositoryId || targetResponse.data.owner.login.toLowerCase() !== targetResponse.data.name.toLowerCase()) return fail('PROFILE_TARGET_BINDING_INVALID');
    const target = structuredClone(targetResponse.data);
    if (context.ref !== 'refs/heads/' + target.default_branch) return fail('PROFILE_DEFAULT_BRANCH_REQUIRED');
    const targetHead = await client.get(`/repos/${target.full_name}/git/ref/heads/${target.default_branch.split('/').map(encodeURIComponent).join('/')}`);
    if (!targetHead.ok || targetHead.data?.object?.sha !== context.sha) return fail('PROFILE_TARGET_HEAD_CHANGED');
    const sourceResponse = await client.get('/repos/' + requestedSource);
    if (!sourceResponse.ok || !publicMetadata(sourceResponse.data, requestedSource, context.ownerAccountId) || !isCommitkinStorageRepository(sourceResponse.data) || id(sourceResponse.data.id) === context.repositoryId) return fail('PROFILE_SOURCE_BINDING_INVALID');
    const source = structuredClone(sourceResponse.data);
    const sourceRef = await client.get(`/repos/${source.full_name}/git/ref/heads/${source.default_branch.split('/').map(encodeURIComponent).join('/')}`);
    const sourceHead = sourceRef.data?.object?.sha;
    if (!sourceRef.ok || !SHA.test(sourceHead ?? '')) return fail('PROFILE_SOURCE_HEAD_INVALID');
    const sourceEntries = await snapshot(client, source.full_name, sourceHead);
    const targetEntries = await snapshot(client, target.full_name, context.sha);
    if (!sourceEntries || !targetEntries) return fail('PROFILE_TREE_INCOMPLETE');
    const directory = sourceEntries.get('.commitkin');
    if (!directory || directory.mode !== '040000' || directory.type !== 'tree') return fail('PROFILE_SOURCE_DIRECTORY_INVALID');
    const profileBytes = await fileAtHead(client, source.full_name, sourceHead, sourceEntries, '.commitkin/profile.json');
    let model;
    try { model = validateProfileModel(parseStrictJson(profileBytes, 'status')); }
    catch { return fail('PROFILE_MODEL_INVALID'); }
    if (model.owner.accountId !== context.ownerAccountId || model.owner.storageRepositoryId !== id(source.id) || model.username.toLowerCase() !== target.owner.login.toLowerCase()) return fail('PROFILE_MODEL_BINDING_INVALID');
    if (model.analysis.phase !== 'ready') return fail('PROFILE_SOURCE_ANALYSIS_PENDING');
    if (!timestamp(model.analysis.evaluatedAt) || compareTimestamps(model.analysis.evaluatedAt, context.startedAt) > 0 || model.analysis.cutoffExclusive > context.startedAt.slice(0, 10)) return fail('PROFILE_MODEL_TIME_INVALID');
    const character = await fileAtHead(client, source.full_name, sourceHead, sourceEntries, '.commitkin/character.png');
    if (!pngMatches(character, model)) return fail('PROFILE_CHARACTER_INVALID');
    const readmeBytes = await fileAtHead(client, target.full_name, context.sha, targetEntries, 'README.md');
    let readme;
    try { readme = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(readmeBytes); }
    catch { return fail('PROFILE_README_INVALID'); }
    return { decision: 'acquired', code: 'PROFILE_DISPLAY_VERIFIED', model, readme,
      characterImageUrl: `https://raw.githubusercontent.com/${source.full_name}/${sourceHead}/.commitkin/character.png`,
      target: { repository: target.full_name, defaultBranch: target.default_branch, expectedHead: context.sha,
        expectedRepositoryId: context.repositoryId, expectedOwnerAccountId: context.ownerAccountId }, progressionAuthorized: false };
  } catch { return fail('PROFILE_SOURCE_CONTENT_INVALID'); }
}

/** A writer is constructed only after explicit live mode and a changed valid block. */
export function createGithubProfileSync({ token, fetchImpl, clock = () => new Date().toISOString() }) {
  if (typeof fetchImpl !== 'function' || typeof clock !== 'function') throw new TypeError('PROFILE_SYNC_OPTIONS_INVALID');
  const client = createGithubClient({ token, fetchImpl: (url, options) => {
    if (options.method !== 'GET') throw new TypeError('PROFILE_READ_ONLY_CAPABILITY');
    return fetchImpl(url, options);
  }, requestBudget: 50, timeoutMs: 10000, maxResponseBytes: 12 * 1048576, maxRetries: 1 });
  return createProfileSyncUseCase({
    acquire: input => acquireProfileSync({ client, ...input }), render: renderProfileMarkdown, updateReadme: updateManagedReadme,
    createPublisher: () => createGithubProfilePublisher({ token, fetchImpl, requestBudget: 30, timeoutMs: 10000, maxResponseBytes: 8 * 1048576, maxRetries: 0 }),
  });
}
