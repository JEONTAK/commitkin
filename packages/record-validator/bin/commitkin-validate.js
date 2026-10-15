#!/usr/bin/env node
import { createValidator } from '../src/index.js';
import { readRecordDirectory } from '../src/infrastructure/read-only-files.js';
import { failureReport, ValidationFailure } from '../src/domain/failure.js';

const HELP = `Commitkin local read-only validator (phase 1)
Usage: node bin/commitkin-validate.js --records DIR --owner-account-id ID
       --profile-repository-id ID --now UTC_TIMESTAMP
       [--previous DIR --operation normal|failed-collection|metadata-only|status-only]
       [--evaluation-started-at UTC_TIMESTAMP]

Only reads state.json, ledger.json and optional status.json. JSON report to stdout.
Exit 0: internally consistent records/guards (NOT progression authorization).
Exit 1: hold, preserve, pending or status-only repair guidance. Exit 2: CLI/internal failure.
No GitHub/network, growth calculation, record writes or automatic recovery.
`;

function parseArguments(args) {
  const options = new Map();
  const allowed = ['--records', '--owner-account-id', '--profile-repository-id', '--now', '--previous', '--operation', '--evaluation-started-at'];
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.includes(args[i]) || options.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new ValidationFailure('input', 'CLI_ARGUMENTS_INVALID');
    options.set(args[i], args[i + 1]);
  }
  if (!allowed.slice(0, 4).every(key => options.has(key)) || ((options.has('--operation') || options.has('--evaluation-started-at')) && !options.has('--previous'))) throw new ValidationFailure('input', 'CLI_ARGUMENTS_INVALID');
  return options;
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--help') process.stdout.write(HELP);
  else {
    const options = parseArguments(process.argv.slice(2));
    const context = {
      expectedOwner: { accountId: options.get('--owner-account-id'), profileRepositoryId: options.get('--profile-repository-id') },
      now: options.get('--now'), operation: options.get('--operation') ?? 'normal',
    };
    if (options.has('--evaluation-started-at')) context.evaluationStartedAt = options.get('--evaluation-started-at');
    const validate = createValidator();
    const records = await readRecordDirectory(options.get('--records'));
    const previous = options.has('--previous') ? await readRecordDirectory(options.get('--previous')) : null;
    const report = validate(records, context, previous);
    process.stdout.write(JSON.stringify(report) + '\n');
    process.exitCode = report.code === 'ACCEPT' ? 0 : report.stage === 'input' || report.stage === 'internal' ? 2 : 1;
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ reportVersion: 1, progressionAuthorized: false, ...failureReport(error) }) + '\n');
  process.exitCode = error instanceof ValidationFailure && error.stage !== 'input' ? 1 : 2;
}
