# Commitkin record validator — phase 1

Local, read-only inspection of the approved pre-release v1 records. Implemented with explicit user approval on 2026-10-15. This is a developer validation package inside the planning workspace, not the full product, an installed GitHub Action, a hosted service or a standalone published npm package. Node.js ESM and native `node:test` avoid adding a server, database or compilation toolchain.

## Run locally

From this directory, use Node.js >=22. Dependencies are pinned in `package-lock.json`; installation requires registry access, inspection/tests do not.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run test:coverage
```

From the workspace root, inspect a **synthetic** fixture:

```sh
node packages/record-validator/bin/commitkin-validate.js \
  --records test/fixtures/records/v1/valid/ready-40xp \
  --owner-account-id 1001 --profile-repository-id 9001 \
  --now 2026-10-15T02:00:00Z
```

To compare two explicitly supplied snapshots, add `--previous DIR` and `--operation normal|failed-collection|metadata-only|status-only`. Missing/duplicate/unknown options fail closed. No owner is inferred from a login, token, directory name or record itself. Supplied IDs are comparison expectations, **not authenticated GitHub ownership proof**.

`--now` is the inspection-time UTC timestamp. Normal transitions freeze evaluation date D from optional `--evaluation-started-at UTC_TIMESTAMP` (requires `--previous`); otherwise D uses `--now`. Supply the start timestamp when completion crosses midnight. Candidate completion cannot precede the explicit start or exceed inspection time. Activity dates remain completed UTC dates, strictly before D.

The CLI only opens `state.json`, `ledger.json` and optional `status.json` for reading. It has no token, network, output-file, write, repair, initialize, migrate or force option. It rejects symlink record files/final record directories, non-regular files and observed size/time changes during a file read. It is not a sandbox against an attacker replacing ancestor directories or a concurrent writer; bundle revisions/digests additionally detect mismatches, not authenticate history or guarantee atomic acquisition. Use stable copied snapshots for comparisons.

## Result contract

JSON goes only to stdout; fixed diagnostics never include input values, keys, local paths, source dumps or stack traces. `reportVersion: 1` is a diagnostic report version, not another persisted record schema. It does not extend the public `status.json` reason enum.

| Field / exit | Meaning |
|---|---|
| `recordValid: true` | The supplied candidate passed implemented compatibility/schema/internal bundle checks; not source correctness |
| `transitionGuards: passed` | Implemented guards passed against a separately valid supplied previous snapshot, not proof of original history or full transition eligibility |
| `transitionGuards: not_checked` | No previous usable comparison was performed |
| `progressionAuthorized: false` | Always false in phase 1, even with `code: ACCEPT` / exit 0 |
| `notChecked` | Source/ownership/completeness/identity/ordering, full growth/eligibility, history authenticity, settings proof, initial provenance and correction authorization remain unverified |
| `statusRepairAllowed: true` | Only a read-only repair hint after the compatible primary pair passes; no replacement status is generated |
| Exit 0 | `ACCEPT`: internal record/guard inspection only; never use it as a publication gate |
| Exit 1 | Hold/preserve/pending/status-only-recovery or input-record/I/O rejection; no successful refresh |
| Exit 2 | Invalid invocation/context or validator unavailable |

Missing status produces `STATUS_REBUILD_ALLOWED`. Malformed/schema-invalid status preserves its original error and may offer the repair hint after checking the primary pair. Newer/unsupported status is never treated as disposable corruption. Well-formed owner/revision mismatches remain held; no silent repair. Missing/corrupt state or ledger never initializes a zero-XP character or offers a faction choice.

## Implemented boundary

1. Bounded bytes (state 1 MiB, ledger 32 MiB, status 64 KiB), fatal UTF-8 decoding, strict JSON (no BOM/comments/trailing commas/duplicate decoded keys/non-finite values/unpaired Unicode), depth <=16. Container root counts as 1. No truncation or coercion.
2. Compatibility before v1 role validation: schema v1 / rules `1.0.0` only. Newer schema -> `UPDATE_REQUIRED`; other schemas/rules preserve with guidance. No invented migration mappings.
3. Bundled Draft 2020-12 schemas, full calendar formats, closed records, no coercion/defaults/removal, no caller-supplied schemas or remote reference resolver. AJV's extra `strictTypes`/`strictRequired` schema lint is disabled for existing conditional/ref inheritance; record type/required validation remains enabled.
4. Owner/revision/status references; full-ledger JCS/SHA-256; unique identities and referenced repositories/scopes; canonical numeric-ID scope construction and current fixed public-only analysis hash; date/range/clock/history/pending consistency; day sums/caps/common-bonus/evidence/paid-key bounds, lifetime paid identities/known earlier reviews; BigInt cumulative XP against current net days; correction chain consistency without double-counting corrections. Stored incomplete status does not revoke prior completed coverage; newly tracked metadata need not appear in the prior successful scope.
5. Prior/candidate guardrails: immutable faction/start/ever-used settings, revision monotonicity, failure and metadata-only growth freeze, status-only primary no-op, append-only stable repository/ownership/scope/fact history, preserved earned tiers/settlements/coverage, no ordinary reduction/correction, fixed normal date, same-date observation deduplication, gap >=3 resets, class count <=7 saturation, cooldown >=14 dates, trait three-observation replacement/removal, class-only material-scope reset and no fabricated first-normal history. Eligibility/candidate computation is not implemented. Changed corrections are held for separate authorized tooling, not automatically allowed.

These checks assert necessary internal constraints on supplied claims. They cannot detect missing source facts with no previous/source context or prove every family/achievement/first-assignment qualification. Lifetime ceilings are provisional, not a sizing benchmark.

## Layers and reuse

- `src/domain`: pure internal consistency/transition guards and canonical hashing; no file/network/process access.
- `src/application`: read-only orchestration through parser/schema ports; returns sanitized reports.
- `src/infrastructure`: bounded file reads, strict raw parser and fixed local schema registry.
- `src/index.js` / `bin`: composition and CLI only. `createValidator()` returns `(candidateBytes, context, previousBytes?) => report`; each bundle supplies role-keyed `Uint8Array` values or null for missing files. No input objects/bytes are mutated.

Bundled schemas remain at the workspace's existing `schemas/v1/` paths. Distribution packaging/Actions permissions, snapshots, serializers and writers remain separate work. Do not publish this private package as-is and assume its workspace-relative assets will be bundled.

## Regression evidence and deliberate exclusions

The tests execute the product parser/schema/bundle validator and guards, not the earlier temporary Python oracle. They reuse existing fixtures read-only, compare reverse-order outcomes, fixed independent hash vectors and boundaries, and add explicit in-memory transition/rejection and CLI/security cases. Coverage gates require >=80% lines, branches and functions across first-party source and CLI. Coverage does not prove correctness or exhaustive mechanics.

Verified locally on 2026-10-15 with Node.js 24.8.0 / npm 11.6.0, including an offline lockfile reinstall: **295/295 tests passed**; latest coverage lines **100%**, branches **96.84%**, functions **97.30%**. This includes 127 schema probes, 22 boundaries and 14 fixed hash vectors. V8's reported branch totals can vary between runs; the >=80% gates passed on repeated runs. The 93 pre-existing schema/fixture JSON files and approved PRD mechanics remain byte-identical. Node >=22 is the declared runtime minimum; the actual run used Node 24, not a multi-runtime/platform certification.

The old manifest contains 53 record-level cases plus **3 source-context contract examples**. All 53 must retain their exact original stage/code/decision. For the other three:

| Legacy example | Phase-1 result | Limit |
|---|---|---|
| `wrong-cap-allocation` | `CREDITED_XP_INVALID` | Internally impossible XP/paid-key combination is rejected; original-source ordering still not checked |
| `unpaid-key-marked-credited` | Internal `ACCEPT`, progression unauthorized | Exact positive-payment membership needs the future deterministic allocator/source order |
| `capped-evidence-dropped` | Internal `ACCEPT`, progression unauthorized | With no source/previous context, absence of zero-paid facts cannot be inferred. Comparison with a valid prior snapshot detects `EVIDENCE_LOST` |

The 55 finite policy excerpts and seven old shallow comparison examples are historical oracle evidence, **not presented as a fully implemented allocation/classification engine**. New actual composed transition tests cover the approved safety boundary. No GitHub collection, growth engine, reward allocation, live record update, recovery writer, GitHub mutation, Actions execution, commit/push or production release was performed.

## Dependency sources / licensing

First-party package code: [MIT](LICENSE). Pinned dependencies retain their own license files/notices: [AJV](https://github.com/ajv-validator/ajv) / [ajv-formats](https://github.com/ajv-validator/ajv-formats) / [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) (MIT), [canonicalize](https://github.com/erdtman/canonicalize) (Apache-2.0). Transitive dependencies are pinned by the lockfile (MIT and BSD-3-Clause); first-party MIT does not replace those notices. No character art or fonts are bundled here; the separate approved image/font release checks remain open. License policy is not a completed redistribution audit.
