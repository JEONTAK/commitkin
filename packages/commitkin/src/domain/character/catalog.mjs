// Approved display identities and mechanics. This is not source qualification.
export const FAMILIES = Object.freeze(['craft', 'guard', 'knowledge', 'verification', 'recovery', 'operations']);
export const CLASS_ROWS = Object.freeze({
  craft: ['blacksmith', 'machinist', 'runesmith', 'golemancer'],
  guard: ['warden', 'shield-knight', 'paladin', 'wardkeeper'],
  knowledge: ['scribe', 'librarian', 'chronicler', 'lorekeeper'],
  verification: ['sentinel', 'wardweaver', 'rune-examiner', 'sealbinder'],
  recovery: ['healer', 'alchemist', 'purifier', 'restorer'],
  operations: ['herald', 'quartermaster', 'guild-steward', 'guild-commander'],
});
export const CLASS_FAMILY = Object.freeze(Object.fromEntries(Object.entries(CLASS_ROWS).flatMap(([family, ids]) => ids.map(id => [id, family]))));
export const MINIMA = Object.freeze({ craft: [6, 4, 2, 20], guard: [4, 3, 2, 12], knowledge: [4, 3, 2, 12], verification: [4, 3, 2, 12], recovery: [4, 3, 2, 12], operations: [3, 3, 1, 8] });
export const HABIT_PRIORITY = Object.freeze(['rekindled', 'versatile', 'focused', 'roaming', 'steadfast']);
export const ACTIVITY_PRIORITY = Object.freeze(['collaborative', 'documenting', 'testing', 'mending', 'finisher', 'shipping', 'organizing']);
export const FAMILY_TRAITS = Object.freeze({ craft: ['finisher'], guard: ['collaborative'], knowledge: ['documenting'], verification: ['testing'], recovery: ['mending'], operations: ['shipping', 'organizing'] });
export const ACHIEVEMENTS = Object.freeze([
  ['footprints', [10, 30, 100]], ['enduring-flame', [4, 12, 26]], ['completed-works', [1, 10, 50]],
  ['allys-shield', [1, 10, 50]], ['knowledge-vault', [5, 25, 100]], ['raised-wards', [5, 25, 100]],
  ['healing-hands', [1, 10, 30]], ['launch-bell', [1, 5, 20]], ['orderly-guild', [3, 15, 50]],
  ['far-horizons', [2, 5, 15]], ['old-hearth', [4, 12, 26]], ['class-codex', [1, 6, 24]],
]);
export const GRADES = Object.freeze(['bronze', 'silver', 'gold']);
export const CLASS_NAMES = Object.freeze({ adventurer: 'Adventurer', ...Object.fromEntries(Object.values(CLASS_ROWS).flat().map(id => [id, id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')])) });
export const FAMILY_NAMES = Object.freeze({ craft: 'Craft', guard: 'Guard', knowledge: 'Knowledge', verification: 'Verification', recovery: 'Recovery', operations: 'Operations' });
export const TRAIT_NAMES = Object.freeze(Object.fromEntries([...HABIT_PRIORITY, ...ACTIVITY_PRIORITY].map(id => [id, id[0].toUpperCase() + id.slice(1)])));
export const ACHIEVEMENT_NAMES = Object.freeze({
  footprints: 'Footprints', 'enduring-flame': 'Enduring Flame', 'completed-works': 'Completed Works',
  'allys-shield': 'Ally’s Shield', 'knowledge-vault': 'Knowledge Vault', 'raised-wards': 'Raised Wards',
  'healing-hands': 'Healing Hands', 'launch-bell': 'Launch Bell', 'orderly-guild': 'Orderly Guild',
  'far-horizons': 'Far Horizons', 'old-hearth': 'Old Hearth', 'class-codex': 'Class Codex',
});
