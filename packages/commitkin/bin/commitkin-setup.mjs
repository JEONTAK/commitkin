#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeAction } from './commitkin-actions.mjs';
import { setupSummary } from '../src/presentation/setup.mjs';

const invalid = code => ({ reportVersion: 1, decision: 'hold', code, published: false, progressionAuthorized: false, actualRecordsChanged: false, publicationOutcome: 'not_published' });

/** UI adapter only: existing identity, recovery, faction and publication gates remain authoritative. */
export async function executeSetup({ environment: env, fetchImpl, clock, args = [], runAction = executeAction }) {
  let report; let summary; let started = false;
  const mode = env?.COMMITKIN_SETUP_MODE ?? 'preview';
  const faction = env?.COMMITKIN_FACTION ?? '';
  const confirmed = env?.COMMITKIN_CONFIRM_FACTION ?? 'false';
  try {
    if (args.length || env?.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_SERVER_URL !== 'https://github.com' || env.GITHUB_API_URL !== 'https://api.github.com' || !env.GITHUB_TOKEN || !['preview', 'save'].includes(mode) || !['', 'bloomguard', 'ashbound'].includes(faction) || !['true', 'false'].includes(confirmed)) return { report: invalid('SETUP_INPUT_INVALID'), summary: '' };
    // Validate output bindings before invoking any acquisition/publication capability.
    setupSummary({ sourceRepository: env.GITHUB_REPOSITORY, mode, report: invalid('SETUP_INPUT_INVALID') });
    if (mode === 'save' && faction && confirmed !== 'true') report = invalid('SETUP_FACTION_CONFIRMATION_REQUIRED');
    else if (!faction && confirmed === 'true') report = invalid('SETUP_FACTION_REQUIRED');
    else {
      started = true;
      report = await runAction({ environment: { ...env, COMMITKIN_DRY_RUN: mode === 'preview' ? 'true' : 'false', COMMITKIN_CONFIRMATION: faction ? 'CONFIRM_PERMANENT_FACTION' : '' }, fetchImpl, clock, args: [] });
    }
    summary = setupSummary({ sourceRepository: env.GITHUB_REPOSITORY, mode, report });
  } catch {
    // Do not hide an uncertain or successful publication behind a summary error.
    const fallback = invalid(started ? 'SETUP_RUN_UNAVAILABLE' : 'SETUP_INPUT_INVALID');
    if (started && mode === 'save') Object.assign(fallback, { actualRecordsChanged: null, publicationOutcome: 'outcome_unknown' });
    return { report: report ? { ...report, setupSummaryCode: 'SETUP_SUMMARY_UNAVAILABLE' } : fallback, summary: '' };
  }
  return { report, summary };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await executeSetup({ environment: process.env, fetchImpl: globalThis.fetch, args: process.argv.slice(2) });
  if (process.env.GITHUB_STEP_SUMMARY && result.summary) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, result.summary, 'utf8'); }
    catch { result.report.setupSummaryCode = 'SETUP_SUMMARY_UNAVAILABLE'; }
  }
  process.stdout.write(JSON.stringify(result.report) + '\n');
  process.exitCode = ['prepared', 'published', 'unchanged'].includes(result.report.decision) ? 0 : 2;
}
