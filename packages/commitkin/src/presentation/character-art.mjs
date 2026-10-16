import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// User-approved original, copied byte-for-byte, including its provenance chunk.
// This is a visual approval, not a completed redistribution-rights certification.
export const BLOOMGUARD_ADVENTURER = Object.freeze({
  path: '.commitkin/character.png', width: 1254, height: 1254,
  sha256: '2737ffb0d202744a91c20d6e38d5d14248ee1a0c6a273483230a810c5c6d6282',
});
export function hasApprovedCharacter(model) {
  return model.factionId === 'bloomguard' && (model.classId === 'adventurer' || model.classId === null);
}
export function usesApprovedCharacter(model) {
  return hasApprovedCharacter(model) && Object.entries(BLOOMGUARD_ADVENTURER).every(([key, value]) => model.character?.[key] === value);
}
export function readApprovedCharacter() {
  const bytes = readFileSync(new URL('../../assets/characters/bloomguard-adventurer.png', import.meta.url));
  if (createHash('sha256').update(bytes).digest('hex') !== BLOOMGUARD_ADVENTURER.sha256) throw new TypeError('APPROVED_CHARACTER_INVALID');
  return bytes;
}
