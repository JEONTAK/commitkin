#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGithubClient, createGithubPublisher, createCommitkinAction } from '../src/index.mjs';
import { readOnlyGithubFetch } from '../src/infrastructure/github/read-only-fetch.mjs';

const invalid = () => ({ reportVersion: 1, decision: 'hold', code: 'ACTIONS_CONTEXT_INVALID', published: false, progressionAuthorized: false, actualRecordsChanged: false });
export async function executeAction({ environment, fetchImpl, clock = () => new Date().toISOString(), args = [] }) {
  try {
    const env = environment;
    if (!env || args.length || env.GITHUB_ACTIONS !== 'true' || !env.GITHUB_TOKEN || !['workflow_dispatch', 'schedule'].includes(env.GITHUB_EVENT_NAME) || !['true','false'].includes(env.COMMITKIN_DRY_RUN ?? 'true')) return invalid();
    const dryRun = (env.COMMITKIN_DRY_RUN ?? 'true') === 'true';
    const workflowContext = { serverUrl: env.GITHUB_SERVER_URL, apiUrl: env.GITHUB_API_URL, eventName: env.GITHUB_EVENT_NAME, repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID, ownerAccountId: env.GITHUB_REPOSITORY_OWNER_ID, actorAccountId: env.GITHUB_ACTOR_ID, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, startedAt: clock() };
    const factionId = env.COMMITKIN_FACTION ?? '', confirmation = env.COMMITKIN_CONFIRMATION ?? '';
    const initialSelection = factionId || confirmation ? { accountId: env.GITHUB_REPOSITORY_OWNER_ID, factionId, confirmation } : null;
    // One bounded daily analysis stays below the standard 1,000/hour per-repo
    // basic-token allowance, reserving room for publication and other checks.
    const options = { token: env.GITHUB_TOKEN, requestBudget: 900, timeoutMs: 10000, maxResponseBytes: 8 * 1024 * 1024, maxRetries: 1 };
    const client = createGithubClient({ ...options, fetchImpl: readOnlyGithubFetch(fetchImpl) });
    // Dry-run construction has no writer at all. Publication remains a separate
    // capability and can run only after exact owner/source/safety gates pass.
    const publisher = dryRun ? undefined : createGithubPublisher({ ...options, requestBudget: 30, maxRetries: 0, fetchImpl });
    const report = await createCommitkinAction({ client, publisher, clock })({ workflowContext, initialSelection, dryRun });
    return { ...report, githubRequests: client.budget().used + (publisher?.budget().used ?? 0), requestDiagnostics: client.diagnostics() };
  } catch { return invalid(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await executeAction({ environment: process.env, fetchImpl: globalThis.fetch, args: process.argv.slice(2) });
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = ['prepared','published','unchanged'].includes(report.decision) ? 0 : 2;
}
