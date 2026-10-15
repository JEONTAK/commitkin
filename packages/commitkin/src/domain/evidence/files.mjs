import { createHash } from 'node:crypto';

/** Shared deterministic file rules; no source collection or publication authority. */
export class FileEvidenceFailure extends Error {
  constructor(code, decision = 'hold', temporal = false) { super(code); this.code = code; this.decision = decision; this.temporal = temporal; }
}
function demand(condition, code, decision = 'hold') { if (!condition) throw new FileEvidenceFailure(code, decision); }
function blobHash(text, oid) {
  demand(typeof text === 'string' && text.isWellFormed() && typeof oid === 'string' && [40, 64].includes(oid.length), 'FILE_CONTENT_OID_MISMATCH', 'rejected');
  const bytes = new TextEncoder().encode(text);
  return createHash(oid.length === 40 ? 'sha1' : 'sha256').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function glob(pattern, path) {
  demand(typeof pattern === 'string' && pattern.length > 0, 'POLICY_BODY_UNSUPPORTED');
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') { expression += '(?:.*/)?'; index += 2; }
      else { expression += '.*'; index += 1; }
    } else if (char === '*') expression += '[^/]*';
    else if (char === '?') expression += '[^/]';
    else expression += char.replace(/[\^$.*+?()[\]{}|\\]/g, '\\$&');
  }
  return new RegExp(expression + '$', 'u').test(path);
}

/** New observed model's fixed catalog; the historical registry remains unchanged. */
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const OBSERVED_FILE_RULES = freeze({
  version: '1', exclusions: [
    { kind: 'generated', patterns: ['dist/**', 'build/**', 'coverage/**', 'vendor/**', 'node_modules/**', '**/*.generated.*', '**/*.min.js'] },
    { kind: 'lock', patterns: ['**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/Cargo.lock', '**/Gemfile.lock', '**/poetry.lock'] },
    { kind: 'card_update', patterns: ['.commitkin/**'] },
  ], categories: [
    { category: 'deployment', patterns: ['deploy/**', 'deployment/**', 'infra/**', 'terraform/**', '**/Dockerfile', '**/Dockerfile.*', '**/docker-compose*.yml', '.github/workflows/deploy*.yml', '.github/workflows/deploy*.yaml'] },
    { category: 'test', patterns: ['test/**', 'tests/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/test_*.py'] },
    { category: 'documentation', patterns: ['docs/**', '**/*.md', '**/*.mdx', '**/*.rst'] },
    { category: 'source', patterns: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.py', '**/*.java', '**/*.kt', '**/*.go', '**/*.rs', '**/*.c', '**/*.cpp', '**/*.h', '**/*.cs', '**/*.rb', '**/*.php', '**/*.swift', '**/*.vue', '**/*.svelte', '**/package.json', '**/tsconfig.json', '**/tsconfig.*.json', '**/jsconfig.json', '**/jsconfig.*.json'] },
  ], precedence: ['deployment', 'test', 'documentation', 'source'],
});

export function classifyPath({ path, ruleBody }) {
  demand(typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..') && !/[\\\u0000]/u.test(path), 'FILE_PATH_UNSUPPORTED');
  if (ruleBody.exclusions.some(rule => rule.patterns.some(pattern => glob(pattern, path)))) return 'excluded';
  for (const category of ruleBody.precedence) if (ruleBody.categories.some(rule => rule.category === category && rule.patterns.some(pattern => glob(pattern, path)))) return category;
  return 'unmatched';
}

function managedReadmeOnly(before, after) {
  const begin = '<!-- COMMITKIN:START -->'; const end = '<!-- COMMITKIN:END -->';
  const outside = value => {
    const first = value.indexOf(begin); const last = value.indexOf(end);
    if (first < 0 || last < first || value.indexOf(begin, first + begin.length) !== -1 || value.indexOf(end, last + end.length) !== -1 || /<!--\s*COMMITKIN(?::|\s)/i.test(value.replace(begin, '').replace(end, ''))) return null;
    return value.slice(0, first + begin.length) + value.slice(last);
  };
  const a = outside(before); return a !== null && a === outside(after);
}

/** sourceFamily defaults to the legacy historical-proof hold, preserving that API. */
export function classifyFileEvidence({ files, ruleBody, sourceFamily = 'unsupported', unknownPolicy = 'hold', excludeManagedReadmeUpdates = false, exclude = () => {} }) {
  const families = new Set();
  for (const file of files) {
    const path = file.afterPath ?? file.beforePath;
    const category = classifyPath({ path, ruleBody });
    if (category === 'excluded') { exclude('EXCLUDED_FILE'); continue; }
    if (category === 'unmatched' && unknownPolicy === 'exclude') { exclude('UNRECOGNIZED_FILE'); continue; }
    demand(file.content?.mode === 'text_pair', 'FILE_CONTENT_PROOF_UNAVAILABLE');
    for (const side of ['before', 'after']) {
      const text = file.content[side + 'Text']; const oid = file[side + 'Oid'];
      demand(oid === null ? text === null : typeof text === 'string' && blobHash(text, oid) === oid, 'FILE_CONTENT_OID_MISMATCH', 'rejected');
    }
    const before = file.content.beforeText ?? ''; const after = file.content.afterText ?? '';
    demand(typeof before === 'string' && typeof after === 'string', 'FILE_CONTENT_PROOF_UNAVAILABLE');
    if (excludeManagedReadmeUpdates && path === 'README.md' && managedReadmeOnly(before, after)) { exclude('MANAGED_README_ONLY_CHANGE'); continue; }
    if (before.replace(/\s/gu, '') === after.replace(/\s/gu, '')) { exclude('WHITESPACE_ONLY_CHANGE'); continue; }
    demand(category !== 'unmatched', 'FILE_CATEGORY_UNSUPPORTED');
    if (category === 'source') {
      if (sourceFamily === 'unsupported') throw new FileEvidenceFailure('BUG_TEMPORAL_PROOF_UNSUPPORTED', 'hold', true);
      demand(['craft', 'recovery'].includes(sourceFamily), 'POLICY_BODY_UNSUPPORTED'); families.add(sourceFamily);
    } else families.add({ deployment: 'operations', test: 'verification', documentation: 'knowledge' }[category]);
  }
  return ['craft', 'knowledge', 'verification', 'recovery', 'operations'].filter(family => families.has(family));
}
