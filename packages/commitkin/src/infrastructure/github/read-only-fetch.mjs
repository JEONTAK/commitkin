import { CLOSING_ISSUES_QUERY } from './client.mjs';

/** Even transport regressions cannot turn an analysis query into a mutation. */
export function readOnlyGithubFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('READ_ONLY_TRANSPORT_INVALID');
  return function fetchReadonly(url, options) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new TypeError('READ_ONLY_DESTINATION_INVALID'); }
    if (parsed.origin !== 'https://api.github.com' || parsed.username || parsed.password || parsed.hash) throw new TypeError('READ_ONLY_DESTINATION_INVALID');
    if (options?.method === 'GET') return fetchImpl(url, options);
    if (options?.method === 'POST' && parsed.href === 'https://api.github.com/graphql') {
      let body;
      try { body = JSON.parse(options.body); } catch { throw new TypeError('READ_ONLY_QUERY_INVALID'); }
      if (Object.keys(body).sort().join(',') === 'operationName,query,variables' && body.operationName === 'CommitkinClosingIssues' && body.query === CLOSING_ISSUES_QUERY) return fetchImpl(url, options);
    }
    throw new TypeError('READ_ONLY_CAPABILITY');
  };
}
