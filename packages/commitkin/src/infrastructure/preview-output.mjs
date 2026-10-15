import { mkdir, open, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, sep, dirname, join } from 'node:path';

const ALLOWED = new Set(['README.md','.commitkin/state.json','.commitkin/ledger.json','.commitkin/status.json','.commitkin/card.png','preview-report.json','LICENSE.txt','growth-gallery.png']);
async function noSymlinkAncestors(path) {
  let current=resolve(path);
  while(true){
    try{if((await lstat(current)).isSymbolicLink())throw new TypeError('PREVIEW_SYMLINK_REJECTED');}catch(error){if(error.code!=='ENOENT')throw error;}
    const parent=dirname(current);if(parent===current)break;current=parent;
  }
}

/** New preview directory only. Never overwrites an existing directory or live record. */
export async function writePreviewDirectory({previewRoot,outputDirectory,files}) {
  const root=resolve(previewRoot),out=resolve(outputDirectory);
  const tail=relative(root,out);
  if(!tail||tail.startsWith('..'+sep)||tail==='..'||tail.startsWith(sep))throw new TypeError('PREVIEW_PATH_INVALID');
  if(!Array.isArray(files)||new Set(files.map(file=>file.path)).size!==files.length||files.some(file=>!ALLOWED.has(file.path)||!(file.content instanceof Uint8Array)))throw new TypeError('PREVIEW_FILES_INVALID');
  if(!files.some(file=>file.path==='preview-report.json'))throw new TypeError('PREVIEW_MARKER_REQUIRED');
  await noSymlinkAncestors(out);
  await mkdir(root,{recursive:true});
  const actual=await realpath(root);if(actual!==root)throw new TypeError('PREVIEW_SYMLINK_REJECTED');
  await mkdir(dirname(out),{recursive:true});
  await mkdir(out,{recursive:false}); // EEXIST preserves existing previews and any user data.
  for(const file of files){
    const target=join(out,file.path);await mkdir(dirname(target),{recursive:true});
    const handle=await open(target,'wx',0o644);
    try{await handle.writeFile(file.content);await handle.sync();}finally{await handle.close();}
  }
  return{decision:'preview_written',fileCount:files.length,publicationAuthorized:false};
}
