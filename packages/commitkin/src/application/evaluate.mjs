import { digest, scopeDigest, equivalent } from '../../../record-validator/src/domain/hash.js';
import { normalizeSettings } from '../domain/settings.mjs';
import { settleQualifiedActivities } from '../domain/growth/settlement.mjs';
import { evaluateCharacter } from '../domain/character/index.mjs';
import { reconcileUnobservedGaps, completeInterval } from '../domain/continuity.mjs';

export const bundleBytes = bundle => Object.fromEntries(['state','ledger','status'].map(role=>[role,bundle?.[role] ? Buffer.from(JSON.stringify(bundle[role])) : null]));
export function scopeFor(repositoryIds) {
  const scope={rulesetVersion:'1.0.0',analysisConfigHash:digest({rulesetVersion:'1.0.0',publicOnly:true}),repositoryIds:[...new Set(repositoryIds)].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1)};
  return {id:scopeDigest(scope),...scope};
}
const shift = (date, offset) => new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
function canonicalDate(date){return typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;}
function held(code,recordReport){return {decision:'hold',code,candidate:null,preservePrevious:true,progressionAuthorized:false,sourceAuthenticity:'not_checked',...(recordReport?{recordReport}:{})};}

/**
 * INTERNAL proposal builder. Call only after qualification/known-scope collection.
 * It does not acquire/authenticate sources and never grants publication authority.
 */
export function createSnapshotEvaluationUseCase({validateRecords:validate}) {
  return function evaluateQualifiedSnapshot({previous,expectedOwner,activities,priorActivities=[],reviewHistoryFacts=[],repositoryIds,settings,settingsFileUsed=true,evaluationStartedAt,evaluatedAt,initialAssignmentVerified=false}) {
    try {
      if (!previous || !expectedOwner || !Array.isArray(repositoryIds)) return held('PREVIOUS_SNAPSHOT_REQUIRED');
      const context={expectedOwner,now:evaluatedAt,operation:'normal',evaluationStartedAt};
      const beforeReport=validate(bundleBytes(previous),context);
      if (!beforeReport.recordValid || !['ACCEPT','ANALYSIS_PENDING','RETAIN_SUCCESS'].includes(beforeReport.code)) return held('PREVIOUS_SNAPSHOT_INVALID',beforeReport);
      const start=previous.state.growth.startDate;
      const date=evaluationStartedAt?.slice(0,10);
      if (!canonicalDate(date) || Date.parse(evaluationStartedAt)>Date.parse(evaluatedAt)) return held('EVALUATION_TIME_INVALID');
      if (previous.ledger.corrections.length) return held('CORRECTION_REVIEW_REQUIRED');
      const windowStart=[start,shift(date,-90)].sort().at(-1);
      const current=scopeFor(repositoryIds);
      if (!current.repositoryIds.every(id=>previous.ledger.repositories.some(repo=>repo.id===id))) return held('UNRESOLVED_REPOSITORY');
      if (!Array.isArray(activities) || activities.some(item=>item.fact.occurredAt.slice(0,10)<windowStart||item.fact.occurredAt.slice(0,10)>=date||!current.repositoryIds.includes(item.fact.repositoryId))) return held('ACTIVITY_OUTSIDE_COLLECTION_SCOPE');
      const normalized=normalizeSettings(settings);
      if (previous.state.settings.filePreviouslyUsed&&!settingsFileUsed) return held('SETTINGS_CONFIRMATION_REQUIRED');
      const settled=settleQualifiedActivities({activities,priorActivities,reviewHistoryFacts,previous:previous.state.growth.phase==='ready'?{facts:previous.ledger.facts,days:previous.ledger.days,totalXp:previous.state.growth.totalXp}:null});
      if(settled.decision!=='settled') return held(settled.code);
      const ledger=structuredClone(previous.ledger);
      const revision=previous.state.recordRevision+1;
      if(!Number.isSafeInteger(revision))return held('REVISION_LIMIT');
      ledger.recordRevision=revision;
      if(!ledger.scopes.some(scope=>scope.id===current.id))ledger.scopes.push(current);
      if(windowStart<date)ledger.coverage.push({startDate:windowStart,endDateExclusive:date,scopeId:current.id,complete:true,observedAt:evaluatedAt});
      const oldDays=new Map(previous.ledger.days.map(day=>[day.date,day]));
      ledger.facts=settled.facts;
      ledger.days=settled.days.map(day=>{
        const old=oldDays.get(day.date);
        if(old&&equivalent({...old,scopeId:undefined},{...day,scopeId:undefined}))return structuredClone(old);
        const ids=day.byRepository.map(row=>row.repositoryId);
        const originalScope=old&&ledger.scopes.find(scope=>scope.id===old.scopeId);
        if(originalScope&&ids.every(id=>originalScope.repositoryIds.includes(id)))return{...day,scopeId:old.scopeId};
        if(ids.every(id=>current.repositoryIds.includes(id)))return{...day,scopeId:current.id};
        // Previously settled excluded rows remain support history, never newly credited scope.
        if(ids.some(id=>!current.repositoryIds.includes(id)&&!old?.byRepository.some(row=>row.repositoryId===id)))throw new TypeError('SETTLEMENT_SCOPE_UNPROVEN');
        const support=scopeFor(ids);
        if(!ledger.scopes.some(scope=>scope.id===support.id))ledger.scopes.push(support);
        ledger.coverage.push({startDate:day.date,endDateExclusive:shift(day.date,1),scopeId:support.id,complete:true,observedAt:evaluatedAt});
        return{...day,scopeId:support.id};
      });
      const base=structuredClone(previous.state);
      if(!base.class)base.class={id:'adventurer',lastChangedOn:null,pending:null,history:[]};
      const character=evaluateCharacter({previousState:base,ledger,evaluationDate:date,evaluatedAt,scopeId:current.id,initialAssignmentVerified});
      const state={...base,recordRevision:revision,growth:{...base.growth,phase:'ready',totalXp:settled.totalXp},class:character.class,traits:character.traits,observationClock:character.observationClock,achievements:character.achievements,
        settings:{filePreviouslyUsed:base.settings.filePreviouslyUsed||settingsFileUsed,lastAcceptedHash:digest(normalized)},
        evaluation:{lastSuccessfulRevision:revision,evaluatedAt,activityCutoffExclusive:date,scopeId:current.id},integrity:{ledgerHash:digest(ledger)}};
      const unobservedGaps=reconcileUnobservedGaps({previous,currentScope:current,windowStart,cutoff:date});
      const status={schemaVersion:1,recordType:'status',rulesetVersion:'1.0.0',recordRevision:revision,owner:structuredClone(expectedOwner),lastSuccessfulRevision:revision,state:'ok',reasonCode:null,changedAt:evaluatedAt,collectionPending:[],unobservedGaps};
      const sameDate=previous.state.observationClock.lastNormalEvaluationOn===date;
      const sameCharacter=['growth','class','traits','observationClock','achievements','settings'].every(key=>equivalent(previous.state[key],state[key]));
      const sameLedger=['repositories','scopes','facts','days','corrections'].every(key=>equivalent(previous.ledger[key],ledger[key]));
      if(sameDate&&sameCharacter&&sameLedger&&completeInterval(previous.ledger.coverage,current.id,windowStart,date)){
        const retained=structuredClone(previous);
        const priorStatus=previous.status;
        if(priorStatus.state==='ok'&&priorStatus.collectionPending.length===0&&equivalent(priorStatus.unobservedGaps,unobservedGaps)){
          return{decision:'unchanged',code:'REPLAY_UNCHANGED',candidate:retained,character,deltaXp:'0',recordReport:validate(bundleBytes(retained),context,bundleBytes(previous)),progressionAuthorized:false,sourceAuthenticity:'not_checked'};
        }
        retained.status={...status,recordRevision:previous.state.recordRevision,lastSuccessfulRevision:previous.state.evaluation.lastSuccessfulRevision};
        const report=validate(bundleBytes(retained),context,bundleBytes(previous));
        if(report.code!=='ACCEPT')return held('CANDIDATE_SAFETY_REJECTED',report);
        return{decision:'proposed',code:'LOCAL_STATUS_READY',candidate:retained,character,deltaXp:'0',recordReport:report,progressionAuthorized:false,sourceAuthenticity:'not_checked'};
      }
      const candidate={state,ledger,status};
      const recordReport=validate(bundleBytes(candidate),context,bundleBytes(previous));
      if(recordReport.code!=='ACCEPT')return held('CANDIDATE_SAFETY_REJECTED',recordReport);
      return{decision:'proposed',code:'LOCAL_CANDIDATE_READY',candidate,character,deltaXp:settled.deltaXp,recordReport,progressionAuthorized:false,sourceAuthenticity:'not_checked'};
    }catch(error){
      // Do not echo arbitrary thrown values from supplied data or expose stack/path details.
      const allowed=['CHARACTER_COVERAGE_INCOMPLETE','CHARACTER_EVALUATION_REVERSED','SETTLEMENT_SCOPE_UNPROVEN','SETTINGS_INVALID'];
      return held(allowed.includes(error.message)?error.message:'EVALUATION_INPUT_INVALID');
    }
  };
}
