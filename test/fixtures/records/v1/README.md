# Commitkin v1 record validation fixtures

Created, refined and locally checked: 2026-10-15. These are synthetic offline contract assets, not live growth records or a product validator/collector/growth engine.

Later implementation evidence (2026-10-15): an explicitly authorized [phase-1 read-only validator and CLI](../../../../packages/record-validator/README.md) now runs repeatable Node.js tests against these unchanged JSON inputs. The schema-only/temporary-oracle verification below is preserved as historical evidence, not the current implementation inventory. The new 295-test run keeps 53 original record-level outcomes exact and explicitly separates the three source-context contract examples; it does not claim an allocator, full eligibility engine or authenticated history. Its reports always leave progression unauthorized. No actual growth-record update, GitHub change or Actions execution occurred.

The user approved the four UTC/counter/allocation/hash-evidence refinements, schema/sample/case supplementation and local revalidation only. The record format remains the pre-release v1 contract; no released-format migration or real user-record rewrite is claimed.

## Files and schema loading

- [Common](../../../../schemas/v1/common.schema.json), [state](../../../../schemas/v1/state.schema.json), [ledger](../../../../schemas/v1/ledger.schema.json), [status](../../../../schemas/v1/status.schema.json): four Draft 2020-12 schemas.
- [cases.json](cases.json): 10 normal bundle scenarios and 46 isolated negative scenarios.
- [schema-probes.json](schema-probes.json): 127 structural/catalog/conditional probes.
- [policy-cases.json](policy-cases.json): 55 finite examples and the explicit synthetic hash/evidence construction context.
- [boundary-cases.json](boundary-cases.json): 22 generated parser/field-boundary cases.
- [transitions/cases.json](transitions/cases.json): seven explicit previous/candidate comparisons.
- [hash-vectors.json](hash-vectors.json): 14 fixed canonical-string/hash vectors.

There are 93 input JSON files across schemas and fixtures, including deliberately malformed negative files. A generic “parse every JSON file” command is not the acceptance test. Manifests, fragments and evidence descriptors are test metadata, not additional persisted record schemas.

Register the exact local IDs below and resolve references only from this registry:

~~~text
urn:commitkin:schemas:v1:common
urn:commitkin:schemas:v1:state
urn:commitkin:schemas:v1:ledger
urn:commitkin:schemas:v1:status
~~~

Enable actual date/date-time assertions. No coercion, default insertion, unknown-field stripping or remote reference retrieval. JSON Schema alone does not detect duplicate raw object keys, verify a bundle or execute transition/scoring rules.

## Case loading and negative isolation

For each cases.json entry, load role files from baseFixture and overlay only overrides, relative to this directory. Decode rawInput descriptors into bytes in memory before raw parsing. Compare the exact expected stage/code/decision and preserve input bytes. All owner/source IDs and timestamps are fictional fixture context, not authenticated GitHub evidence.

The negative-stage counts are: schema 23, cross-file 4, integrity 1, semantic 7, compatibility 3, JSON parse 4, raw UTF-8 1, finite contract-example 3. The contract-example label is a local supplied-oracle assertion, not a new production pipeline stage or public status reason code.

Malformed syntax, duplicate keys, comments and non-finite numbers are intentional inputs. invalid/invalid-utf8/bytes.json is a valid JSON hex descriptor; decode hex to obtain invalid UTF-8. Oversized byte-limit payloads are generated in memory, not persisted.

Ledger-mutating semantic/contract negatives include a repaired companion state digest. Their intended failure is not masked by an unrelated hash error. Only the explicit digest-mismatch case deliberately uses a wrong well-formed ledger digest. Manifest diagnostic codes do not expand status.json's public reason-code catalog.

## Normal bundles

| Scenario | Expected meaning |
|---|---|
| ready-empty | Completed coverage; finalized 0 XP and Adventurer |
| ready-40xp | One documentation PR; finalized 40 XP |
| first-analysis-pending | Saved faction; null XP/class/evaluation; no fabricated empty result |
| partial-retain-success | State/ledger identical to ready-40xp; failed collection preserves successful freshness |
| metadata-only-revision | Stored revision 2/successful revision 1; verified repository metadata only |
| status-only-rebuild | Missing status explicitly declared; compatible valid state/ledger allow status-only recovery |
| ready-100xp-capped | 160 face-value XP -> 100 paid; release partially paid 15; unpaid eligible facts retained |
| ready-95xp-before-late-release | Three merged PRs and a first review; 95 paid |
| ready-100xp-after-late-release | Late original-date release raises the prior total by only 5; payment allocation reorders |
| ready-100xp-reallocated | Earlier release redistributes paid categories/keys while total remains 100; zero new XP |

No status recovery file is actually written. Pending analysis is not an allowed reset of an existing ready character.

## Four confirmed refinements and example coverage

1. Freeze UTC D across an evaluation, including midnight crossing. Use [D-90,D)/[D-30,D); calendar-date gap >=3 resets pending at the next normal evaluation; class cooldown >=14. Rekindled rest excludes activity/return dates and requires complete observation.
2. Class count 1-7, trait count 1-3. Null means no pending candidate; count zero is invalid. Saturate counts, retain start, reconfirm counted dates; apply/clear a third trait observation. A same-date reset does not earn another observation. Empty used slots do not imply first assignment.
3. After qualification/deduplication/item limits, pay conditional validDay/authoredContributionDay/triage bonuses first. Merge selected PR/review/release rewards by original time and declared source ID; kind and numeric repository ID resolve remaining ties. Partially pay the final reward, retain unpaid eligible facts, and settle only original-date total increases. Contradictory reduced settlements require review.
4. Separate full-ledger, normalized-settings, effective-analysis and stable-ID scope/identity hashes. Source/previous-snapshot proof is separate execution context. Missing required proof is not_checked, not a progression pass. No real raw source/participant/credential data is added to public records.

policy-cases.json has 8 calendar, 16 observation, 4 allocation, 10 ordering, 6 scope, 5 identity and 6 evidence-boundary examples. Its partial excerpts are not complete record files. Positive assertions concern explicitly supplied fictional context; they do not establish real eligibility or authenticate a prior observation history.

The construction payloads define the current fixed analysis configuration as rulesetVersion plus publicOnly: true; scope adds the sorted unique effective repository IDs. Identity payloads have exactly kind/accountId/repositoryId/sourceId. This supersedes the initial illustrative fixture convention that reused the settings hash as the analysis hash. Names/order-only settings changes or verified renames need not alter material scope.

## Historical contract-asset verification record (before phase-1 implementation)

Result: PASS, 2026-10-15, after four-rule supplementation.

| Check | Result |
|---|---|
| Draft 2020-12 schema self-validation | 4/4 |
| Normal / isolated negative bundle cases | 10/10 and 46/46 |
| Same bundle cases in reverse order | 56/56; identical outcomes |
| Structural/catalog/branch probes | 127/127 (94 accepted, 33 rejected) |
| Parser/field boundary probes | 22/22 |
| Original explicit previous/candidate comparisons | 7/7 |
| Finite four-rule examples | 55/55 |
| Fixed canonical-string/hash vectors | 14/14 |
| Canonical invariance / actual-change checks | 2/2 |
| Independent normal/repaired-negative ledger digests | 18/18 |
| Independent construction-input digests | 26/26 |
| Input JSON bytes before/after validation | 93/93 unchanged |

The original v1.21 run checked six normal/40 negative bundles, 121 structural probes and eight fixed vectors over 71 JSON inputs. The current figures supersede that baseline; the earlier evidence is not a claim that the newer examples existed then.

Used the existing temporary isolated Python 3.12.14 environment with jsonschema[format] 4.26.0, referencing 0.37.0 and rfc8785 0.1.4. Draft202012Validator.check_schema, a bundled Registry and FormatChecker checked structure. Sockets were disabled during checks; unknown remote refs were rejected. Dependencies were downloaded during initial preparation, not this revalidation. No project/global dependency or persistent executable framework files were added.

The temporary read-only checks compare supplied normal/error bundles and finite expected excerpts, including reference arithmetic/sorting. They do not export or execute a product validator/allocator/state-transition API. Expected vectors are fixed in files, not regenerated as the supposed answer by the implementation under test. Node.js v24.8.0 built-in crypto independently checked the 18 ledger and 26 construction digests within the ASCII-key/finite-safe-integer fixture domain, and hashes of all fixed canonical vector bytes. Python JCS additionally checked canonical output, including the Unicode vectors. This is not exhaustive RFC 8785 conformance.

Byte probes generate JSON/whitespace just below/at/above each limit. Depth 15/16/17 counts an object/array root as 1, scalar leaves as 0. Parser acceptance is not whole-record acceptance. Day-total 99/100/101 probes field bounds, not business attainability. No lifetime sizing conclusion follows from these provisional ceilings.

## Historical remaining-work list (see later phase-1 evidence above)

- An actual product parser/validator/serializer, collector, allocator, classification/transition engine or recovery/migration tool exists.
- Real actor/source qualification, original-ID extraction, full scoring/minima/priority recomputation, review history, coverage correctness, all retention/correction/transition paths or historical authenticity.
- Live GitHub identity/token coverage, collection completeness, grouped/concurrent writes, rendering/cache, runtime privacy/log sanitization or recovery publication.
- Complete PRD approval or public-release acceptance.

No GitHub changes, additional Actions runs, permission changes, real growth records, commits or pushes were made. Product implementation still requires a separate request.

Canonical contract: [English PRD](../../../../docs/product/github-character/prd.en.md). Historical *_HASH snippets remain explanatory; use the computed fixtures and confirmed construction context here.
