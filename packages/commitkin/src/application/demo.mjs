import { digest } from '../../../record-validator/src/domain/hash.js';
import { scopeFor } from './evaluate.mjs';
import { drawCharacter, renderCard } from '../presentation/card.mjs';
import { canvas, encodePng } from '../presentation/pixel.mjs';
import { managedContent, updateManagedReadme, START, END } from '../presentation/readme.mjs';
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

/** Fictional fixture generator, not an input/import or live first-install path. */
export function buildDemoUseCase({faction='bloomguard',evaluateSnapshot}){
  if(!['bloomguard','ashbound'].includes(faction))throw new TypeError('FACTION_INVALID');
  const at='2026-10-15T01:00:00Z',start='2026-07-17',owner={accountId:faction==='bloomguard'?'1001':'1002',profileRepositoryId:faction==='bloomguard'?'9001':'9002'};
  const scope=scopeFor(['9010','9020']);
  const settings={version:1,repositories:{additional:[],exclude:[]}};
  const ledger={schemaVersion:1,recordType:'ledger',rulesetVersion:'1.0.0',recordRevision:1,owner,
    repositories:['9010','9020'].map(id=>({id,firstObservedAt:'2026-10-15T00:50:00Z',ownershipAtFirstObservation:'self',tracking:'active',discoveredVia:['automatic']})),
    scopes:[scope],coverage:[],facts:[],days:[],corrections:[]};
  const state={schemaVersion:1,recordType:'state',rulesetVersion:'1.0.0',recordRevision:1,owner,faction:{id:faction,confirmedAt:'2026-10-15T00:49:00Z'},
    growth:{phase:'pending',startDate:start,totalXp:null},class:null,traits:{habit:{currentId:null,pending:null},activity:{currentId:null,pending:null}},
    observationClock:{lastNormalEvaluationOn:null,classLastCountedOn:null,habitLastCountedOn:null,activityLastCountedOn:null},achievements:[],settings:{filePreviouslyUsed:false,lastAcceptedHash:digest(settings)},evaluation:null,integrity:{ledgerHash:digest(ledger)}};
  const status={schemaVersion:1,recordType:'status',rulesetVersion:'1.0.0',recordRevision:1,owner,lastSuccessfulRevision:null,state:'analysis_pending',reasonCode:'INITIAL_ANALYSIS_PENDING',changedAt:at,collectionPending:[{startDate:start,endDateExclusive:'2026-10-15',scopeId:scope.id}],unobservedGaps:[]};
  const activities=Array.from({length:30},(_,index)=>{
    const repositoryId=index<24?'9010':'9020';
    const sourceId={type:'numeric',value:String(10000+index)};
    const occurredAt=new Date(Date.parse('2026-09-10T12:00:00Z')+index*86400000).toISOString().replace('.000Z','Z');
    return{fact:{eventKey:digest({demo:'event',index}),kind:'merged_pr',repositoryId,occurredAt,families:['craft'],prKey:digest({demo:'pr',index}),bugEvidenced:false},sourceId};
  });
  const evaluated=evaluateSnapshot({previous:{state,ledger,status},expectedOwner:owner,activities,repositoryIds:scope.repositoryIds,settings,settingsFileUsed:false,evaluationStartedAt:'2026-10-15T00:50:00Z',evaluatedAt:at,initialAssignmentVerified:true});
  if(evaluated.decision!=='proposed')throw new TypeError(evaluated.recordReport?.code??evaluated.code);
  const card=renderCard({state:evaluated.candidate.state,username:'DemoHero',classificationReason:evaluated.character.classificationReason,preview:true});
  const profile='# Synthetic Commitkin profile\n\nThis directory is a local test fixture, not an actual GitHub profile.\n\n'+START+'\n'+END+'\n\nUnrelated profile content is preserved.\n';
  const readme=updateManagedReadme(profile,managedContent({state:evaluated.candidate.state,status:evaluated.candidate.status,username:'DemoHero',classificationReason:evaluated.character.classificationReason,preview:true}));
  const gallery=canvas(880,520,faction==='bloomguard'?[17,30,28]:[32,23,28]);
  gallery.text('BLACKSMITH / '+faction,20,20,[222,220,196],2);
  const levels=[1,5,10,15,20,25,30,35,40,45,50];
  levels.forEach((level,index)=>{const col=index%6,row=Math.floor(index/6);const x=20+col*144,y=72+row*220;drawCharacter(gallery,{classId:'blacksmith',factionId:faction,level,x,y,scale:4});gallery.text('LV.'+level,x+30,y+156,[222,220,196],2);});
  const report={reportVersion:1,synthetic:true,decision:'local_demo_ready',faction,sourceAuthenticity:'not_checked',progressionAuthorized:false,recordValidation:evaluated.recordReport.code,classId:evaluated.candidate.state.class.id,totalXp:evaluated.candidate.state.growth.totalXp,level:evaluated.character.level.level,appearance:evaluated.character.appearance.stageIndex,realOwnerRecordsChanged:false,githubRequests:0};
  return{report,files:[...['state','ledger','status'].map(role=>({path:'.commitkin/'+role+'.json',content:json(evaluated.candidate[role])})),{path:'.commitkin/card.png',content:card},{path:'README.md',content:Buffer.from(readme)},{path:'growth-gallery.png',content:encodePng(gallery)},{path:'preview-report.json',content:json(report)},{path:'LICENSE.txt',content:Buffer.from('Development fallback pixel art and bitmap lettering are original code-native previews. First-party code: MIT. Generated preview art: CC BY 4.0, attribution: Commitkin contributors. No AI concept sheets or external fonts are included. Not a completed release rights audit.\n')}]};
}
