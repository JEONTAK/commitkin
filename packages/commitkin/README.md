# Commitkin — local development build

Your GitHub activity, a growing pixel companion.

This is the **private local core**, not an installable GitHub Action or a public-release build. It implements the approved mechanics without granting unverified activity or publishing a real character. Node.js >=22 is required; verification used Node.js 24.8.0.

## Try a fictional character

From the workspace root:

```sh
npm --prefix packages/commitkin ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/record-validator ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/commitkin test
npm --prefix packages/commitkin run test:coverage
node packages/commitkin/bin/commitkin.mjs demo --faction bloomguard --name my-bloom-preview
node packages/commitkin/bin/commitkin.mjs demo --faction ashbound --name my-ash-preview
```

Choose a new preview name each time. Existing output is never overwritten. Files are confined to `deliverables/commitkin-local-preview/NAME/`, explicitly marked synthetic, with fictional owner IDs, zero GitHub requests and no publication authority. Each contains a static card, Blacksmith's eleven-stage comparison, a schema-valid state/ledger/status proposal and an accessible managed README. They are **not** your actual GitHub activity or live owner records. Demo activities are internal qualified test signals, not source-verification proof.

The original code-native fallback drawings provide 530 distinct generated appearances: 24 regular classes × two factions × eleven stages, plus two fixed Adventurers. They do not replace approval/rights checks for the existing AI concept sheets or certify final production art. No external font or AI concept image is loaded by the renderer.

## Read-only evidence inspection

```sh
node packages/commitkin/bin/commitkin.mjs preflight \
  --context test/fixtures/evidence/preflight-v1/normal/ES-N01/context.json \
  --evidence test/fixtures/evidence/preflight-v1/normal/ES-N01/evidence.json \
  --records test/fixtures/records/v1/valid/ready-empty
```

`verify` uses the same arguments, optionally `--previous DIR`, and additionally reconstructs supported source/reward rules. Its built-in development registry intentionally **rejects fixture policy IDs**. There is no CLI policy override, trust flag, token, live, reset, automatic repair or migration option. The internal test composition supplies known synthetic policies only in tests.

Inputs are strict, bounded UTF-8 JSON. Context/evidence files must be regular, no-follow final-component files. Parent directories are not an adversarial filesystem sandbox; use stable local copies. Records are opened through the unchanged read-only validator. Diagnostics do not echo input values, keys, paths, API payloads or stacks.

| Result | Meaning |
|---|---|
| `preflight_passed` | Implemented context, schema, record, binding, required-query, reference and capture-closure checks passed |
| `accept_relative_to_evidence` | Supported supplied-source eligibility and reconstructed reward claims match; not authenticated GitHub truth |
| `hold` | Missing, incomplete, incompatible or unsupported proof; preserve the prior valid character |
| `rejected` | A supplied claim contradicts an implemented constraint; never replace legitimate history |
| `progressionAuthorized: false` | Always false for offline tools and local proposals, including exit 0 |

An old fixture named `normal` is not automatically a valid semantic source. In particular, historical repeated `1111…`/`2222…` file OIDs do not hash their full text and are rejected by the new blob-consistency check. Original fixtures/results remain unchanged. Separate in-memory cases use genuine Git blob hashes and independently validate the supported paths.

## Implemented core

- Full approved class roster, weighted 90-day scoring, ownership/distribution filters, first-assignment provenance boundary, seven observations, cooldown, gap and scope handling.
- Twelve 30-day traits, priority rules and three-observation changes/removals; twelve achievement series, all 36 tiers and automatic badge selection.
- Original UTC date settlement, item limits, deterministic original-ID ordering, partial cap payment, eligible unpaid evidence retention, late `95→100` / `100→100` reconciliation and affected-date prior-proof holds.
- Lossless decimal-string XP/levels above 50, five-level visual stages and fixed Adventurer.
- Additive context/catalog schemas, original-preserving fixtures and pure preflight use case.
- Supported evidence qualification: complete full-text/blob-consistent documentation/test/deployment PRs, other-person review history, qualified triage and conclusive exclusions. Unknown attribution/content/history does not become inactivity.
- Candidate proposal through the unchanged record/transition safety validator; older saved facts/XP remain beyond the 90-day collection bound, and unresolved older periods remain explicit gaps.
- English static PNG, exact approved English identities, accessible alt text, highest-tier collection, successful freshness and public-scope disclosure. Only one user-added managed region can be replaced; unrelated README bytes remain unchanged.
- Strict settings subset, hybrid known-scope discovery and bounded read-only GitHub transport; an explicit separately constructed five-file grouped publisher, tested with injected mock HTTP only.
- Bounded public-source collection port. Its capture is ephemeral acquisition material, not a normalized/trusted evidence envelope, complete account history or permission to publish.

## Deliberate release blockers

1. **Temporal evidence:** v1 cannot establish historical bug/no-bug state, direct default-branch reflection or original release lifecycle merely from `established` labels/current fields. Those activities hold. Full before/after acquisition and an explicit timestamped proof contract are not completed. Do not weaken the confirmed rules to make a test green.
2. **Trusted installation:** actual personal-account/profile binding, genuine first-install/initial-assignment provenance, same-owner matched snapshot recovery and collection-to-evidence adaptation require an integrated trusted path and real installation checks.
3. **Live operation:** basic `GITHUB_TOKEN` permissions, provider hard ceilings, source coverage, atomic grouped publication behavior, conflicts and actual scheduled/manual execution need separately authorized live verification. No workflow or Action runner is enabled by this package.
4. **Art/distribution:** final sprite review, AI asset rights, component notices, installed packaging and release acceptance remain separate. This package references sibling `record-validator` and root schemas; copying/publishing this directory alone will not work.

Consequently, “core tests pass” does not mean the requested full product or public release is complete.

## Safety, retention and recovery

- A known required failure holds the whole run. Do not partially pay successful repositories, add observations or advance successful freshness.
- Missing/corrupt records require recovery, not zero initialization or a new faction. A normal refresh has no reset/faction-switch operation.
- Restore matching same-owner state/ledger/status from one valid Git commit/backup set; never independently select revisions or roll back unrelated profile files. Actual recovery writer/ownership acquisition is not shipped here.
- On uninstall, disable scheduled execution/remove the managed README block but retain `.commitkin` records. This package performs no automatic deletion or expiry. Deletion/redaction and Git-history removal require a separate explicit user action.
- Public records contain stable repository IDs, dates, aggregates and hashes; hashes are not encryption or anonymity. Never commit source captures, tokens, file contents, titles/bodies or participant lists.
- Future publication may change only the approved state/ledger/status/card/README paths, in one commit preserving the base tree. The adapter uses a fixed GraphQL `updateRefs` mutation with `beforeOid=expectedHead` and `force:false`, then reads the ref back. This expected-head compare-and-swap is mock-tested, not live publication proof. Actual Actions concurrency and live race/recovery checks are still needed. Ambiguous mutations are never blindly retried or downgraded to a weaker REST update.

## Layers and integration

`src/index.mjs` is the composition root. Domain code has no filesystem/network/process dependencies. Application use cases receive parser/schema/record-validator or read-only collection ports. Infrastructure owns bounded files, schemas, settings text and GitHub transport. Presentation owns pixel rendering/managed text, never source qualification or actual publication.

Internal qualified activities carry ephemeral original IDs for ordering; only approved hashed facts/aggregates enter proposed public records. A prior untouched date needs no raw-ID cache; recomputing an affected settled date requires original ordering evidence. Pre-growth review history suppresses duplicate rewards without creating old growth rows or a durable raw activity archive.

The snapshot evaluator is an internal **proposal builder** whose caller must establish qualification and known-scope collection first. Its self-consistency check is not that proof. It is not exposed as an arbitrary JSON-to-live-record CLI.

Dependency versions are pinned, installed with scripts disabled. First-party code uses MIT; dependency licenses/notices retain their original terms (including canonicalize's Apache-2.0). No claim of a completed redistribution/security audit is made. See [implementation status](../../docs/product/github-character/local-mvp-implementation.md).
