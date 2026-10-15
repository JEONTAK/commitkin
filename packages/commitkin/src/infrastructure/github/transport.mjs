import { parseStrictJson } from '../../../../record-validator/src/infrastructure/strict-json.js';

const API = 'https://api.github.com';
const MAX_BUDGET = 10000;
function boundedInteger(value, minimum, maximum) { return Number.isSafeInteger(value) && value >= minimum && value <= maximum; }
function safeFailure(code, status = null) { return { ok: false, code, status }; }
function pathUrl(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\\\s#\x00-\x1f]/u.test(path)) return null;
  // Encoded separators/traversal are dangerous in endpoint paths, not in query
  // values. A branch such as release/main must remain usable as sha=release%2Fmain.
  const pathname = path.split('?')[0];
  if (/%(?:2e|2f|5c)/i.test(pathname) || pathname.split('/').some(segment => segment === '..' || segment === '.')) return null;
  try {
    const url = new URL(path, API);
    return url.origin === API && !url.username && !url.password && !url.hash && !/%(?:2e|2f|5c)/i.test(url.pathname) ? url : null;
  } catch { return null; }
}
function exactIdNumbers(value) {
  if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) return false;
  return !value || typeof value !== 'object' || Object.values(value).every(exactIdNumbers);
}
async function boundedResponse(response, maximum) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || BigInt(length) > BigInt(maximum))) throw new Error('RESPONSE_TOO_LARGE');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new Error('RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Internal transport. Read-only clients never expose the write request closure. */
export function createTransport({ token, fetchImpl, requestBudget = 300, timeoutMs = 10000, maxResponseBytes = 8 * 1024 * 1024, maxRetries = 2, waitImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (typeof token !== 'string' || token.length < 8 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token) || typeof fetchImpl !== 'function' || typeof waitImpl !== 'function' ||
    !boundedInteger(requestBudget, 1, MAX_BUDGET) || !boundedInteger(timeoutMs, 1, 60000) || !boundedInteger(maxResponseBytes, 1, 32 * 1024 * 1024) || !boundedInteger(maxRetries, 0, 3)) throw new TypeError('GITHUB_OPTIONS_INVALID');
  let used = 0;
  async function waitForRetry(attempt) { try { await waitImpl(Math.min(1000 * 2 ** attempt, 4000)); return true; } catch { return false; } }
  async function request(method, path, body) {
    const url = pathUrl(path);
    if (!url || !['GET', 'POST', 'PATCH'].includes(method)) return safeFailure('GITHUB_DESTINATION_REJECTED');
    for (let attempt = 0; ; attempt += 1) {
      if (used >= requestBudget) return safeFailure('REQUEST_BUDGET_EXHAUSTED');
      used += 1;
      const abort = new AbortController();
      let rejectDeadline;
      const deadline = new Promise((resolve, reject) => { rejectDeadline = reject; });
      const timer = setTimeout(() => { abort.abort(); rejectDeadline(new Error('REQUEST_TIMEOUT')); }, timeoutMs);
      let response;
      try {
        response = await Promise.race([fetchImpl(url.href, { method, redirect: 'error', signal: abort.signal,
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Commitkin', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), deadline]);
        if (!response || response.redirected || (response.url && new URL(response.url).href !== url.href) || response.status >= 300 && response.status < 400) return safeFailure('REDIRECT_REJECTED', response?.status ?? null);
        if (method === 'GET' && [502, 503, 504].includes(response.status) && attempt < maxRetries) { await response.body?.cancel(); if (!await waitForRetry(attempt)) return safeFailure('RETRY_WAIT_UNAVAILABLE'); continue; }
        if (response.status < 200 || response.status >= 300) {
          const code = response.status === 404 ? 'REPOSITORY_UNAVAILABLE' : response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0' ? 'RATE_LIMITED' : response.status === 403 ? 'ACCESS_DENIED' : response.status === 422 || response.status === 409 ? 'REMOTE_CONFLICT' : 'HTTP_UNAVAILABLE';
          await response.body?.cancel();
          return safeFailure(code, response.status);
        }
        const bytes = await Promise.race([boundedResponse(response, maxResponseBytes), deadline]);
        let data;
        try { data = parseStrictJson(bytes, 'ledger'); } catch { return safeFailure('RESPONSE_JSON_INVALID', response.status); }
        if (!exactIdNumbers(data)) return safeFailure('UNSAFE_JSON_INTEGER', response.status);
        return { ok: true, status: response.status, data, link: response.headers.get('link') };
      } catch (error) {
        if (error?.message === 'RESPONSE_TOO_LARGE') return safeFailure('RESPONSE_TOO_LARGE', response?.status ?? null);
        if (method === 'GET' && attempt < maxRetries) { if (!await waitForRetry(attempt)) return safeFailure('RETRY_WAIT_UNAVAILABLE'); continue; }
        return safeFailure(method === 'GET' ? 'NETWORK_UNAVAILABLE' : 'WRITE_OUTCOME_UNKNOWN');
      } finally { clearTimeout(timer); }
    }
  }
  return Object.freeze({ request, budget: () => ({ used, remaining: requestBudget - used, limit: requestBudget }) });
}

function paginationPathnames(previous, binding) {
  if (binding === undefined) return new Set([previous.pathname]);
  if (!binding || typeof binding !== 'object' || Array.isArray(binding) || Object.keys(binding).some(key => !['initialPath', 'repositoryId', 'subjectAccountId'].includes(key))) return null;
  const initial = pathUrl(binding.initialPath);
  if (!initial || (binding.repositoryId !== undefined) === (binding.subjectAccountId !== undefined)) return null;
  const id = binding.repositoryId ?? binding.subjectAccountId;
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,127}$/.test(id)) return null;
  let alias;
  if (binding.repositoryId !== undefined) {
    const named = /^\/repos\/[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}(\/.+)$/i.exec(initial.pathname);
    const numeric = /^\/repositories\/([1-9][0-9]*)(\/.+)$/.exec(initial.pathname);
    if (named) alias = '/repositories/' + id + named[1];
    else if (numeric && numeric[1] === id) alias = initial.pathname;
    else return null;
  } else {
    // These are the two public per-user list endpoints used by discovery. A
    // stable user ID does not authorize aliases for arbitrary account APIs.
    const named = /^\/users\/[a-z0-9][a-z0-9-]{0,38}(\/repos|\/events\/public)$/i.exec(initial.pathname);
    const numeric = /^\/user\/([1-9][0-9]*)(\/repos|\/events\/public)$/.exec(initial.pathname);
    if (named) alias = '/user/' + id + named[1];
    else if (numeric && numeric[1] === id) alias = initial.pathname;
    else return null;
  }
  const allowed = new Set([initial.pathname, alias]);
  return allowed.has(previous.pathname) ? allowed : null;
}

/** Optional aliases bind a previously verified stable ID to one initial suffix. */
export function checkedNextLink(header, previousPath, binding) {
  const previous = pathUrl(previousPath);
  if (!previous) return safeFailure('PAGINATION_DESTINATION_REJECTED');
  const allowedPaths = paginationPathnames(previous, binding);
  if (!allowedPaths) return safeFailure('PAGINATION_BINDING_INVALID');
  if (header === null || header === '') return { ok: true, next: null };
  if (typeof header !== 'string' || header.length > 16384) return safeFailure('PAGINATION_INVALID');
  const entries = header.split(/,\s*(?=<)/);
  let next = null;
  for (const entry of entries) {
    const match = /^<([^>]+)>;\s*rel="([a-z ]+)"\s*$/.exec(entry);
    if (!match) return safeFailure('PAGINATION_INVALID');
    let url;
    try { url = new URL(match[1]); } catch { return safeFailure('PAGINATION_INVALID'); }
    if (url.origin !== API || url.username || url.password || url.hash || !allowedPaths.has(url.pathname) || !pathUrl(url.pathname + url.search)) return safeFailure('PAGINATION_DESTINATION_REJECTED');
    const changing = binding === undefined ? ['page', 'cursor', 'after', 'before'] : ['page'];
    for (const [key, value] of previous.searchParams) if (!changing.includes(key) && (url.searchParams.getAll(key).length !== 1 || url.searchParams.get(key) !== value)) return safeFailure('PAGINATION_QUERY_CHANGED');
    for (const [key, value] of url.searchParams) if (!changing.includes(key) && (previous.searchParams.getAll(key).length !== 1 || previous.searchParams.get(key) !== value)) return safeFailure('PAGINATION_QUERY_CHANGED');
    if (match[2].split(' ').includes('next')) {
      if (next !== null) return safeFailure('PAGINATION_INVALID');
      if (binding !== undefined) {
        const oldPages = previous.searchParams.getAll('page'); const newPages = url.searchParams.getAll('page');
        if (oldPages.length > 1 || oldPages.length === 1 && !/^[1-9][0-9]{0,5}$/.test(oldPages[0]) || newPages.length !== 1 || !/^[1-9][0-9]{0,5}$/.test(newPages[0]) || Number(newPages[0]) !== Number(oldPages[0] ?? '1') + 1) return safeFailure('PAGINATION_PAGE_INVALID');
      }
      next = url.pathname + url.search;
    }
  }
  return { ok: true, next };
}
