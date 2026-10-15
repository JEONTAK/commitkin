import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
const path = new URL('../bin/commitkin-observed-probe.mjs',import.meta.url);
test('observed probe cannot run outside its fixed manual diagnostic Actions context',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(path)],{env:{PATH:process.env.PATH},encoding:'utf8'});
  assert.equal(result.status,2);assert.equal(result.stderr,'');
  const report=JSON.parse(result.stdout);assert.equal(report.code,'OBSERVED_PROBE_CONTEXT_INVALID');assert.equal(report.actualRecordsChanged,false);assert.equal(report.progressionAuthorized,false);
});
test('current-day diagnostic is acquisition-only and imports no writer or record output surface',()=>{
  const source=readFileSync(path,'utf8');
  assert.match(source,/includesUnsettledCurrentDay:true,qualified:false,settled:false/);
  assert.doesNotMatch(source,/createGithubPublisher|\.publish\(|writeFile|node:fs|preview-output/);
});
