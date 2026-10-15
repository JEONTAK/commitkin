import { createValidator } from '../../record-validator/src/index.js';
import { parseStrictJson } from '../../record-validator/src/infrastructure/strict-json.js';
import { createPreflightValidator } from './infrastructure/preflight-factory.mjs';
import { DEVELOPMENT_POLICY_REGISTRY, OBSERVED_POLICY_REGISTRY } from './infrastructure/policies.mjs';
import { createSnapshotEvaluationUseCase } from './application/evaluate.mjs';
import { createEvidenceVerificationUseCase } from './application/verify-evidence.mjs';
import { buildDemoUseCase } from './application/demo.mjs';
import { createRefreshUseCase } from './application/refresh.mjs';
import { createEvidenceSchemaRegistry } from './infrastructure/evidence-schema.mjs';
import { parseSettings } from './infrastructure/settings-yaml.mjs';
import { developmentPolicyDescriptors } from './infrastructure/policies.mjs';
import { acquireInstallation } from './infrastructure/github/installation.mjs';
import { discoverRepositories } from './infrastructure/github/discovery.mjs';
import { adaptPublicCapture } from './infrastructure/github/evidence-adapter.mjs';
import { collectPublicSources } from './application/collect-public-sources.mjs';
import { renderCard, renderPendingCard } from './presentation/card.mjs';
import { managedContent, managedPendingContent, updateManagedReadme } from './presentation/readme.mjs';
import { qualifyObservedCapture, OBSERVED_SOURCE_MODEL } from './domain/evidence/observed.mjs';
import { createObservedCandidateVerifier } from './application/verify-observed.mjs';
import { createActionRunUseCase } from './application/run-action.mjs';
import { createGithubPublisher } from './infrastructure/github/publication.mjs';

/** Composition root. Factories construct capabilities; importing never performs I/O/network writes. */
export { createPreflightValidator };
export function createSnapshotEvaluator(){return createSnapshotEvaluationUseCase({validateRecords:createValidator()});}
export function createEvidenceVerifier({policyRegistry=DEVELOPMENT_POLICY_REGISTRY}={}){
  return createEvidenceVerificationUseCase({policyRegistry,preflight:createPreflightValidator(),parse:parseStrictJson});
}
export function buildDemo({faction='bloomguard'}={}){return buildDemoUseCase({faction,evaluateSnapshot:createSnapshotEvaluator()});}
/** GET-only end-to-end composition. Returned candidate bytes are never persisted. */
export function createReadonlyRefresh({client,clock=()=>new Date().toISOString().replace('.000Z','Z')}={}){
  return composeRefresh({client,clock,observed:false});
}
export function createObservedReadonlyRefresh({client,clock=()=>new Date().toISOString().replace('.000Z','Z')}={}){
  return composeRefresh({client,clock,observed:true});
}
function composeRefresh({client,clock,observed}){
  if(!client||typeof client.get!=='function'||typeof client.paginate!=='function'||typeof clock!=='function')throw new TypeError('REFRESH_PORTS_INVALID');
  const validateRecords=createValidator();
  return createRefreshUseCase({
    acquire:input=>acquireInstallation({...input,client,validateRecords,...(observed?{deferReadyClassOrigin:true}:{})}),
    parse:parseStrictJson,parseSettings,
    discover:input=>discoverRepositories({...input,client}),
    collect:input=>collectPublicSources({...input,client,...(observed?{model:OBSERVED_SOURCE_MODEL}:{})}),
    adapt:adaptPublicCapture,policyRegistry:DEVELOPMENT_POLICY_REGISTRY,policyDescriptors:developmentPolicyDescriptors(),
    ...(observed?{sourceModel:OBSERVED_SOURCE_MODEL,policyRegistry:OBSERVED_POLICY_REGISTRY,qualifyCapture:qualifyObservedCapture,verifyCandidate:createObservedCandidateVerifier({validateRecords}),reserveInitialPending:true}:{}),
    ...(observed?{verifyInitialClassOrigin:async({workflowContext,expectedHead,expectedOwner})=>{
      const origin=await acquireInstallation({client,validateRecords,workflowContext,initialSelection:null});
      if(origin.decision!=='acquired')return{decision:'hold',code:origin.code};
      return origin.initialAssignmentVerified===true&&origin.expectedHead===expectedHead&&origin.expectedOwner.accountId===expectedOwner.accountId&&origin.expectedOwner.profileRepositoryId===expectedOwner.profileRepositoryId?
        {decision:'verified'}:{decision:'hold',code:'INITIAL_CLASS_ORIGIN_UNVERIFIED'};
    }}:{}),
    schema:createEvidenceSchemaRegistry(),clock,evaluate:createSnapshotEvaluator(),verify:createEvidenceVerifier(),updateReadme:updateManagedReadme,
    present:({candidate,username,classificationReason,originalReadme})=>[
      ...['state','ledger','status'].map(role=>({path:'.commitkin/'+role+'.json',content:Buffer.from(JSON.stringify(candidate[role],null,2)+'\n')})),
      {path:'.commitkin/card.png',content:renderCard({state:candidate.state,username,classificationReason,preview:!observed})},
      {path:'README.md',content:Buffer.from(updateManagedReadme(originalReadme,managedContent({state:candidate.state,status:candidate.status,username,classificationReason,preview:!observed})))},
    ],
    presentPending:({candidate,username,originalReadme})=>[
      ...['state','ledger','status'].map(role=>({path:'.commitkin/'+role+'.json',content:Buffer.from(JSON.stringify(candidate[role],null,2)+'\n')})),
      {path:'.commitkin/card.png',content:renderPendingCard({state:candidate.state,username,preview:!observed})},
      {path:'README.md',content:Buffer.from(updateManagedReadme(originalReadme,managedPendingContent({state:candidate.state,status:candidate.status,username,preview:!observed})))},
    ],
  });
}
/** Explicit publication factory. Construction itself performs no requests. */
export function createCommitkinAction({client,publisher,clock}={}){
  return createActionRunUseCase({prepare:createObservedReadonlyRefresh({client,...(clock?{clock}:{})}),publish:publisher?.publish});
}
export { settleQualifiedActivities } from './domain/growth/settlement.mjs';
export { levelProgress, levelForXp, xpForLevel, appearanceForLevel } from './domain/growth/levels.mjs';
export { evaluateCharacter } from './domain/character/index.mjs';
export { renderCard } from './presentation/card.mjs';
export { managedContent, updateManagedReadme } from './presentation/readme.mjs';
export { createGithubClient,discoverRepositories,createGithubPublisher } from './infrastructure/github/index.mjs';
export { collectPublicSources };
