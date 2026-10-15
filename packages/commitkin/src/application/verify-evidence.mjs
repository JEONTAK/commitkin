import { equivalent } from '../../../record-validator/src/domain/hash.js';
import { qualifyEvidence } from '../domain/evidence/qualify.mjs';
import { settleQualifiedActivities } from '../domain/growth/settlement.mjs';

/** Reconstruct only supported source/reward semantics. Never a live publication gate. */
export function createEvidenceVerificationUseCase({policyRegistry,preflight,parse:parseStrictJson}){
  return function verifyEvidence(input){
    const report={reportVersion:1,reportType:'source-reward-verification',progressionAuthorized:false,sourceAuthenticity:'not_checked',checks:{preflight:'not_checked',sourceEligibility:'not_checked',rewardOrder:'not_checked',rewardAllocation:'not_checked'},notChecked:['sourceAuthenticity','historicalSnapshotAuthenticity','githubOwnerAuthenticity','settingsSourceVerification','initialAssignmentProvenance','classTraitAchievementQualification','correctionAuthorization','accountWideDiscovery']};
    const stop=(code,decision='hold',stage='qualification')=>({...report,stage,code,decision});
    try{
      const checked=preflight(input);report.preflight=checked;
      report.notChecked=[...new Set([...report.notChecked,...checked.notChecked])];
      if(checked.decision!=='preflight_passed')return stop(checked.code,checked.decision,'preflight');
      report.checks.preflight='passed';
      const context=parseStrictJson(input.context,'status'),evidence=parseStrictJson(input.evidence,'ledger');
      const candidate=Object.fromEntries(['state','ledger','status'].map(role=>[role,parseStrictJson(input.candidate[role],role)]));
      const previous=input.previous?Object.fromEntries(['state','ledger','status'].map(role=>[role,parseStrictJson(input.previous[role],role)])):null;
      const qualified=qualifyEvidence({evidence,context,previousLedger:previous?.ledger??null,policyRegistry,growthStartDate:candidate.state.growth.startDate});
      report.source={decision:qualified.decision,code:qualified.code,exclusions:qualified.exclusions,needsTemporalProof:qualified.needsTemporalProof};
      if(qualified.decision!=='qualified')return stop(qualified.code,qualified.decision);
      report.checks.sourceEligibility='passed';
      const cutoff=context.evaluation.startedAt.slice(0,10),lower=new Date(Date.parse(cutoff+'T00:00:00Z')-90*86400000).toISOString().slice(0,10);
      if(!previous&&candidate.ledger.facts.some(fact=>fact.occurredAt.slice(0,10)<lower||!context.scope.repositoryIds.includes(fact.repositoryId)))return stop('PRESERVED_SOURCE_CONTEXT_REQUIRED');
      const priorKeys=new Set(previous?.ledger.facts.map(fact=>fact.eventKey)??[]);
      const settled=settleQualifiedActivities({activities:qualified.activities,reviewHistoryFacts:qualified.reviewHistoryFacts,priorActivities:qualified.activities.filter(item=>priorKeys.has(item.fact.eventKey)),previous:previous?.state.growth.phase==='ready'?{facts:previous.ledger.facts,days:previous.ledger.days,totalXp:previous.state.growth.totalXp}:null});
      if(settled.decision!=='settled')return stop(settled.code,'hold','reward');
      const byKey=items=>[...items].sort((a,b)=>a.eventKey<b.eventKey?-1:1);
      if(!equivalent(byKey(settled.facts),byKey(candidate.ledger.facts)))return stop('QUALIFYING_FACTS_MISMATCH','rejected','reward');
      const projection=day=>({date:day.date,byRepository:day.byRepository,xp:day.xp,creditedKeys:day.creditedKeys});
      const sort=days=>days.map(projection).sort((a,b)=>a.date<b.date?-1:1);
      if(settled.totalXp!==candidate.state.growth.totalXp||!equivalent(sort(settled.days),sort(candidate.ledger.days)))return stop('REWARD_ALLOCATION_MISMATCH','rejected','reward');
      report.checks.rewardOrder='passed';report.checks.rewardAllocation='passed';
      report.notChecked=report.notChecked.filter(check=>!['sourceEligibility','rewardOrder','rewardAllocation'].includes(check));
      return{...report,stage:'complete',code:'EVIDENCE_RELATIVE_MATCH',decision:'accept_relative_to_evidence'};
    }catch{return stop('EVIDENCE_VERIFIER_UNAVAILABLE','hold','internal');}
  };
}
