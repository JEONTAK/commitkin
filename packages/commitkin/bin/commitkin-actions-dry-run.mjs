#!/usr/bin/env node
import { createGithubClient, createReadonlyRefresh } from '../src/index.mjs';

// Deliberately no file writer or publisher. Even a successful plan only reports
// counts; source captures and prepared record bytes never leave process memory.
const env = process.env;
const invalid = () => ({ reportVersion: 1, decision: 'hold', stage: 'environment', code: 'ACTIONS_DRY_RUN_CONTEXT_INVALID', actualRecordsChanged: false, published: false, progressionAuthorized: false });
let report;
try {
  if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== 'true' || !env.GITHUB_TOKEN || !['workflow_dispatch', 'schedule'].includes(env.GITHUB_EVENT_NAME)) report = invalid();
  else {
    const clock = () => new Date().toISOString();
    const workflowContext = { serverUrl: env.GITHUB_SERVER_URL, apiUrl: env.GITHUB_API_URL, eventName: env.GITHUB_EVENT_NAME, repository: env.GITHUB_REPOSITORY, repositoryId: env.GITHUB_REPOSITORY_ID, ownerAccountId: env.GITHUB_REPOSITORY_OWNER_ID, actorAccountId: env.GITHUB_ACTOR_ID, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, startedAt: clock() };
    const factionId = env.COMMITKIN_FACTION ?? '', confirmation = env.COMMITKIN_CONFIRMATION ?? '';
    const initialSelection = factionId || confirmation ? { accountId: env.GITHUB_REPOSITORY_OWNER_ID, factionId, confirmation } : null;
    const client = createGithubClient({ token: env.GITHUB_TOKEN, requestBudget: 500, timeoutMs: 10000, maxResponseBytes: 8 * 1024 * 1024, maxRetries: 1,
      fetchImpl: (url, options) => { if (options.method !== 'GET') throw new TypeError('READ_ONLY_CAPABILITY'); return globalThis.fetch(url, options); } });
    const result = await createReadonlyRefresh({ client, clock })({ workflowContext, initialSelection });
    report = { reportVersion: 1, decision: result.decision, stage: result.stage, code: result.code, summary: result.summary ?? null,
      filesPrepared: result.files?.length ?? 0, githubRequests: client.budget().used, sourceAuthenticity: 'not_checked', actualRecordsChanged: false, published: false, progressionAuthorized: false };
  }
} catch { report = invalid(); }
process.stdout.write(JSON.stringify(report) + '\n');
process.exitCode = ['prepared', 'unchanged'].includes(report.decision) ? 0 : 2;
