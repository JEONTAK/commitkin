#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createPreflightValidator,createEvidenceVerifier,buildDemo } from '../src/index.mjs';
import { readBoundedFile } from '../src/infrastructure/bounded-file.mjs';
import { readRecordDirectory } from '../../record-validator/src/infrastructure/read-only-files.js';
import { writePreviewDirectory } from '../src/infrastructure/preview-output.mjs';

const HELP=`Commitkin local development tools (Node.js >=22)

demo --faction bloomguard|ashbound --name NEW_PREVIEW_NAME
  Create a NEW synthetic directory under deliverables/commitkin-local-preview.
preflight --context FILE --evidence FILE --records DIR [--previous DIR]
verify --context FILE --evidence FILE --records DIR [--previous DIR]
  Read-only supplied-evidence checks. No GitHub or record writes.

Exit0 means only local demo success or evidence-relative checks, not progression
or publication authorization. Unsupported/missing proof holds. No token, live,
force, initialize, reset, policy-override or Actions option is available.
`;
function args(values,allowed,required){
  const result=new Map();for(let at=0;at<values.length;at+=2){if(!allowed.includes(values[at])||result.has(values[at])||!values[at+1]||values[at+1].startsWith('--'))throw new TypeError('CLI_ARGUMENTS_INVALID');result.set(values[at],values[at+1]);}
  if(required.some(key=>!result.has(key)))throw new TypeError('CLI_ARGUMENTS_INVALID');return result;
}
try{
  const [command,...values]=process.argv.slice(2);
  if(command==='--help'&&values.length===0)process.stdout.write(HELP);
  else if(command==='demo'){
    const options=args(values,['--faction','--name'],['--faction','--name']);
    if(!/^[a-z][a-z0-9-]{0,63}$/.test(options.get('--name')))throw new TypeError('CLI_ARGUMENTS_INVALID');
    const demo=buildDemo({faction:options.get('--faction')});
    const root=fileURLToPath(new URL('../../../deliverables/commitkin-local-preview/',import.meta.url));
    await writePreviewDirectory({previewRoot:root,outputDirectory:join(root,options.get('--name')),files:demo.files});
    process.stdout.write(JSON.stringify(demo.report)+'\n');
  }else if(['preflight','verify'].includes(command)){
    const options=args(values,['--context','--evidence','--records','--previous'],['--context','--evidence','--records']);
    const [context,evidence,candidate,previous]=await Promise.all([readBoundedFile(options.get('--context'),65536),readBoundedFile(options.get('--evidence'),33554432),readRecordDirectory(options.get('--records')),options.has('--previous')?readRecordDirectory(options.get('--previous')):null]);
    const validate=command==='preflight'?createPreflightValidator():createEvidenceVerifier();
    const report=validate({context,evidence,candidate,previous});process.stdout.write(JSON.stringify(report)+'\n');
    process.exitCode=['preflight_passed','accept_relative_to_evidence'].includes(report.decision)?0:1;
  }else throw new TypeError('CLI_ARGUMENTS_INVALID');
}catch(error){
  const allowed=['CLI_ARGUMENTS_INVALID','FACTION_INVALID','README_CONNECTION_REQUIRED','PREVIEW_PATH_INVALID','PREVIEW_SYMLINK_REJECTED','INPUT_FILE_INVALID','INPUT_CHANGED_DURING_READ','INPUT_UNREADABLE'];
  process.stdout.write(JSON.stringify({reportVersion:1,decision:'hold',code:allowed.includes(error.message)?error.message:error.code==='EEXIST'?'PREVIEW_EXISTS':'LOCAL_TOOL_FAILED',progressionAuthorized:false})+'\n');process.exitCode=2;
}
