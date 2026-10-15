#!/usr/bin/env node
import { createGithubClient,collectPublicSources } from '../src/index.mjs';

// Manual validation only. No publisher, filesystem writer, evaluation or token fallback.
const env=process.env;
try{
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||env.GITHUB_REPOSITORY?.toLowerCase()!=='jeontak/commitkin'||env.GITHUB_API_URL!=='https://api.github.com'||env.GITHUB_SERVER_URL!=='https://github.com'||!env.GITHUB_TOKEN)throw new TypeError('PROBE_CONTEXT_INVALID');
  const client=createGithubClient({token:env.GITHUB_TOKEN,fetchImpl:async(url,options)=>{if(options.method!=='GET')throw new TypeError('WRITE_METHOD_FORBIDDEN');return fetch(url,options);},requestBudget:80,timeoutMs:10000,maxResponseBytes:8*1024*1024,maxRetries:1});
  const metadata=await client.get('/repos/JEONTAK/commitkin');
  if(!metadata.ok||metadata.data.private!==false||metadata.data.owner?.id!==76037656||metadata.data.owner.type!=='User'||metadata.data.id!==1420061458)throw new TypeError('PROBE_SUBJECT_MISMATCH');
  const cutoff=new Date().toISOString().slice(0,10),start=new Date(Date.parse(cutoff+'T00:00:00Z')-90*86400000).toISOString().slice(0,10);
  const result=await collectPublicSources({client,repositories:[{id:'1420061458',name:'JEONTAK/commitkin'}],subjectAccountId:'76037656',startDate:start,cutoffDate:cutoff});
  const external=await client.get('/repos/cli/cli/pulls/14485');
  const externalReadable=external.ok&&typeof external.data.id==='number'&&typeof external.data.number==='number';
  const report={reportVersion:1,probe:'basic-token-readonly-core',decision:result.decision,code:result.code,externalPublicPrReadable:externalReadable,requests:client.budget().used,
    knownRepositoryCaptures:result.capture?.repositories.length??0,queryCaptures:result.capture?.queries.length??0,qualificationReady:false,capabilities:result.capabilities,sourceAuthenticity:'not_checked',progressionAuthorized:false,actualGrowthRecordsWritten:false,githubWriteRequests:0};
  process.stdout.write(JSON.stringify(report)+'\n');
  process.exitCode=result.decision==='ready'&&externalReadable?0:1;
}catch(error){
  const code=['PROBE_CONTEXT_INVALID','PROBE_SUBJECT_MISMATCH'].includes(error.message)?error.message:'PROBE_UNAVAILABLE';
  process.stdout.write(JSON.stringify({reportVersion:1,probe:'basic-token-readonly-core',decision:'hold',code,progressionAuthorized:false,actualGrowthRecordsWritten:false})+'\n');process.exitCode=1;
}
