import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readFile, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { readRecordDirectory } from '../src/infrastructure/read-only-files.js';
import { createValidator } from '../src/index.js';
import { createRecordValidator } from '../src/application/validate-records.js';
import { FIXTURES, PACKAGE, CONTEXT, inputs, objects } from './helpers.js';

function cli(args = []) {
  return spawnSync(process.execPath, ['bin/commitkin-validate.js', ...args], { cwd: PACKAGE, encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, NODE_ENV: 'test' } });
}
function args(fixture = 'ready-40xp') {
  return ['--records', join(FIXTURES, 'valid', fixture), '--owner-account-id', '1001', '--profile-repository-id', '9001', '--now', CONTEXT.now];
}
async function temporary(t) {
  const base = join(PACKAGE, '.test-tmp');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'case-'));
  t.after(() => rm(directory, { recursive: true }));
  return directory;
}
test('CLI record inspection is read-only and requires no token', async () => {
  const directory = join(FIXTURES, 'valid/ready-40xp');
  const before = await readRecordDirectory(directory);
  const run = cli(args());
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(run.stderr, '');
  assert.equal(JSON.parse(run.stdout).code, 'ACCEPT');
  assert.equal(JSON.parse(run.stdout).progressionAuthorized, false);
  assert.deepEqual(await readRecordDirectory(directory), before);
  assert.deepEqual((await readdir(directory)).sort(), ['ledger.json', 'state.json', 'status.json']);
});
test('CLI compares prior/candidate and reports deterministic guard pass', () => {
  const run = cli([...args(), '--previous', join(FIXTURES, 'valid/ready-40xp'), '--operation', 'normal']);
  assert.equal(run.status, 0);
  assert.equal(JSON.parse(run.stdout).transitionCode, 'REPLAY_UNCHANGED');
});
test('CLI pending/preserve/repair are nonzero, never successful refreshes', () => {
  for (const [fixture, code] of [['first-analysis-pending', 'ANALYSIS_PENDING'], ['partial-retain-success', 'RETAIN_SUCCESS'], ['status-only-rebuild', 'STATUS_REBUILD_ALLOWED']]) {
    const run = cli(args(fixture));
    assert.equal(run.status, 1);
    assert.equal(JSON.parse(run.stdout).code, code);
  }
});
test('CLI help and invalid flags have safe exits', () => {
  assert.equal(cli(['--help']).status, 0);
  assert.match(cli(['--help']).stdout, /read-only/);
  for (const extra of [[], ['--token', 'ghp_secret'], [...args(), '--now', CONTEXT.now], [...args(), '--write', 'yes'], [...args(), '--operation', 'normal'], [...args(), '--owner-account-id']]) {
    const run = cli(extra);
    assert.equal(run.status, 2);
    assert.equal(JSON.parse(run.stdout).code, 'CLI_ARGUMENTS_INVALID');
    assert.equal(run.stderr, '');
    assert.ok(!run.stdout.includes('ghp_secret'));
  }
  const invalidContext = args(); invalidContext[3] = 'not-an-id';
  assert.equal(cli(invalidContext).status, 2);
});
test('CLI unreadable directory does not leak paths or stack', () => {
  const options = args(); options[1] = '/nonexistent/secret-value';
  const run = cli(options);
  assert.equal(run.status, 1);
  assert.equal(JSON.parse(run.stdout).code, 'RECORD_DIRECTORY_UNREADABLE');
  assert.ok(!run.stdout.includes('secret-value'));
  assert.equal(run.stderr, '');
});
test('file adapter rejects symlink files, symlink directories, non-regular files and oversized input', async t => {
  const directory = await temporary(t);
  await symlink(join(FIXTURES, 'valid/ready-40xp/state.json'), join(directory, 'state.json'));
  await assert.rejects(readRecordDirectory(directory), { code: 'RECORD_UNREADABLE' });
  await rm(join(directory, 'state.json'));
  await mkdir(join(directory, 'state.json'));
  await assert.rejects(readRecordDirectory(directory), { code: 'RECORD_NOT_REGULAR_FILE' });
  await rm(join(directory, 'state.json'), { recursive: true });
  await writeFile(join(directory, 'state.json'), Buffer.alloc(1048577, 32));
  await assert.rejects(readRecordDirectory(directory), { code: 'INPUT_TOO_LARGE' });
  await symlink(join(FIXTURES, 'valid/ready-40xp'), join(directory, 'linked'));
  await assert.rejects(readRecordDirectory(join(directory, 'linked')), { code: 'RECORD_DIRECTORY_INVALID' });
  await assert.rejects(readRecordDirectory(join(directory, 'state.json')), { code: 'RECORD_DIRECTORY_INVALID' });
});
test('missing status never creates a file; missing primaries remain missing', async t => {
  const directory = await temporary(t);
  const raw = inputs();
  await writeFile(join(directory, 'state.json'), raw.state);
  await writeFile(join(directory, 'ledger.json'), raw.ledger);
  const validate = createValidator();
  assert.equal(validate(await readRecordDirectory(directory), CONTEXT).code, 'STATUS_REBUILD_ALLOWED');
  assert.deepEqual((await readdir(directory)).sort(), ['ledger.json', 'state.json']);
  await rm(join(directory, 'state.json'));
  assert.equal(validate(await readRecordDirectory(directory), CONTEXT).code, 'RECORD_MISSING');
});
test('network-disabled composition still validates with bundled schemas', t => {
  for (const [object, method] of [[net, 'connect'], [net, 'createConnection'], [http, 'request'], [http, 'get'], [https, 'request'], [https, 'get'], [globalThis, 'fetch']]) {
    t.mock.method(object, method, () => assert.fail('Network forbidden'));
  }
  assert.equal(createValidator()(inputs(), CONTEXT).code, 'ACCEPT');
});
test('unexpected adapter failures are sanitized, never raw messages', () => {
  const validator = createRecordValidator({ parse() { throw new Error('ghp_secret private/path'); }, schema: { validateReference() { return true; } } });
  const report = validator(inputs(), CONTEXT);
  assert.equal(report.code, 'VALIDATOR_UNAVAILABLE');
  assert.ok(!JSON.stringify(report).includes('ghp_secret'));
  assert.equal(validator(inputs(), { ...CONTEXT, sourceProofVerified: true }).code, 'VALIDATION_CONTEXT_INVALID');
  assert.equal(validator(inputs(), { ...CONTEXT, operation: 'correct' }).code, 'VALIDATION_CONTEXT_INVALID');
  assert.equal(validator(inputs(), null).code, 'VALIDATION_CONTEXT_INVALID');
});
test('query layers have no filesystem/network/process imports; adapters have no write API', async () => {
  for (const layer of ['domain', 'application']) {
    for (const file of await readdir(join(PACKAGE, 'src', layer))) {
      const source = await readFile(join(PACKAGE, 'src', layer, file), 'utf8');
      assert.doesNotMatch(source, /(?:from|import\()\s*['"]node:(?:fs|net|http|https|child_process|worker_threads)/);
      assert.doesNotMatch(source, /\b(?:fetch|process\.env)\b/);
    }
  }
  const adapter = await readFile(join(PACKAGE, 'src/infrastructure/read-only-files.js'), 'utf8');
  assert.doesNotMatch(adapter.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''), /\b(?:writeFile|appendFile|rename|unlink|rm|mkdir|truncate|O_WRONLY|O_RDWR|O_CREAT)\b/);
  assert.equal(objects().state.growth.totalXp, '40');
});
