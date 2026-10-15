import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('liveprobe is denied outsidemanualActions beforeanynetworkorfilewrites',()=>{const run=spawnSync(process.execPath,[fileURLToPath(new URL('../bin/commitkin-readonly-probe.mjs',import.meta.url))],{encoding:'utf8',env:{PATH:process.env.PATH,GITHUB_TOKEN:'never-print-this-fixture-token'}});assert.equal(run.status,1);assert.equal(run.stderr,'');const report=JSON.parse(run.stdout);assert.equal(report.code,'PROBE_CONTEXT_INVALID');assert.equal(report.actualGrowthRecordsWritten,false);assert.doesNotMatch(run.stdout,/never-print/);});
