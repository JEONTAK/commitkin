#!/usr/bin/env node
import { createGithubProfileSync } from '../src/infrastructure/github/profile-sync.mjs';

const env = process.env;
const invalid = () => ({ reportVersion: 1, reportType: 'profile-sync', decision: 'hold', stage: 'environment', code: 'PROFILE_ACTION_CONTEXT_INVALID', dryRun: true,
  published: false, profileChanged: false, growthRecordsChanged: false, progressionAuthorized: false, publicationOutcome: 'not_published' });
let report;
try {
  const rawDryRun = env.COMMITKIN_DRY_RUN ?? 'true';
  const rawInitialize = env.COMMITKIN_INITIALIZE_README ?? 'false';
  if (process.argv.length !== 2 || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !env.GITHUB_TOKEN || !['true', 'false'].includes(rawDryRun) || !['true', 'false'].includes(rawInitialize)) report = invalid();
  else {
    const clock = () => new Date().toISOString();
    const workflowContext = { serverUrl: env.GITHUB_SERVER_URL, apiUrl: env.GITHUB_API_URL, eventName: env.GITHUB_EVENT_NAME, repository: env.GITHUB_REPOSITORY,
      repositoryId: env.GITHUB_REPOSITORY_ID, ownerAccountId: env.GITHUB_REPOSITORY_OWNER_ID, actorAccountId: env.GITHUB_ACTOR_ID, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, startedAt: clock() };
    report = await createGithubProfileSync({ token: env.GITHUB_TOKEN, fetchImpl: globalThis.fetch, clock })({ workflowContext,
      sourceRepository: env.COMMITKIN_SOURCE_REPOSITORY || undefined, dryRun: rawDryRun === 'true', initializeIfMissing: rawInitialize === 'true' });
  }
} catch { report = invalid(); }
process.stdout.write(JSON.stringify(report) + '\n');
process.exitCode = ['prepared', 'unchanged', 'published'].includes(report.decision) ? 0 : 2;
