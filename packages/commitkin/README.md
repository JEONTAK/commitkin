# Commitkin runtime

Your GitHub activity. Your evolving pixel character.

Node.js >=22, native ESM, no hosted backend or separate signup. This package and sibling `record-validator`, root schemas and fixtures form one source distribution; this directory is not a standalone npm release.

## Development

From the source repository root:

```sh
npm --prefix packages/record-validator ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/commitkin ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/record-validator test
npm --prefix packages/commitkin run test:coverage
node packages/commitkin/bin/commitkin.mjs demo --faction bloomguard --name first-bloom-preview
node packages/commitkin/bin/commitkin.mjs demo --faction ashbound --name first-ash-preview
```

Use a fresh demo name: existing output is never overwritten. Demos write only fictional records/cards under `deliverables/commitkin-local-preview/NAME/`, use synthetic owner IDs, make zero GitHub requests and cannot authorize real progression. Dependency/generated directories must remain uncommitted.

## Installation and publication

See the root [installation guide](../../README.md#installation). The composite [Action](../../action.yml) runs only for `workflow_dispatch` or `schedule` in a public personal profile repository `LOGIN/LOGIN`, from the current default branch, with owner/repository IDs bound to trusted Actions context. The product repository itself is not a valid profile target.

- Default `dry-run: 'true'`: prepare five files in memory, emit a bounded summary, never construct a publisher or save a faction.
- Explicit `dry-run: 'false'`: requires `contents: write`; publish only `.commitkin/state.json`, `ledger.json`, `status.json`, `card.png` and the managed region in `README.md` after safety gates.
- First manual install requires `faction: bloomguard|ashbound` and `confirmation: CONFIRM_PERMANENT_FACTION`. The first published confirmation is permanent. Later runs leave both inputs empty.
- Incomplete first analysis can reserve only the confirmed faction: XP, class and evaluation remain null, and the card says Analysis pending. This is not a successful zero-XP analysis.
- Existing failures preserve the last valid character. Deleted/corrupt/incomplete files require recovery, not reinitialization. Pending initial assignment requires verified reachable same-owner pending-state history.

Publication constructs five blobs, one base-tree-preserving tree and one commit, then applies fixed GraphQL `updateRefs` with `beforeOid=expectedHead` and `force:false`. Authoritative ref readback is required. Concurrent changes hold; ambiguous mutations are reconciled by reads, never blindly retried or downgraded to weaker ref updates. Other profile files and README bytes outside the single managed block remain unchanged.

Write/recovery paths are tested with injected HTTP, not by changing the maintainer's real growth records. Current validation workflows use `contents: read` only. No live profile installation, scheduled growth write, release tag or complete provider-coverage claim is implied.

## Source model

The installed Action uses confirmed `observed-api-v1`:

- Direct commit: currently reachable from a fixed default-branch head, attributed to the subject, using Git **committed date**, not first push/branch reflection or author date.
- Release: `published_at` plus currently public, non-draft, non-prerelease state when first accepted.
- Bug recovery: current exact case-insensitive `bug` label on an eligible merged PR or its current linked public closing issue when first accepted, not merge-time labels. A closing reference is not proof the issue was closed or fixed.

Accepted facts retain their original date/family and XP. Collection covers the previous 90 completed UTC days; traits use 30 days. Original UTC-day caps/item limits, deterministic identity ordering, unpaid eligible facts, duplicate suppression, faction permanence and legitimate older growth remain intact. An affected settled date requires original ordering proof; inaccessible old evidence cannot be replaced with guessed ordering.

Hybrid discovery combines public owned repositories, observed public events and manually added repositories, retaining tracked stable IDs. It is not every repository a user has ever helped operate. Known required failures hold the whole analysis; undiscovered repositories are not fabricated into scope or account-wide inactivity. Configure extra repositories/exclusions in `.github/commitkin.yml`.

Changed-file inventories are complete and independently checked against fixed Git trees. Recognized source/documentation/test/deployment files require exact UTF-8 before/after bytes and matching Git blob hashes. Generated/lock/record paths and fully enumerated unmatched files are non-contributing; they do not create guessed families. Missing required recognized contents hold. Managed-README-only changes do not earn activity.

## Mechanics and presentation

25 classes: Adventurer plus six families of four regular classes. Twelve traits, twelve achievement series with Bronze/Silver/Gold tiers, uncapped numeric levels, 100 daily XP maximum and appearance milestones every five levels through 50. Classification keeps its original thresholds, seven eligible observations and change cooldown; traits use three observations. Missing days are not simulated observations.

English 880 × 416 static PNG and accessible README share one verified snapshot. The original code-native renderer provides 530 appearances: 24 regular classes × two factions × eleven stages (Lv.1–4 base, then 5…50), plus two fixed Adventurers. These are programmatic fallback pixels and bitmap lettering, not cleared AI concept sheets, external fonts or 530 hand-painted assets.

## Offline evidence inspection

```sh
node packages/commitkin/bin/commitkin.mjs preflight \
  --context test/fixtures/evidence/preflight-v1/normal/ES-N01/context.json \
  --evidence test/fixtures/evidence/preflight-v1/normal/ES-N01/evidence.json \
  --records test/fixtures/records/v1/valid/ready-empty
```

`verify` uses the same inputs, optionally `--previous DIR`. Older strict historical verifier/schema/fixtures remain separate and unchanged; a fixture named normal does not prove semantic eligibility. Fake file OIDs are rejected, not rewritten. Development policy registries reject fixture IDs in the CLI. No policy override, token, reset, migration or arbitrary JSON-to-live-record command exists.

`preflight_passed` and `accept_relative_to_evidence` mean only implemented supplied-input relationships passed. Offline tools always return `progressionAuthorized: false`, even on exit 0. `hold` preserves history for unavailable proof; `rejected` means a contradicted constraint. Local files are bounded strict UTF-8, final-component no-follow regular files; parent directories are not an adversarial filesystem sandbox. Diagnostics omit input values, payloads, paths and stacks.

## Architecture, retention and licensing

`src/index.mjs` composes domain/application ports, bounded infrastructure and pure presentation. Domain has no filesystem/network/process dependencies. Imports perform no network writes. Analysis permits GET plus one fixed read-only GraphQL closing-issues query; only the explicit publisher has write capability.

No raw source captures, titles, bodies, file contents, emails, tokens or participant lists enter public records. Original IDs are transient ordering inputs; approved hashes, stable repository IDs, dates and aggregates are public, not anonymous or encrypted. Same-date no-ops retain prior successful timestamps rather than falsely binding old snapshots to new captures.

On uninstall, disable the workflow and optionally remove the managed README block; retain growth files. Restore matching state/ledger/status from one valid same-owner commit/backup set. Never mix revisions, delete records to change faction, automatically reset or roll back unrelated files. See [recovery](../../README.md#recovery).

First-party code is MIT; dependencies retain their licenses/notices, including canonicalize's Apache-2.0. No external font or AI image is loaded. AI-image rights remain mandatory before future redistribution. See [credits](../../README.md#credits) and [validation status](../../docs/product/github-character/local-mvp-implementation.md).
