// Repository IDs survive renames. A fork's source is GitHub's root network
// repository, not an arbitrary caller-supplied parent URL or display name.
export const PRODUCT_REPOSITORY_ID = '1420061458';
export const PRODUCT_OWNER_ID = '76037656';
const id = value => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? value : Number.isSafeInteger(value) && value > 0 ? String(value) : null;
export function isCommitkinStorageRepository(metadata) {
  if (!metadata || metadata.private !== false || metadata.visibility && metadata.visibility !== 'public' || metadata.owner?.type !== 'User') return false;
  return id(metadata.id) !== PRODUCT_REPOSITORY_ID && metadata.fork === true && id(metadata.source?.id) === PRODUCT_REPOSITORY_ID && id(metadata.source?.owner?.id) === PRODUCT_OWNER_ID;
}
export function isCommitkinPreviewRepository(metadata) {
  if (isCommitkinStorageRepository(metadata)) return true;
  return metadata?.private === false && (!metadata.visibility || metadata.visibility === 'public') && metadata.owner?.type === 'User' && id(metadata.id) === PRODUCT_REPOSITORY_ID && id(metadata.owner.id) === PRODUCT_OWNER_ID;
}
