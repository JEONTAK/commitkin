/** Pure, lossless XP/appearance arithmetic. No persistence or source qualification. */
function natural(value, minimum = 0n) {
  const text = typeof value === 'bigint' ? value.toString() : typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)$/.test(text) || BigInt(text) < minimum) throw new TypeError('INVALID_GROWTH_INTEGER');
  return BigInt(text);
}

function threshold(level) {
  const previous = level - 1n;
  return 100n * previous + 25n * previous * (previous - 1n) / 2n;
}

export function xpForLevel(level) { return threshold(natural(level, 1n)).toString(); }

export function levelForXp(totalXp) {
  const xp = natural(totalXp);
  let low = 1n;
  let high = 2n;
  while (threshold(high) <= xp) high *= 2n;
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (threshold(middle) <= xp) low = middle;
    else high = middle;
  }
  return low.toString();
}

export function levelProgress(totalXp) {
  const xp = natural(totalXp);
  const level = BigInt(levelForXp(xp));
  const start = threshold(level);
  const required = 100n + 25n * (level - 1n);
  return {
    level: level.toString(), totalXp: xp.toString(), levelStartXp: start.toString(),
    xpIntoLevel: (xp - start).toString(), xpForNextLevel: required.toString(),
    xpRemaining: (required - (xp - start)).toString(),
  };
}

const REGULAR_CLASSES = new Set([
  'blacksmith', 'machinist', 'runesmith', 'golemancer', 'warden', 'shield-knight', 'paladin', 'wardkeeper',
  'scribe', 'librarian', 'chronicler', 'lorekeeper', 'sentinel', 'wardweaver', 'rune-examiner', 'sealbinder',
  'healer', 'alchemist', 'purifier', 'restorer', 'herald', 'quartermaster', 'guild-steward', 'guild-commander',
]);

export function appearanceForLevel({ classId, level }) {
  const value = natural(level, 1n);
  if (classId === 'adventurer') return { stageIndex: 0, unlockedAt: 1, nextAppearanceAt: null, fixed: true, finalStage: false };
  if (!REGULAR_CLASSES.has(classId)) throw new TypeError('INVALID_CLASS_ID');
  const stageIndex = value >= 50n ? 10 : Number(value / 5n);
  return {
    stageIndex, unlockedAt: stageIndex === 0 ? 1 : stageIndex * 5,
    nextAppearanceAt: stageIndex === 10 ? null : (stageIndex + 1) * 5,
    fixed: false, finalStage: stageIndex === 10,
  };
}
