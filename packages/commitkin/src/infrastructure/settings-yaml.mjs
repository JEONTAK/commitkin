import { normalizeSettings } from '../domain/settings.mjs';

/** Deliberately small YAML subset for the approved settings contract. No tags, aliases, scripts or implicit types. */
export function parseSettings(bytes, { previouslyUsed = false, firstInstallVerified = false } = {}) {
  if (bytes === null) {
    if (previouslyUsed || !firstInstallVerified) throw new TypeError('SETTINGS_CONFIRMATION_REQUIRED');
    return normalizeSettings({ version: 1, repositories: { additional: [], exclude: [] } });
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65536) throw new TypeError('SETTINGS_INPUT_INVALID');
  let source;
  try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new TypeError('SETTINGS_UTF8_INVALID'); }
  if (source.startsWith('\uFEFF') || !source.isWellFormed()) throw new TypeError('SETTINGS_INVALID');
  const result = { version: null, repositories: { additional: [], exclude: [] } };
  const seen = new Set();
  let section = null;
  for (const raw of source.split(/\r?\n/)) {
    if (/\t/.test(raw)) throw new TypeError('SETTINGS_INVALID');
    // Quoted names cannot contain # under owner/repo grammar. Only whole-line/trailing comments supported.
    const line = raw.replace(/\s+#.*$/, '').trimEnd();
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (line === 'version: 1') { if (seen.has('version')) throw new TypeError('SETTINGS_DUPLICATE'); seen.add('version'); result.version = 1; section = null; continue; }
    if (line === 'repositories:') { if (seen.has('repositories')) throw new TypeError('SETTINGS_DUPLICATE'); seen.add('repositories'); section = null; continue; }
    const key = /^  (additional|exclude):(?: (\[\]))?$/.exec(line);
    if (key && seen.has('repositories')) {
      if (seen.has(key[1])) throw new TypeError('SETTINGS_DUPLICATE');
      seen.add(key[1]); section = key[2] ? null : key[1]; continue;
    }
    const item = /^    - (.+)$/.exec(line);
    if (!item || !section) throw new TypeError('SETTINGS_INVALID');
    let value = item[1];
    if (/^'[^']*'$/.test(value)) value = value.slice(1, -1);
    else if (/^"[^"\\]*"$/.test(value)) value = value.slice(1, -1);
    result.repositories[section].push(value);
  }
  if (!seen.has('version') || !seen.has('repositories')) throw new TypeError('SETTINGS_INVALID');
  return normalizeSettings(result);
}
