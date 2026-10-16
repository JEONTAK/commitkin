import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executeSetup } from '../bin/commitkin-setup.mjs';
import { profileConnectionWorkflow, setupSummary, PROFILE_SYNC_REF } from '../src/presentation/setup.mjs';

const TOKEN = 'synthetic-setup-private-marker';
const env = changes => ({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_TOKEN: TOKEN,
  GITHUB_SERVER_URL: 'https://github.com', GITHUB_API_URL: 'https://api.github.com', GITHUB_REPOSITORY: 'HeroA/my-character',
  COMMITKIN_SETUP_MODE: 'preview', COMMITKIN_FACTION: '', COMMITKIN_CONFIRM_FACTION: 'false', ...changes });
const report = changes => ({ decision: 'prepared', code: 'DRY_RUN_READY', dryRun: true, published: false, actualRecordsChanged: false,
  progressionAuthorized: false, publicationOutcome: 'not_published', ...changes });
const published = () => report({ decision: 'published', code: 'PUBLISHED', dryRun: false, published: true, actualRecordsChanged: true, progressionAuthorized: true, publicationOutcome: 'published' });
const renderSummary = (value, mode = 'save') => setupSummary({ sourceRepository: 'HeroA/my-character', mode, report: value });

for (const faction of ['bloomguard', 'ashbound']) {
  test('preview maps '+faction+' without a typed phrase or permanent-choice checkbox and forces dry run', async () => {
    const environment = env({ COMMITKIN_FACTION: faction, COMMITKIN_DRY_RUN: 'false', COMMITKIN_CONFIRMATION: TOKEN });
    const before = { ...environment }; let received;
    const result = await executeSetup({ environment, runAction: async input => { received = input.environment; return report(); } });
    assert.equal(received.COMMITKIN_DRY_RUN, 'true'); assert.equal(received.COMMITKIN_FACTION, faction);
    assert.equal(received.COMMITKIN_CONFIRMATION, 'CONFIRM_PERMANENT_FACTION'); assert.deepEqual(environment, before);
    assert.match(result.summary, /Nothing was saved or locked/); assert.doesNotMatch(result.summary, /```yaml|synthetic-setup/);
    assert.equal(result.report.actualRecordsChanged, false);
  });
  test('first save '+faction+' requires an explicit checkbox and delegates unchanged core confirmation', async () => {
    let received;
    const result = await executeSetup({ environment: env({ COMMITKIN_SETUP_MODE: 'save', COMMITKIN_FACTION: faction, COMMITKIN_CONFIRM_FACTION: 'true', COMMITKIN_DRY_RUN: 'true' }),
      runAction: async input => { received = input.environment; return published(); } });
    assert.equal(received.COMMITKIN_DRY_RUN, 'false'); assert.equal(received.COMMITKIN_CONFIRMATION, 'CONFIRM_PERMANENT_FACTION');
    assert.equal(result.report.published, true); assert.match(result.summary, /Character saved/); assert.match(result.summary, /source-repository: 'HeroA\/my-character'/);
  });
}
test('ordinary update leaves faction and confirmation empty and reuses existing gates', async () => {
  const result = await executeSetup({ environment: env({ COMMITKIN_SETUP_MODE: 'save' }), runAction: async input => {
    assert.equal(input.environment.COMMITKIN_FACTION, ''); assert.equal(input.environment.COMMITKIN_CONFIRMATION, ''); return published();
  } });
  assert.match(result.summary, /HeroA\/HeroA/); assert.match(result.summary, /connect_if_missing/);
});
for (const [label, changes, expected, args = []] of [
  ['unconfirmed first save', { COMMITKIN_SETUP_MODE: 'save', COMMITKIN_FACTION: 'bloomguard' }, 'SETUP_FACTION_CONFIRMATION_REQUIRED'],
  ['checkbox without faction', { COMMITKIN_CONFIRM_FACTION: 'true' }, 'SETUP_FACTION_REQUIRED'],
  ['outside Actions', { GITHUB_ACTIONS: 'false' }, 'SETUP_INPUT_INVALID'],
  ['no token', { GITHUB_TOKEN: '' }, 'SETUP_INPUT_INVALID'],
  ['push event', { GITHUB_EVENT_NAME: 'push' }, 'SETUP_INPUT_INVALID'],
  ['timer event', { GITHUB_EVENT_NAME: 'schedule' }, 'SETUP_INPUT_INVALID'],
  ['enterprise server', { GITHUB_SERVER_URL: 'https://enterprise.example' }, 'SETUP_INPUT_INVALID'],
  ['unsafe API', { GITHUB_API_URL: 'https://evil.invalid' }, 'SETUP_INPUT_INVALID'],
  ['unknown mode', { COMMITKIN_SETUP_MODE: 'publish' }, 'SETUP_INPUT_INVALID'],
  ['unknown faction', { COMMITKIN_FACTION: 'random' }, 'SETUP_INPUT_INVALID'],
  ['not a boolean', { COMMITKIN_CONFIRM_FACTION: 'yes' }, 'SETUP_INPUT_INVALID'],
  ['upper boolean', { COMMITKIN_CONFIRM_FACTION: 'TRUE' }, 'SETUP_INPUT_INVALID'],
  ['profile storage', { GITHUB_REPOSITORY: 'HeroA/HeroA' }, 'SETUP_INPUT_INVALID'],
  ['unsafe slug', { GITHUB_REPOSITORY: 'HeroA/repo\nrun: '+TOKEN }, 'SETUP_INPUT_INVALID'],
  ['extra args', {}, 'SETUP_INPUT_INVALID', ['--live']],
]) test('setup refuses '+label+' before the core runner or network', async () => {
  const result = await executeSetup({ environment: env(changes), args, runAction: () => { assert.fail('must not enter core runner'); }, fetchImpl: () => assert.fail('must not fetch') });
  assert.equal(result.report.code, expected); assert.equal(result.report.published, false); assert.equal(result.report.actualRecordsChanged, false);
  assert.doesNotMatch(result.summary, /```yaml|synthetic-setup/);
});
test('defaults remain preview and preserve real owner/context rejection before HTTP', async () => {
  const result = await executeSetup({ environment: env({ COMMITKIN_SETUP_MODE: undefined }), fetchImpl: () => assert.fail('invalid owner context must not fetch') });
  assert.equal(result.report.decision, 'hold'); assert.equal(result.report.actualRecordsChanged, false);
});
test('undefined environment fails closed without disclosing errors', async () => {
  assert.equal((await executeSetup({})).report.code, 'SETUP_INPUT_INVALID');
});
for (const code of ['FACTION_ALREADY_CONFIRMED', 'RECOVERY_REQUIRED', 'INSTALLATION_OWNER_MISMATCH', 'PUBLICATION_REF_CHANGED']) {
  test('core safety hold is not bypassed by setup: '+code, async () => {
    const held = report({ decision: 'hold', code });
    const result = await executeSetup({ environment: env({ COMMITKIN_SETUP_MODE: 'save' }), runAction: async () => held });
    assert.deepEqual(result.report, held); assert.match(result.summary, new RegExp(code)); assert.doesNotMatch(result.summary, /```yaml/);
  });
}
test('pending reservation discloses permanent faction but does not offer a premature profile connection', () => {
  const pending = { ...published(), progressionAuthorized: false, code: 'PUBLISHED' };
  const summary = renderSummary(pending); assert.match(summary, /Faction saved permanently/); assert.match(summary, /XP and class are not finalized/); assert.doesNotMatch(summary, /```yaml/);
});
test('read-only unchanged snapshot can recover connection code without saving again', () => {
  const summary = renderSummary(report({ decision: 'unchanged', code: 'REPLAY_UNCHANGED' }), 'preview');
  assert.match(summary, /Saved character unchanged/); assert.match(summary, /```yaml/);
});
test('pending preview never describes a saved or ready character', () => {
  const summary = renderSummary(report({ decision: 'pending', code: 'INITIAL_FACTION_RESERVED_ANALYSIS_PENDING' }), 'preview');
  assert.match(summary, /Nothing was saved or locked/); assert.doesNotMatch(summary, /```yaml|Character saved/);
});
test('existing-character preview never asks the owner to reselect the permanent faction', () => {
  const summary = renderSummary(report({ summary: { firstInstallation: false } }), 'preview');
  assert.match(summary, /faction empty/); assert.match(summary, /unchecked/); assert.doesNotMatch(summary, /same faction|confirm_faction\*\* checked/);
});
test('uncertain publication stays unknown and requests inspection, not blind retry', async () => {
  const uncertain = report({ decision: 'hold', code: 'PUBLICATION_REF_UNCONFIRMED', actualRecordsChanged: null, publicationOutcome: 'outcome_unknown' });
  const result = await executeSetup({ environment: env({ COMMITKIN_SETUP_MODE: 'save' }), runAction: async () => uncertain });
  assert.equal(result.report.actualRecordsChanged, null); assert.match(result.summary, /outcome is unknown/); assert.doesNotMatch(result.summary, /```yaml/);
});
for (const mode of ['preview', 'save']) test('unexpected runner failure does not fabricate write certainty in '+mode, async () => {
  const result = await executeSetup({ environment: env({ COMMITKIN_SETUP_MODE: mode }), runAction: () => { throw new Error(TOKEN); } });
  assert.equal(result.report.code, 'SETUP_RUN_UNAVAILABLE'); assert.equal(result.report.actualRecordsChanged, mode === 'save' ? null : false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
});
test('summary failure cannot erase a completed publication report', async () => {
  const result = await executeSetup({ environment: env({ COMMITKIN_SETUP_MODE: 'save' }), runAction: async () => null });
  assert.equal(result.report.actualRecordsChanged, null); assert.equal(result.report.publicationOutcome, 'outcome_unknown');
  const environment = env({ COMMITKIN_SETUP_MODE: 'save' });
  const completed = await executeSetup({ environment, runAction: async () => { environment.GITHUB_REPOSITORY = 'invalid'; return published(); } });
  assert.equal(completed.report.published, true); assert.equal(completed.report.actualRecordsChanged, true); assert.equal(completed.report.setupSummaryCode, 'SETUP_SUMMARY_UNAVAILABLE');
});
for (const repository of ['Other/commitkin', 'HeroA/custom-name', 'JEONTAK/commitkin-character']) {
  test('personalized workflow keeps exact fork path and immutable upstream renderer: '+repository, () => {
    const workflow = profileConnectionWorkflow(repository);
    assert.match(workflow, new RegExp("source-repository: '"+repository+"'")); assert.match(workflow, new RegExp('profile-sync@'+PROFILE_SYNC_REF));
    assert.match(PROFILE_SYNC_REF, /^[a-f0-9]{40}$/); assert.match(workflow, /default: preview/); assert.match(workflow, /default: false/);
    assert.match(workflow, /contents: read/); assert.match(workflow, /contents: write/); assert.match(workflow, /inputs.mode == 'preview'/); assert.match(workflow, /inputs.mode == 'publish'/);
    assert.doesNotMatch(workflow, /schedule:|push:|pull_request|workflow_run|repository_dispatch|<reviewed|YOUR_LOGIN|secrets\.|@main|@v1/);
    assert.doesNotMatch(workflow, /actions\/checkout|uses:.*(?:Other|HeroA)\//);
  });
}
for (const repository of [undefined, 'HeroA/HeroA', '/repo', 'a/..', 'a/repo/x', 'https://github.com/a/b', 'a/repo?token='+TOKEN, "a/foo'", 'a/foo${{ bad }}']) {
  test('personalized workflow rejects unsafe slug '+JSON.stringify(repository), () => assert.throws(() => profileConnectionWorkflow(repository), /REPOSITORY/));
}
test('summary does not render arbitrary error text as Markdown', () => {
  const summary = renderSummary(report({ decision: 'hold', code: 'x\n```\n'+TOKEN }));
  assert.match(summary, /SETUP_UNAVAILABLE/); assert.doesNotMatch(summary, new RegExp(TOKEN));
});
test('inherited setup workflow has separate manual-only read/write jobs and no interpolated shell input', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/commitkin.yml', import.meta.url), 'utf8');
  assert.match(workflow, /name: Set up Commitkin/); assert.match(workflow, /options: \[preview, save\]/);
  assert.match(workflow, /inputs.mode == 'preview'/); assert.match(workflow, /inputs.mode == 'save'/);
  assert.match(workflow, /confirm_faction:[\s\S]*type: boolean[\s\S]*default: false/);
  assert.equal(workflow.match(/uses: \.\/setup/g).length, 2); assert.equal(workflow.match(/persist-credentials: false/g).length, 2);
  assert.doesNotMatch(workflow, /run:|schedule:|push:|workflow_run|repository_dispatch|confirmation:/);
});
test('setup CLI fails closed and writes no job summary for invalid input', t => {
  const directory = mkdtempSync(join(tmpdir(), 'commitkin-setup-cli-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'summary.md');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/commitkin-setup.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, ...env({ COMMITKIN_SETUP_MODE: 'bad' }), GITHUB_STEP_SUMMARY: path }, encoding: 'utf8',
  });
  assert.equal(result.status, 2); assert.equal(result.stderr, ''); assert.equal(JSON.parse(result.stdout).code, 'SETUP_INPUT_INVALID');
  assert.throws(() => readFileSync(path), { code: 'ENOENT' }); assert.doesNotMatch(result.stdout, new RegExp(TOKEN));
});
test('setup CLI publishes human-readable confirmation guidance to the runner summary only', t => {
  const directory = mkdtempSync(join(tmpdir(), 'commitkin-setup-summary-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'summary.md');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/commitkin-setup.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, ...env({ COMMITKIN_SETUP_MODE: 'save', COMMITKIN_FACTION: 'bloomguard' }), GITHUB_STEP_SUMMARY: path }, encoding: 'utf8',
  });
  assert.equal(result.status, 2); const summary = readFileSync(path, 'utf8'); assert.match(summary, /SETUP_FACTION_CONFIRMATION_REQUIRED/); assert.doesNotMatch(summary, new RegExp(TOKEN));
  const unwritable = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/commitkin-setup.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, ...env({ COMMITKIN_SETUP_MODE: 'save', COMMITKIN_FACTION: 'bloomguard' }), GITHUB_STEP_SUMMARY: directory }, encoding: 'utf8',
  });
  assert.equal(unwritable.status, 2); assert.equal(JSON.parse(unwritable.stdout).setupSummaryCode, 'SETUP_SUMMARY_UNAVAILABLE'); assert.equal(unwritable.stderr, '');
});
