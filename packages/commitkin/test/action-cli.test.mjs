import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const script = new URL('../bin/commitkin-actions-dry-run.mjs', import.meta.url);
for (const [label, overrides, args] of [
  ['outside Actions', {}, []], ['unsupported event', { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request' }, []],
  ['no token', { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch' }, []],
  ['no live flags', { GITHUB_ACTIONS: 'true' }, ['--publish']],
]) test(`Action diagnostic guard: ${label}`, () => {
  const result = spawnSync(process.execPath, [fileURLToPath(script), ...args], { env: { PATH: process.env.PATH, ...overrides }, encoding: 'utf8' });
  assert.equal(result.status, 2); assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.code, 'ACTIONS_DRY_RUN_CONTEXT_INVALID');
  assert.equal(report.actualRecordsChanged, false); assert.equal(report.progressionAuthorized, false);
  assert.doesNotMatch(result.stdout, /stack|token|Authorization/);
});
test('Action diagnostic has no publisher, writer, user-script or event-file surface', () => {
  const source = readFileSync(script, 'utf8');
  assert.doesNotMatch(source, /createGithubPublisher|\.publish\(|writeFile|child_process|GITHUB_EVENT_PATH/);
  assert.match(source, /options\.method !== 'GET'/);
});
