# Offline evidence schema fixtures — v1

Synthetic contract artifacts for Commitkin. These are not live growth records, GitHub responses, a production policy registry, or permission to initialize/publish a character.

## Contents

- Four Draft 2020-12 schemas: [common](../../../../schemas/evidence/v1/common.schema.json), [resources](../../../../schemas/evidence/v1/resources.schema.json), [collections](../../../../schemas/evidence/v1/collections.schema.json), [evidence](../../../../schemas/evidence/v1/evidence.schema.json).
- [Case manifest](cases.json): 12 normal scenarios, eight insufficient-evidence scenarios, and 46 staged errors (seven raw, three compatibility, ten schema, 12 references/bindings, eight eligibility/history, six reward/retention).
- [Structural probes](schema-probes.json): 879 assertions, including all 75 object-schema nodes' required-field omission/null behavior, closed objects, enum members, and source-state/file/page branches.
- [Record contexts](record-contexts.json): 13 fictional previous/candidate bundles; other cases reuse unchanged [record fixtures](../../records/v1/README.md).
- [Fixture context](fixture-context.json): fictional subject/scope, test-only rule bodies/digests, and 26 identity construction vectors.
- [Boundary descriptors](boundary-cases.json), [ordering vectors](ordering-vectors.json), [E-01–E-30 traceability](coverage-matrix.json), and [local results](verification-results.json).

Paths in cases.json resolve relative to this directory. A record-contexts.json#/contexts/<name> reference selects that synthetic bundle; ../../records/v1/valid/<name> selects the original three-file bundle. These are test-manifest references, never caller-directed retrieval instructions inside evidence.json.

The fixed fixture-files-v1 and fixture-bug-labels-v1 bodies are explicitly test-only. They do not settle the production pattern/label catalog or add public configuration options. Schema accepts the descriptor's syntax; production catalog membership, matching inline body/digest, source coverage and meaning still require the later verifier. A matching hash cannot authorize arbitrary rules. ES-B07 deliberately supplies a matching digest for an unsupported body.

## What schema validation means

| Input group | Count | Actual local outcome |
|---|---:|---|
| Normal ES-N01–ES-N12 | 12 | Schema accepted; source/XP expectations not executed |
| Insufficient ES-H01–ES-H08 | 8 | Schema accepted; required gaps are not zero activity or successful settlement |
| References/eligibility/reward errors | 26 | Schema accepted; intended later-stage rejection/hold not executed |
| Schema errors | 10 | Schema rejected |
| Compatibility examples | 3 | Current v1 schema rejected; actual compatible-tool routing is not implemented |
| Raw errors | 7 | Existing strict parser rejected before schema |
| Byte/depth boundaries | 6 | Existing strict parser's boundary contract checked separately |

The manifest's expectedStage/expectedCheck/expectedCode/expectedDecision are future fixture targets, not actual semantic results or a published diagnostic enum. localSchemaExpected records only this check's oracle. semanticExecution remains not_run. The coverage matrix preserves E-01–E-30 and explicitly identifies partial/missing variants; it is not a passed semantic suite.

All 12 normal XP expectations are fixed, not computed by a new allocator: 0, 40, 20, 25, 35, 20, 40, 10, 100, 100, 100, 40 for the stated original UTC date. N09 declares 160 before the cap and pays common bonuses 30, PRs 40, review 15, release 15. N10/N11 add only +5/+0 to prior totals. N08 retains an earlier review and awards no second first-review bonus. Schema success does not establish any of these claims.

The evidence's subject, captures, established proof labels and hashes are untrusted supplied claims. Normalized collection filters are not a claim about a real GitHub endpoint, GITHUB_TOKEN availability, or historical capture recoverability. Required collection closure, original identity reconciliation, chronological ordering, eligibility, exclusions, historical labels/publication, deduplication and retained unpaid facts are not checked here. In particular, independently valid schema/hash inputs may still fail unrelated phase-1 semantic checks; isolation of the intended future semantic failure must be proven after implementation, not inferred from these artifacts.

Keep sourceEligibility, coverageConsistency, rewardOrder and rewardAllocation not_run/not_checked; sourceAuthenticity is always not_checked and progressionAuthorized is always false. Null previousLedgerHash means only “no comparison snapshot supplied,” not genuine first use, absent history, a reset, faction reselection or recovery permission.

## Field and input boundaries

- Required omission, forbidden null, empty text, absent file sides and unavailable proof are distinct.
- Current release publishedAt may be null; an established firstPublication.value.publishedAt may not.
- Numeric source IDs are canonical decimal strings, not JSON numbers, PR numbers or GraphQL node-ID substitutions. OIDs have 40/64 lowercase hexadecimal syntax; provider support/authenticity is not established by that syntax.
- PENDING reviews and open/closed PRs have their approved null branches. Bot/private/draft/prerelease/DISMISSED observations are representable, not schema-invalid by themselves.
- Successful empty pages still require closure proof later. Failure/not_collected/unknown termination cannot be converted to empty successful activity.
- Use a fixed local schema registry with the existing schemas/v1/common.schema.json dependency. No remote schema/policy/blob/URL retrieval.
- Evidence bytes <=33,554,432 and container depth <=16 are raw-input rules, not JSON Schema guarantees. Byte/depth boundary payloads are built in memory, not saved as 32 MiB fixture files.
- Malformed JSON, decoded duplicate keys, NaN/overflow, comments and lone surrogates are intentional non-JSON raw fixtures. invalid-utf8/bytes.json is a hex descriptor; test its decoded bytes rather than validating the descriptor as evidence.

## Verification executed — 2026-10-15

Node v24.8.0; existing Ajv 8.20.0, ajv-formats 3.0.1, canonicalize 5.1.0 and jsonc-parser 3.3.1. No installs or dependency/package changes.

- Four new schemas self-validated and compiled offline.
- 59 parsed evidence cases, seven raw failures, 879 structural probes, six byte/depth boundaries and 945 reverse-order case/probe replays matched their declared structural expectations.
- 39 original record-schema checks accepted the 13 synthetic contexts; this is not phase-1 bundle/transition verification.
- 41 construction digests (13 ledgers, two test policies, 26 identities) matched. Independent Python jsonschema 4.26.0/referencing 0.37.0/rfc8785 0.1.4 repeated 977 schema assertions and all 41 digests, with zero disagreements.
- Unknown external schema resolution failed locally; no network schema loader was configured.
- All 77 schema/fixture input files present for the first verification remained byte-identical during the run. A final replay also checks added documentation/result files.
- The 115 pre-existing protected files, including all 93 original schema/record JSON inputs and phase-1 package files, remained byte-identical. PRD sections 6–12 mechanics retained their original digest.

One initial probe oracle incorrectly allowed null in established first-publication time; it was corrected to reject, retaining the separate nullable current-release timestamp. Final checks have zero failures.

No source/reward verifier, collector, growth engine or real growth-record writer was implemented/integrated. No GitHub changes, permission changes, Actions, commits or pushes occurred. Existing 295 phase-1 tests are historical evidence, not a new evidence-verifier pass.

## Reproduce the schema-only check

Run from the project root using already installed local dependencies. This one-shot read-only command is not integrated into the product CLI or package scripts. It reuses the existing strict parser's ledger role solely for the identical 32 MiB/depth-16 boundary; there is no new evidence input adapter.

```sh
node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Ajv from './packages/record-validator/node_modules/ajv/dist/2020.js';
import formats from './packages/record-validator/node_modules/ajv-formats/dist/index.js';
import canonicalize from './packages/record-validator/node_modules/canonicalize/lib/canonicalize.js';
import {parseStrictJson} from './packages/record-validator/src/infrastructure/strict-json.js';
const dir='test/fixtures/evidence/v1';
const a=new Ajv({strict:true,strictTypes:false,strictRequired:false,allErrors:false,coerceTypes:false,useDefaults:false,removeAdditional:false});formats(a,{mode:'full'});
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
for(const n of ['common','state','ledger','status'])a.addSchema(read('schemas/v1/'+n+'.schema.json'));
let self=0;for(const n of ['common','resources','collections','evidence']){const s=read('schemas/evidence/v1/'+n+'.schema.json');if(!a.validateSchema(s))throw Error('INVALID_META_SCHEMA');a.addSchema(s);self++;}
const validate=a.getSchema('urn:commitkin:schemas:evidence:v1:evidence');
const entries=read(dir+'/cases.json').cases;
const probes=read(dir+'/schema-probes.json').cases;
const inputs=[];function inventory(p){for(const d of fs.readdirSync(p,{withFileTypes:true})){const f=path.join(p,d.name);if(d.isDirectory())inventory(f);else inputs.push(f)}}inventory(dir);inventory('schemas/evidence/v1');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const before=new Map(inputs.map(p=>[p,hash(p)]));
const failures=[];let envelopes=0,raw=0,fragments=0,replay=0;
const diag=(id,v)=>failures.push({caseId:id,keyword:v.errors?.[0]?.keyword,instancePath:v.errors?.[0]?.instancePath});
function check(c){
 let bytes=fs.readFileSync(path.join(dir,c.evidenceFixture));
 if(c.rawExpected){if(c.evidenceFixture.endsWith('/bytes.json'))bytes=Buffer.from(JSON.parse(bytes).bytes,'hex');let code='RAW_ACCEPT';try{parseStrictJson(bytes,'ledger')}catch(e){code=e.code}if(code!==c.rawExpected)failures.push({caseId:c.caseId,actualCode:code});return;}
 const value=parseStrictJson(bytes,'ledger'),beforeJson=JSON.stringify(value);
 const actual=validate(value)?'SCHEMA_ACCEPT':'SCHEMA_REJECT';
 if(actual!==c.localSchemaExpected)diag(c.caseId,validate);
 if(JSON.stringify(value)!==beforeJson)failures.push({caseId:c.caseId,code:'MUTATED_INPUT'});
}
for(const c of entries){check(c);c.rawExpected?raw++:envelopes++;}
for(const p of probes){const v=a.compile({$ref:p.schemaRef});const input=JSON.stringify(p.input),actual=v(p.input)?'SCHEMA_ACCEPT':'SCHEMA_REJECT';if(actual!==p.expected)diag(p.caseId,v);if(JSON.stringify(p.input)!==input)failures.push({caseId:p.caseId,code:'MUTATED_INPUT'});fragments++;}
for(const c of [...entries].reverse()){check(c);replay++;}
for(const p of [...probes].reverse()){const v=a.getSchema(p.schemaRef)??a.compile({$ref:p.schemaRef});if((v(p.input)?'SCHEMA_ACCEPT':'SCHEMA_REJECT')!==p.expected)diag('replay/'+p.caseId,v);replay++;}
let contexts=0,digests=0;const ctx=read(dir+'/record-contexts.json').contexts;
const digest=v=>'v1:sha256:'+crypto.createHash('sha256').update(canonicalize(v)).digest('hex');
for(const [id,b]of Object.entries(ctx)){for(const [role,v]of Object.entries(b)){const f=a.getSchema('urn:commitkin:schemas:v1:'+role);if(!f(v))diag(id+'/'+role,f);contexts++;}if(digest(b.ledger)!==b.state.integrity.ledgerHash)failures.push({caseId:id,code:'FIXTURE_DIGEST_MISMATCH'});digests++;}
const fc=read(dir+'/fixture-context.json');for(const p of Object.values(fc.policies)){if(digest(p.body)!==p.hash)failures.push({code:'FIXTURE_POLICY_DIGEST_MISMATCH'});digests++;}
for(const v of fc.identityVectors){if(digest(v.input)!==v.expectedHash)failures.push({caseId:v.name,code:'FIXTURE_IDENTITY_MISMATCH'});digests++;}
let boundaries=0;for(const c of read(dir+'/boundary-cases.json').cases){let input;if(c.bytes){const base=Buffer.byteLength('{"padding":""}');input=Buffer.from('{"padding":"'+ 'x'.repeat(c.bytes-base)+'"}');if(input.length!==c.bytes)throw Error('WRONG_BOUNDARY_SIZE');}else input=Buffer.from('['.repeat(c.depth)+'0'+']'.repeat(c.depth));let code='RAW_ACCEPT';try{parseStrictJson(input,'ledger')}catch(e){code=e.code}if(code!==c.expected)failures.push({caseId:c.caseId,actualCode:code});boundaries++;}
let externalRefRejected=false;try{a.compile({$ref:'https://example.invalid/never-fetch/schema.json'})}catch{externalRefRejected=true}if(!externalRefRejected)failures.push({code:'EXTERNAL_REFERENCE_ACCEPTED'});
let unchanged=0;for(const [p,h]of before){if(hash(p)!==h)failures.push({code:'INPUT_FILE_CHANGED'});else unchanged++;}
const result={schemaSelfValidation:self,envelopeCases:envelopes,rawCases:raw,structuralProbes:fragments,reverseReplays:replay,recordSchemaChecks:contexts,fixtureDigests:digests,boundaryProbes:boundaries,externalRefRejected,inputFilesUnchanged:unchanged,failures,sourceEligibility:'not_run',coverageConsistency:'not_run',rewardOrder:'not_run',rewardAllocation:'not_run',sourceAuthenticity:'not_checked',progressionAuthorized:false};console.log(JSON.stringify(result));if(failures.length)process.exitCode=1;
NODE
```

The independent Python cross-check used the already present temporary local environment; it is not a new product dependency or permanent runtime requirement. Full phase-1 regression/coverage, future semantic E-01–E-30 execution, acquisition/authenticity, release and production-size acceptance remain separate gates.
