import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEvidenceVerifier } from '../src/index.mjs';
import { digest } from '../../record-validator/src/domain/hash.js';
const root=new URL('../../../test/fixtures/evidence/preflight-v1/',import.meta.url);
const read=(path)=>readFileSync(new URL(path,root));
const object=path=>JSON.parse(read(path));
const manifest=object('cases.json').cases;
const fixed=JSON.parse(readFileSync(new URL('../../../test/fixtures/evidence/v1/fixture-context.json',import.meta.url)));
const policyRegistry={fileRules:[fixed.policies.fileRules],bugLabels:[fixed.policies.bugLabels]};
const verifier=createEvidenceVerifier({policyRegistry});
const encode=value=>Buffer.from(JSON.stringify(value));
function recordBundle(reference){if(reference.includes('#')){const[file,pointer]=reference.split('#');let value=object(file);for(const part of pointer.split('/').filter(Boolean))value=value[part];return Object.fromEntries(Object.entries(value).map(([role,data])=>[role,encode(data)]));}return Object.fromEntries(['state','ledger','status'].map(role=>[role,read(reference+'/'+role+'.json')]));}
function request(id){const row=manifest.find(item=>item.caseId===id);return{context:read(row.contextFixture),evidence:read(row.evidenceFixture),candidate:recordBundle(row.baseRecordFixture),previous:row.previousRecordFixture?recordBundle(row.previousRecordFixture):null};}
function blob(value){return createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');}
function realBlobVariant(input){const evidence=JSON.parse(input.evidence);for(const file of evidence.resources.fileChanges){if(file.content.mode==='text_pair')for(const side of['before','after'])file[side+'Oid']=file.content[side+'Text']===null?null:blob(file.content[side+'Text']);}return{...input,evidence:encode(evidence)};}
for(const id of['ES-N01','ES-N02','ES-N04','ES-N06'])test('composed schemas->sources->XP candidate match '+id,()=>{const input=realBlobVariant(request(id));const before=structuredClone(input);const result=verifier(input);assert.equal(result.decision,'accept_relative_to_evidence',JSON.stringify(result));assert.equal(result.progressionAuthorized,false);assert.equal(result.sourceAuthenticity,'not_checked');assert.deepEqual(structuredClone(input),before);});
test('page array permutation preserves composed eligibility/order/allocation; remainingaggregatechecksareexplicit',()=>{
  const input=realBlobVariant(request('ES-N02'));const evidence=JSON.parse(input.evidence);const collection=evidence.collections.find(item=>item.resourceType==='pull_request'&&item.target.kind==='repository');
  const first=collection.pages[0],second=structuredClone(first);second.ref='second-pr-page';second.sequence=2;second.requestCursor='next';first.response.pagination={state:'more',nextCursor:'next'};first.response.itemRefs=[];second.response.pagination={state:'end',nextCursor:null};collection.pages=[second,first];
  const pr=evidence.resources.pullRequests[0];pr.captureRefs=pr.captureRefs.map(ref=>ref===first.ref?second.ref:ref);input.evidence=encode(evidence);
  const result=verifier(input);assert.equal(result.decision,'accept_relative_to_evidence',result.code);
  for(const check of['coverageConsistency','sourceRevisionAuthenticity','policyCatalogSemantics','sourceAuthenticity'])assert.ok(result.notChecked.includes(check));
});
test('structural normal doesnot hide fabricated blob content',()=>{assert.equal(verifier(request('ES-N02')).code,'FILE_CONTENT_OID_MISMATCH');});
test('default registry cannot promote syntheticfixture policies through CLI/library defaults',()=>{const result=createEvidenceVerifier()(request('ES-N01'));assert.equal(result.code,'POLICY_UNSUPPORTED');assert.equal(result.progressionAuthorized,false);});
test('eligible unpaid missing facts and altered reward claim are independently rejected',()=>{
  const input=realBlobVariant(request('ES-N02'));const ledger=JSON.parse(input.candidate.ledger),state=JSON.parse(input.candidate.state);
  ledger.facts=[];ledger.days=[];state.growth.totalXp='0';state.integrity.ledgerHash=digest(ledger);input.candidate={...input.candidate,ledger:encode(ledger),state:encode(state)};
  const evidence=JSON.parse(input.evidence);evidence.binding.candidateLedgerHash=digest(ledger);input.evidence=encode(evidence);
  assert.equal(verifier(input).code,'QUALIFYING_FACTS_MISMATCH');
});
const cli=new URL('../bin/commitkin.mjs',import.meta.url);
for(const args of[[],['--token','never-log-me'],['preflight','--force','true'],['demo','--faction','ashbound','--name','../escape'],['demo','--faction','unknown','--name','unused']])test('CLI safe invalid invocation '+args.join(' '),()=>{const run=spawnSync(process.execPath,[fileURLToPath(cli),...args],{encoding:'utf8'});assert.equal(run.status,2);assert.equal(run.stderr,'');assert.doesNotMatch(run.stdout,/never-log-me|escape|Error:|stack/);assert.equal(JSON.parse(run.stdout).progressionAuthorized,false);});
test('CLI help hasno livecapability and preflight readsfixturesonly',()=>{const help=spawnSync(process.execPath,[fileURLToPath(cli),'--help'],{encoding:'utf8'});assert.equal(help.status,0);assert.match(help.stdout,/No token/);const row=manifest[0];const path=name=>fileURLToPath(new URL(name,root));const run=spawnSync(process.execPath,[fileURLToPath(cli),'preflight','--context',path(row.contextFixture),'--evidence',path(row.evidenceFixture),'--records',path(row.baseRecordFixture)],{encoding:'utf8'});assert.equal(run.status,0,run.stdout);assert.equal(JSON.parse(run.stdout).decision,'preflight_passed');});
