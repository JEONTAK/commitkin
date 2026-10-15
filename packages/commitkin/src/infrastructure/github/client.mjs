import { checkedNextLink, createTransport } from './transport.mjs';

/** Capability contains GET only. Supply fetch explicitly; construction makes no request. */
export function createGithubClient(options) {
  const transport = createTransport(options);
  async function get(path) { return transport.request('GET', path); }
  async function paginate(path, { maxPages = 10 } = {}) {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) return { ok: false, complete: false, code: 'PAGINATION_OPTIONS_INVALID', items: [] };
    let next = path;
    const seen = new Set(); const items = [];
    for (let page = 0; page < maxPages; page += 1) {
      if (seen.has(next)) return { ok: false, complete: false, code: 'PAGINATION_CYCLE', items };
      seen.add(next);
      const result = await get(next);
      if (!result.ok) return { ...result, complete: false, items };
      if (!Array.isArray(result.data)) return { ok: false, complete: false, code: 'PAGINATION_RESPONSE_INVALID', items };
      items.push(...result.data);
      const link = checkedNextLink(result.link, next);
      if (!link.ok) return { ...link, complete: false, items };
      if (link.next === null) return { ok: true, complete: true, code: 'CAPTURED', items, pages: page + 1 };
      next = link.next;
    }
    return { ok: false, complete: false, code: 'PAGE_LIMIT_REACHED', items, pages: maxPages };
  }
  return Object.freeze({ get, paginate, budget: transport.budget });
}
