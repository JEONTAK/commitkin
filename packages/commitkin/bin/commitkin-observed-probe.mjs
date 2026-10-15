#!/usr/bin/env node
import { createGithubClient, collectPublicSources, settleQualifiedActivities } from '../src/index.mjs';
import { qualifyObservedCapture } from '../src/domain/evidence/observed.mjs';
import { OBSERVED_POLICY_REGISTRY } from '../src/infrastructure/policies.mjs';
import { readOnlyGithubFetch } from '../src/infrastructure/github/read-only-fetch.mjs';
const env = process.env;
const report = { reportVersion: 1, diagnostic: 'observed-public-source', sourceModel: 'observed-api-v1', actualRecordsChanged: false, published: false, progressionAuthorized: false };
try {
  if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REPOSITORY !== 'JEONTAK/commitkin' || env.GITHUB_REPOSITORY_ID !== '1420061458' || env.GITHUB_REPOSITORY_OWNER_ID !== '76037656' || env.GITHUB_SERVER_URL !== 'https://github.com' || env.GITHUB_API_URL !== 'https://api.github.com' || !env.GITHUB_TOKEN) throw new Error('OBSERVED_PROBE_CONTEXT_INVALID');
  const client = createGithubClient({ token: env.GITHUB_TOKEN, fetchImpl: readOnlyGithubFetch(globalThis.fetch), requestBudget: 500, timeoutMs: 10000, maxResponseBytes: 8*1024*1024, maxRetries: 1 });
  const metadata = await client.get('/repos/JEONTAK/commitkin');
  if (!metadata.ok || String(metadata.data?.id) !== '1420061458' || String(metadata.data?.owner?.id) !== '76037656' || metadata.data.private !== false || metadata.data.owner.type !== 'User') throw new Error('OBSERVED_PROBE_REPOSITORY_MISMATCH');
  const cutoffDate = new Date().toISOString().slice(0,10), shift = (day,n) => new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10), startDate = shift(cutoffDate,-90);
  const input = { client, repositories:[{id:'1420061458',name:'JEONTAK/commitkin'}], subjectAccountId:'76037656', startDate, cutoffDate, model:'observed-api-v1' };
  const collected = await collectPublicSources(input);
  report.completedDayCollection = { decision: collected.decision, code: collected.code };
  if (collected.decision !== 'ready') throw new Error('OBSERVED_PROBE_COLLECTION_HELD');
  const qualified = qualifyObservedCapture({ capture:collected.capture, subjectAccountId:'76037656',growthStartDate:startDate,cutoffDate,policyRegistry:OBSERVED_POLICY_REGISTRY });
  report.completedDayQualification = { decision:qualified.decision,code:qualified.code,activities:qualified.activities.length };
  if (qualified.decision !== 'qualified') throw new Error('OBSERVED_PROBE_QUALIFICATION_HELD');
  const settled = settleQualifiedActivities({ activities:qualified.activities, reviewHistoryFacts:qualified.reviewHistoryFacts });
  report.completedDaySettlement = { decision:settled.decision,code:settled.code??null };
  if (settled.decision !== 'settled') throw new Error('OBSERVED_PROBE_SETTLEMENT_HELD');
  // Explicit acquisition-only diagnostic includes today's *unsettled* source
  // commit to exercise file/blob pagination. It never qualifies or settles that
  // interval and is not presented as a completed-day character analysis.
  const acquisition = await collectPublicSources({...input,cutoffDate:shift(cutoffDate,1)});
  report.currentDayAcquisitionOnly = { includesUnsettledCurrentDay:true,qualified:false,settled:false,decision:acquisition.decision,code:acquisition.code,fullTextFiles:acquisition.capture?.files.filter(file=>file.contentProof==='text_pair').length??0 };
  if (acquisition.decision !== 'ready') throw new Error('OBSERVED_PROBE_CURRENT_ACQUISITION_HELD');
  const closing = await client.closingIssues({repository:'cli/cli',pullNumber:'14485',maxPages:3});
  report.fixedPublicClosingQuery = { ok:closing.ok,complete:closing.complete,code:closing.code??null };
  if (!closing.ok || !closing.complete) throw new Error('OBSERVED_PROBE_GRAPHQL_HELD');
  report.githubRequests=client.budget().used; report.decision='passed';
} catch (error) {
  const codes = ['OBSERVED_PROBE_CONTEXT_INVALID','OBSERVED_PROBE_REPOSITORY_MISMATCH','OBSERVED_PROBE_COLLECTION_HELD','OBSERVED_PROBE_QUALIFICATION_HELD','OBSERVED_PROBE_SETTLEMENT_HELD','OBSERVED_PROBE_CURRENT_ACQUISITION_HELD','OBSERVED_PROBE_GRAPHQL_HELD'];
  report.decision='hold';report.code=codes.includes(error?.message)?error.message:'OBSERVED_PROBE_UNAVAILABLE';process.exitCode=2;
}
process.stdout.write(JSON.stringify(report)+'\n');
