import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
/** Bounded regular-file read, no-follow final component, no growth/repair/write path. */
export async function readBoundedFile(path,limit){
  let file;
  try{
    file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=await file.stat();
    if(!before.isFile()||before.size>limit)throw new TypeError('INPUT_FILE_INVALID');
    const bytes=Buffer.alloc(before.size+1);let at=0;
    while(at<bytes.length){const result=await file.read(bytes,at,bytes.length-at,at);if(!result.bytesRead)break;at+=result.bytesRead;}
    const after=await file.stat();
    if(at!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new TypeError('INPUT_CHANGED_DURING_READ');
    return bytes.subarray(0,at);
  }catch(error){throw new TypeError(['INPUT_FILE_INVALID','INPUT_CHANGED_DURING_READ'].includes(error.message)?error.message:'INPUT_UNREADABLE');}
  finally{await file?.close();}
}
