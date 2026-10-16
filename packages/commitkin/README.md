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

See the root [installation guide](../../README.md#installation). New installations run the composite [Action](../../action.yml) in a public personal fork of `JEONTAK/commitkin`. Durable owner/repository IDs, root fork-network identity and current default-branch head are verified. The maintainer's original product repository permits read-only preview, never personal-record publication or profile-sync storage: seeding it with records would make future forks inherit the wrong owner's history. Its immutable ID is blocked by every publication layout. The supplied workflows are manual-only; no schedule is added or enabled.

- Default `dry-run: 'true'`: prepare five files in memory, emit a bounded summary, never construct a publisher or save a faction.
- Explicit `dry-run: 'false'`: requires `contents: write`; publish only `.commitkin/state.json`, `ledger.json`, `status.json`, `character.png` and display-only `profile.json` **in the fork**, after safety gates. The fork README is not modified.
- First manual install requires `faction: bloomguard|ashbound` and `confirmation: CONFIRM_PERMANENT_FACTION`. The first published confirmation is permanent. Later runs leave both inputs empty.
- Incomplete first analysis can reserve only the confirmed faction: XP, class and evaluation remain null, and the card says Analysis pending. This is not a successful zero-XP analysis.
- Existing failures preserve the last valid character. Deleted/corrupt/incomplete files require recovery, not reinitialization. Pending initial assignment requires verified reachable same-owner pending-state history.
- A user whose first successful analysis was an empty Adventurer can receive a first regular class later. Only an actual class candidate triggers verified matched-record lineage reads. At most 100 state-history entries are supported; missing/corrupt/over-budget origin proof explicitly holds that assignment/analysis. No-candidate XP and traits do not require this history scan. Empty history alone never grants first-assignment authority.

Publication constructs five blobs, one base-tree-preserving tree and one commit, then applies fixed GraphQL `updateRefs` with `beforeOid=expectedHead` and `force:false`. Authoritative ref readback is required. Concurrent changes hold; ambiguous mutations are reconciled by reads, never blindly retried or downgraded to weaker ref updates.

The separate [profile-sync Action](../../profile-sync/action.yml) runs manually in `LOGIN/LOGIN`. It reads a bounded strict display model and verified PNG at one immutable same-owner fork head; it never imports remote Markdown/code, reads growth records or calculates growth. A separate fixed-path writer can update **README.md only**, preserving every byte outside exactly one managed region, using that profile repository's own `GITHUB_TOKEN`. Dry-run/unchanged never construct a writer. Missing/pending/invalid source data holds instead of erasing the last profile. No PAT, automatic trigger or cross-repository write is introduced.

Legacy profile storage remains compatible in place (old card PNG + README layout). No migration, reset, account rebinding or real growth update occurs. The schema-v1 `owner.profileRepositoryId` key is retained unchanged; it identifies the installation's storage repository. New fork records bind it to the fork ID; copied legacy/other-fork records fail owner binding.

Write/recovery paths are tested with injected HTTP, not by changing the maintainer's real growth records. Current validation workflows use `contents: read` only. No live profile installation, scheduled growth write, release tag or complete provider-coverage claim is implied.

One analysis is bounded to 900 API requests, with a separately bounded 30-request publisher. This leaves headroom under GitHub's standard [1,000 REST requests/hour/repository allowance for GITHUB_TOKEN](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-github_token-in-github-actions), not a guarantee of available quota. Other workflows, repeated previews and secondary limits can lower availability; exhaustion holds rather than partially paying repositories. A source-validation workflow may skip repeat public probes only when its read adapters are byte-identical to a previously successful live diagnostic; this does not certify skipped API steps or real profile publication.

## Source model

The installed Action uses confirmed `observed-api-v1`:

- Direct commit: currently reachable from a fixed default-branch head, attributed to the subject, using Git **committed date**, not first push/branch reflection or author date.
- Release: `published_at` plus currently public, non-draft, non-prerelease state when first accepted.
- Bug recovery: current exact case-insensitive `bug` label on an eligible merged PR or its current linked public closing issue when first accepted, not merge-time labels. A closing reference is not proof the issue was closed or fixed.

Accepted facts retain their original date/family and XP. Collection covers the previous 90 completed UTC days; traits use 30 days. Original UTC-day caps/item limits, deterministic identity ordering, unpaid eligible facts, duplicate suppression, faction permanence and legitimate older growth remain intact. An affected settled date requires original ordering proof; inaccessible old evidence cannot be replaced with guessed ordering.

Hybrid discovery combines public owned repositories, observed public events and manually added repositories, retaining tracked stable IDs. It is not every repository a user has ever helped operate. Known required failures hold the whole analysis; undiscovered repositories are not fabricated into scope or account-wide inactivity. Configure extra repositories/exclusions in `.github/commitkin.yml`.

Changed-file inventories are complete and independently checked against fixed Git trees. Recognized source/documentation/test/deployment files require exact UTF-8 before/after bytes and matching Git blob hashes. Generated/lock/record paths and fully enumerated unmatched files are non-contributing; they do not create guessed families. Missing required recognized contents hold. Managed-README-only changes do not earn activity.

## Mechanics and presentation

25 classes: Adventurer plus six families of four regular classes. Twelve traits, twelve achievement series with Bronze/Silver/Gold tiers, uncapped numeric levels, 100 daily XP maximum and appearance milestones every five levels through 50. A verified first regular assignment can happen immediately when qualified; subsequent changes require seven eligible observations and the 14-date cooldown. Traits use three observations after the first-analysis exception. Missing days are not simulated observations.

New output uses a **character-only PNG plus English Markdown** for identity/XP/traits, six family score rows, recent qualified activity counts and earned badges. Scores reuse the existing classifier; they are independent 0–100 indicators, not percentages that sum to 100. No new XP/classification formula, coding-time metric or account-wide activity promise is added. GitHub controls Markdown styling; Bloomguard/Ashbound palettes are carried by the character pixels, not arbitrary CSS. Legacy full-card rendering remains for compatibility.

The original code-native renderer provides 530 appearances: 24 regular classes × two factions × eleven stages (Lv.1–4 base, then 5…50), plus two fixed Adventurers. These are programmatic fallback pixels, not cleared AI concept sheets, external fonts or 530 hand-painted assets.

### Classes and traits

| Activity family | Own / focused | Own / distributed | Other / focused | Other / distributed |
|---|---|---|---|---|
| Craft | Blacksmith | Machinist | Runesmith | Golemancer |
| Guard | Warden | Shield Knight | Paladin | Wardkeeper |
| Knowledge | Scribe | Librarian | Chronicler | Lorekeeper |
| Verification | Sentinel | Wardweaver | Rune Examiner | Sealbinder |
| Recovery | Healer | Alchemist | Purifier | Restorer |
| Operations | Herald | Quartermaster | Guild Steward | Guild Commander |

Adventurer means no established regular-class pattern, not inactivity or low ability. Eligible 90-day family units are weighted 1.0/0.6/0.3 across the three 30-day bands. Family minima, score >=45 and >=8 lead apply; own/other needs >=60%, focused >=65%, distributed >=2 effective repositories and maximum <=55%. Boundary cases do not force an assignment. A cross-family change additionally needs a >=12 lead over the current family. See [exact classification](src/domain/character/classification.mjs).

Habit traits: Rekindled, Versatile, Focused, Roaming, Steadfast (priority in that order). Activity traits: Collaborative, Documenting, Testing, Mending, Finisher, Shipping, Organizing. At most one of each is displayed. Class-related activity traits take precedence; otherwise latest qualifying activity and the fixed tie-break apply. Eligibility uses verified recent activity, not AI personality inference. [Exact conditions](src/domain/character/traits.mjs).

### XP and achievements

| Reward | XP | Daily item limit |
|---|---:|---|
| Valid activity day | 10 | Once |
| Authored eligible PR/direct-contribution day | 10 | Once |
| Qualified triage day | 10 | Once |
| Merged PR | 20 | 3 |
| First eligible other-person review per PR | 15 | 3 |
| Published eligible release | 25 | 1 |

The first three common bonuses allocate first. Remaining items share the remaining 100-XP cap in original timestamp/ID order, with partial final payment allowed. Review history suppresses duplicate rewards. Item limits and capped/unpaid facts do not disappear from legitimate retained history. [Exact settlement](src/domain/growth/settlement.mjs).

Achievement series (Bronze / Silver / Gold thresholds): Footprints 10/30/100 activity dates; Enduring Flame 4/12/26 completed weeks with at least three active dates (not necessarily consecutive); Completed Works 1/10/50 merged PRs; Ally’s Shield 1/10/50 reviewed PRs; Knowledge Vault 5/25/100 knowledge units; Raised Wards 5/25/100 verification units; Healing Hands 1/10/30 qualifying recovery PRs; Launch Bell 1/5/20 releases; Orderly Guild 3/15/50 triage dates; Far Horizons 2/5/15 repositories with at least two active dates each; Old Hearth 4/12/26 completed weeks containing activity in one repository; Class Codex 1/6/24 distinct regular classes. Earned tiers persist; badge selection is automatic. [Exact counting/coverage rules](src/domain/character/achievements.mjs).

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

On uninstall, disable both workflows and optionally remove the profile block; retain fork growth files/history. For new installations, restore matching state/ledger/status and character.png/profile.json from the latest valid same-owner, same-storage-repository snapshot in the fork, then preview profile sync separately. Only legacy profile storage also restores its old card.png and managed README content (not unrelated README bytes). Same-date growth no-ops do not repair independently edited presentation. A restored bundle without sufficient historical provenance still holds for review. Never mix revisions, delete records to change faction, automatically reset or roll back unrelated files. See [recovery](../../README.md#recovery).

First-party code is MIT; dependencies retain their licenses/notices, including canonicalize's Apache-2.0. No external font or AI image is loaded. AI-image rights remain mandatory before future redistribution. See [credits](../../README.md#credits) and [validation status](../../docs/product/github-character/local-mvp-implementation.md).
