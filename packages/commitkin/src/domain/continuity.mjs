/** Keep unobserved history explicit; collection windows never expire growth/history. */
function subtract(range,coverage){
  let parts=[range];
  for(const closed of coverage){
    parts=parts.flatMap(part=>{
      if(closed.endDateExclusive<=part.startDate||closed.startDate>=part.endDateExclusive)return[part];
      const next=[];
      if(part.startDate<closed.startDate)next.push({...part,endDateExclusive:closed.startDate});
      if(closed.endDateExclusive<part.endDateExclusive)next.push({...part,startDate:closed.endDateExclusive});
      return next;
    });
  }
  return parts;
}
export function completeInterval(coverage,scopeId,startDate,endDateExclusive){
  return subtract({startDate,endDateExclusive},coverage.filter(row=>row.complete&&row.scopeId===scopeId)).length===0;
}
export function reconcileUnobservedGaps({previous,currentScope,windowStart,cutoff}){
  const scopes=new Map(previous.ledger.scopes.map(scope=>[scope.id,scope.repositoryIds]));
  const covers=scopeId=>scopeId!==null&&scopes.has(scopeId)&&scopes.get(scopeId).every(id=>currentScope.repositoryIds.includes(id));
  const actualNewCoverage=[{startDate:windowStart,endDateExclusive:cutoff}];
  const ranges=[...(previous.status?.unobservedGaps??[]),...(previous.status?.collectionPending??[])];
  const last=previous.state.evaluation?.activityCutoffExclusive??previous.state.growth.startDate;
  const oldScope=previous.state.evaluation?.scopeId??previous.ledger.scopes.at(-1)?.id??null;
  if(last<windowStart){
    const savedCoverage=previous.ledger.coverage.filter(row=>row.complete&&row.scopeId===oldScope);
    ranges.push(...subtract({startDate:last,endDateExclusive:windowStart,scopeId:oldScope},savedCoverage));
  }
  // Adding a repository does not make its pre-window history known, even when
  // the old character was refreshed yesterday. Derive older unknown intervals
  // from per-repository compatible scopes rather than a last-run timestamp.
  if(previous.state.growth.startDate<windowStart){
    const id=currentScope.id??null;
    for(const repositoryId of currentScope.repositoryIds){
      const known=previous.ledger.coverage.filter(row=>row.complete&&scopes.get(row.scopeId)?.includes(repositoryId));
      ranges.push(...subtract({startDate:previous.state.growth.startDate,endDateExclusive:windowStart,scopeId:id},known));
    }
  }
  const remaining=ranges.flatMap(range=>covers(range.scopeId)?subtract(range,actualNewCoverage):[structuredClone(range)]);
  const byScope=new Map();
  for(const range of remaining){if(range.startDate>=range.endDateExclusive)continue;const rows=byScope.get(range.scopeId)??[];rows.push(range);byScope.set(range.scopeId,rows);}
  const output=[];
  for(const rows of byScope.values()){
    rows.sort((a,b)=>a.startDate<b.startDate?-1:a.startDate>b.startDate?1:0);
    for(const range of rows){const prior=output.at(-1);if(prior&&prior.scopeId===range.scopeId&&range.startDate<=prior.endDateExclusive){if(range.endDateExclusive>prior.endDateExclusive)prior.endDateExclusive=range.endDateExclusive;}else output.push(structuredClone(range));}
  }
  return output.sort((a,b)=>a.startDate<b.startDate?-1:a.startDate>b.startDate?1:String(a.scopeId)<String(b.scopeId)?-1:1);
}
