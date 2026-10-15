import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { LIMITS_BYTES } from './strict-json.js';
import { ValidationFailure } from '../domain/failure.js';

/** No write handles, repair, mkdir, stdout files, backups or directory traversal. */
export async function readRecordDirectory(directory) {
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ValidationFailure('raw', 'RECORD_DIRECTORY_INVALID');
  } catch (error) {
    if (error instanceof ValidationFailure) throw error;
    throw new ValidationFailure('raw', 'RECORD_DIRECTORY_UNREADABLE');
  }
  const records = {};
  for (const role of ['state', 'ledger', 'status']) {
    let handle;
    try {
      handle = await open(join(directory, `${role}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const info = await handle.stat();
      if (!info.isFile()) throw new ValidationFailure('raw', 'RECORD_NOT_REGULAR_FILE');
      if (info.size > LIMITS_BYTES[role]) throw new ValidationFailure('raw', 'INPUT_TOO_LARGE');
      const buffer = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      // Refuse a file changing size while read rather than accepting a prefix.
      const after = await handle.stat();
      if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new ValidationFailure('raw', 'RECORD_CHANGED_DURING_READ');
      records[role] = buffer.subarray(0, offset);
    } catch (error) {
      if (error?.code === 'ENOENT') { records[role] = null; continue; }
      if (error instanceof ValidationFailure) throw error;
      throw new ValidationFailure('raw', 'RECORD_UNREADABLE');
    } finally { await handle?.close(); }
  }
  return records;
}
