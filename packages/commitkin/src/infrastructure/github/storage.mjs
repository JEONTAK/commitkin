// Repository IDs survive renames. A fork's source is GitHub's root network
// repository, not an arbitrary caller-supplied parent URL or display name.
export const PRODUCT_REPOSITORY_ID = '1420061458';
export const PRODUCT_OWNER_ID = '76037656';
// GitHub cannot provide the author a separate fork in the same account. This
// reviewed ordinary installation is not an opt-out flag for arbitrary copies.
// Renames, transfers and delete/recreate require a new reviewed binding.
export const AUTHOR_STORAGE = Object.freeze({ repositoryId: '1421634321', fullName: 'JEONTAK/commitkin-character' });
const id = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
export function isCommitkinStorageRepository(metadata) {
  if (!metadata || metadata.private !== false || metadata.visibility && metadata.visibility !== 'public' || metadata.owner?.type !== 'User') return false;
  if (metadata.fork === false && id(metadata.id) === AUTHOR_STORAGE.repositoryId && id(metadata.owner.id) === PRODUCT_OWNER_ID &&
    typeof metadata.full_name === 'string' && metadata.full_name.toLowerCase() === AUTHOR_STORAGE.fullName.toLowerCase() &&
    typeof metadata.owner.login === 'string' && metadata.owner.login.toLowerCase() === 'jeontak' && metadata.name === 'commitkin-character') return true;
  return id(metadata.id) !== PRODUCT_REPOSITORY_ID && metadata.fork === true && id(metadata.source?.id) === PRODUCT_REPOSITORY_ID && id(metadata.source?.owner?.id) === PRODUCT_OWNER_ID;
}
export function isCommitkinPreviewRepository(metadata) {
  if (isCommitkinStorageRepository(metadata)) return true;
  return metadata?.private === false && (!metadata.visibility || metadata.visibility === 'public') && metadata.owner?.type === 'User' && id(metadata.id) === PRODUCT_REPOSITORY_ID && id(metadata.owner.id) === PRODUCT_OWNER_ID;
}
