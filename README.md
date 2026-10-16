# Commitkin

Your GitHub activity. Your evolving pixel character.

An open-source, user-owned GitHub Action that turns observed public activity into a chunky pixel character and readable Markdown stats. Your fork owns configuration and growth; a separate profile Action updates only your README block. No signup, hosted backend or personal access token.

[Install Commitkin](#installation) · [Troubleshooting](#installation-troubleshooting) · [Recovery](#recovery) · [Credits](#credits)

## Status

MVP implementation / pre-release validation. Fork-owned growth, character-only PNG rendering, six activity-family scores, recent activity Markdown and profile-only synchronization are implemented. One explicitly confirmed author snapshot and a separately approved actual README-only profile publication passed basic-token verification. **Real recovery and other-user fork execution remain unverified.** Both installed workflows are restored to manual-only read-only previews; further writes require separate authorization. No new automatic trigger or release tag is enabled.

<details>
<summary>Maintainer validation history</summary>

The [initial diagnostic run](https://github.com/JEONTAK/commitkin/actions/runs/38712379879) passed 773 then-current tests and a real basic-token known-scope read probe. Later source changes need separate validation. A green diagnostic is not proof of every endpoint, complete discoverability, live installation or publication.

The [observed-source read diagnostic](https://github.com/JEONTAK/commitkin/actions/runs/38719578588) at `f54463901518d36b47c69f1ec740697409e5dd09` passed 1,183 tests plus actual built-in-token collection, multi-page file acquisition and a fixed public closing-issues query. No growth files were written. Later installation-only fixes have their own source tests; unchanged public probes may be explicitly skipped to conserve quota, never relabeled as executed.

Earlier [author-installation preview](https://github.com/JEONTAK/commitkin-character/actions/runs/38850629775) succeeded on 2026-10-16 with 22 known public repositories and 594 runtime requests, preparing five files in memory only. The then-current [profile-sync diagnostic](https://github.com/JEONTAK/JEONTAK/actions/runs/38850632042) correctly held because no display had yet been saved (`PROFILE_SOURCE_DIRECTORY_INVALID`, Actions conclusion failure). No real growth was saved by those earlier diagnostics. [Historical evidence](docs/product/github-character/local-mvp-implementation.md#author-installation-dry-runs--2026-10-16).

After separate permanent **Bloomguard** confirmation, [first storage](https://github.com/JEONTAK/commitkin-character/actions/runs/38854047488) published the matched five-file snapshot only in the bound author repository: **Lv.1 Adventurer, 20 XP**, 607 total runtime requests. The subsequent [profile dry-run](https://github.com/JEONTAK/JEONTAK/actions/runs/38854623804) prepared one README change in memory. [First-storage evidence](docs/product/github-character/local-mvp-implementation.md#first-author-storage-and-positive-profile-dry-run--2026-10-16).

With separate display-only approval, [actual profile publication](https://github.com/JEONTAK/JEONTAK/actions/runs/38856248063) then updated only the managed README block. The [live profile](https://github.com/JEONTAK#user-content-commitkin) displays the character, six family scores and recent activity as native Markdown. Growth files and outside-block text are unchanged. Both author/profile workflows are restored to manual read-only dry-run; no automatic execution or further growth/display write is enabled. [Publication evidence](docs/product/github-character/local-mvp-implementation.md#one-off-profile-publication--2026-10-16).

</details>

## How it works

- Choose **Bloomguard**, a cozy fantasy guild, or **Ashbound**, a dark fantasy order. First published choice is permanent.
- Public commits, merged PRs, reviews, documentation, tests, bug-recovery signals, releases and qualifying issue operations shape 25 classes, 12 traits and 36 achievement tiers.
- Regular-class appearance grows at five-level milestones through 50; numeric levels continue. Adventurer is a fixed starter until a clear activity pattern is established.
- Daily analysis uses completed UTC days: 90-day class window, 30-day traits, original-date XP settlement and 100 XP daily cap. This reflects observed contribution style, **not skill, seniority or productivity**.
- Minimal growth records and `.github/commitkin.yml` live only in your public fork. The profile repository receives only its managed README display, not settings, ledger or growth records.
- Only the character is a PNG. Class, faction, level/XP, traits, six family scores, recent activity and achievements are rendered as Markdown, not flattened into a card image. GitHub controls README colors/layout; the concept mockups are not pixel-exact Markdown promises.

Confirmed `observed-api-v1` uses current default-branch reachability plus Git committed date for direct commits, `published_at` plus currently public/normal release state, and current exact `bug` labels at first eligible analysis. It does not reconstruct first push, original release lifecycle or merge-time labels. Accepted facts/XP remain when mutable metadata later changes.

Automatic discovery is best-effort, supplemented by explicit repositories. Known required collection failures hold the whole analysis and preserve the last valid character; missing data is not inactivity. Bounded request/file limits may require narrowing scope. See [runtime details](packages/commitkin/README.md).

## Installation

You do **not** write the character, stat bars or long generated Markdown yourself. You add two README markers and install one profile-sync workflow; Commitkin fills the block when you intentionally publish.

Replace `YOUR_LOGIN` below with your GitHub username. This guide is for a **personal GitHub.com account** with two public repositories under the same owner:

| Repository | What belongs here |
| --- | --- |
| `YOUR_LOGIN/commitkin` — your actual fork | Analysis settings, permanent faction, growth records, character PNG and display JSON |
| `YOUR_LOGIN/YOUR_LOGIN` — your profile | Existing README plus the managed display block and profile-sync workflow |

No server, signup, PAT or custom secret is needed. Both workflows use their own built-in `${{ github.token }}`. All runs in this guide are **manual**; there is no timer, push trigger or automatic cross-repository sync.

This is an opt-in pre-release guide, not a claim that other-user installation/recovery has been live-tested. Most class/faction artwork still uses development fallbacks; the approved Bloomguard Adventurer original is integrated, but the full art/rights-release gates remain open.

### 1. Fork the project

1. Open [JEONTAK/commitkin](https://github.com/JEONTAK/commitkin) and choose **Fork** into your personal account. Keep the name `commitkin` and visibility public.
2. Open your fork's **Actions** tab and enable workflows if GitHub asks.
3. Use your fork's default branch for every run below, normally `main`.

Use a real GitHub fork, not a new unrelated repository with copied files or a template. Do not copy anybody else's `.commitkin` files or growth history. Organization accounts/private installations are not supported by this setup.

### 2. Choose a faction and run a read-only preview

Your fork already includes [`.github/workflows/commitkin.yml`](.github/workflows/commitkin.yml). You do not need to create it for the preview.

Open **Actions → Commitkin fork preview → Run workflow** and enter:

| Input | First preview / first save |
| --- | --- |
| Branch | Your fork's default branch |
| `faction` | `bloomguard` for the cozy fantasy guild, or `ashbound` for the dark fantasy order |
| `confirmation` | `CONFIRM_PERMANENT_FACTION` — exact spelling |

The inherited workflow has `contents: read` and `dry-run: 'true'`. A successful ready preview reports:

```json
{
  "decision": "prepared",
  "dryRun": true,
  "published": false,
  "actualRecordsChanged": false
}
```

That is a prepared result, **not saved growth and not a published profile**. A read-only preview does not lock the faction, so you may preview either choice before saving. If analysis reports `hold` or `pending`, inspect its reason before continuing; missing data is not zero activity.

### 3. Save your character for the first time

**Your first published faction is permanent.** Growth files, tracked repository IDs, dates, aggregates and identity hashes become public in your fork and Git history; hashes are not encryption or anonymity. First publication may reserve a permanent faction even when growth analysis remains pending.

When you intentionally want to save, replace **your fork's** `.github/workflows/commitkin.yml` with this complete manual publisher. It uses the same first-use inputs as the preview:

```yaml
name: Commitkin character (manual)

"on":
  workflow_dispatch:
    inputs:
      faction:
        description: First save only; leave empty after any saved snapshot
        type: choice
        options: ['', bloomguard, ashbound]
        default: ''
      confirmation:
        description: First save only; CONFIRM_PERMANENT_FACTION
        type: string
        default: ''

permissions:
  contents: write

concurrency:
  group: commitkin-fork
  cancel-in-progress: false

jobs:
  character:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - name: Check out this fork
        uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - name: Save verified character files in this fork only
        uses: ./
        with:
          token: ${{ github.token }}
          faction: ${{ inputs.faction }}
          confirmation: ${{ inputs.confirmation }}
          dry-run: 'false'
```

Commit that workflow to the default branch, then open **Actions → Commitkin character (manual) → Run workflow**. For this first save, select your chosen faction and type the same confirmation. Committing this manual-only workflow does not itself run it.

After a confirmed publication, check that the [five generated files](#generated-files) exist in **your fork**, not your profile repository. To proceed to profile display, `state.json` must show `growth.phase: "ready"` and `profile.json` must show `analysis.phase: "ready"`. Do not edit those files by hand.

If the saved snapshot is `pending`, your faction is already fixed but XP/class are not finalized. Resolve the reported collection problem and rerun with **both `faction` and `confirmation` empty**. Do not delete records or choose another faction. A green published reservation is not proof of ready growth; check the stored phase.

### 4. Add two markers to your profile README

Open or create your public profile repository **`YOUR_LOGIN/YOUR_LOGIN`** and its `README.md` on the default branch. Keep your existing content and add this pair **exactly once**, wherever the character should appear:

```md
<!-- COMMITKIN:START -->
<!-- COMMITKIN:END -->
```

Do not copy the long generated block, paste the markers inside a code fence, escape them with backslashes or add a second pair. The sync Action generates the contents between them; existing bytes outside them are preserved. The character is the only image; identity, XP, six stat bars and recent activity remain Markdown.

### 5. Install and preview profile synchronization

In **`YOUR_LOGIN/YOUR_LOGIN`**, create `.github/workflows/commitkin-profile-sync.yml` with this complete workflow. Replace the single `YOUR_LOGIN/commitkin` value with your actual fork slug:

```yaml
name: Commitkin profile sync (manual)

"on":
  workflow_dispatch:
    inputs:
      source_repository:
        description: Your public Commitkin fork
        type: string
        required: true
        default: YOUR_LOGIN/commitkin

permissions:
  contents: read

concurrency:
  group: commitkin-profile-display
  cancel-in-progress: false

jobs:
  profile:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: Preview the profile block without publishing
        uses: JEONTAK/commitkin/profile-sync@6e507b17f0eaafaa81f4eef6df83404df72a684a
        with:
          token: ${{ github.token }}
          source-repository: ${{ inputs.source_repository }}
          dry-run: 'true'
```

The full SHA pins the reviewed pre-release renderer with six-row Markdown graphs; there is no `@v1` release tag. The reusable [unfilled template](examples/profile-sync.yml) is also available, but the complete example above needs no SHA placeholder replacement. Future code updates should be reviewed before changing the pin.

Commit attribution was corrected on 2026-10-16. This pin has the same reviewed code as the previous renderer; see [identity migration notes](docs/commit-identity-migration.md) for the old-to-new references. Historical Actions links remain evidence of their original runs, not reruns against the rewritten history.

Commit the file, then open **Actions → Commitkin profile sync (manual) → Run workflow** in the **profile repository**, using its default branch. Confirm the source field names your fork, not `JEONTAK/commitkin` or your profile repository.

A successful preview reports `PROFILE_SYNC_PREPARED`, `dryRun: true`, `published: false`; `PROFILE_ALREADY_CURRENT` is valid if the managed display already matches. It prepares Markdown in memory, **without changing the README**. A missing/pending/invalid fork snapshot safely holds instead of creating growth or replacing your profile.

### 6. Publish the profile block

After the profile preview passes and you intentionally want the README update, change **only these two values** in the profile workflow from step 5:

```diff
 permissions:
-  contents: read
+  contents: write

-          dry-run: 'true'
+          dry-run: 'false'
```

The diff illustrates edits to the full YAML above; do not paste the `+`/`-` lines as a new workflow. Commit, then manually run **Commitkin profile sync (manual)** again. This is separate from the fork's growth run.

Confirm `published: true` and a README-only commit, then open your public GitHub profile. `PROFILE_ALREADY_CURRENT` may instead make no commit when nothing changed. The Action replaces only the one managed block; it does not calculate XP, write the fork or copy growth records into the profile repository. The image URL is generated and commit-pinned for you—do not maintain it manually.

### 7. Update later, still manually

1. Run **Commitkin character (manual)** in your fork with **both faction fields empty**, including when resuming a saved pending snapshot. This checks new public activity and may update growth.
2. Once its stored snapshot is ready, run **Commitkin profile sync (manual)** in your profile repository. This displays the already saved snapshot; the first run does not trigger this one automatically.

To return either workflow to preview-only mode, set both `contents: read` and `dry-run: 'true'` in that workflow. To intentionally publish later, explicitly restore both write/false values. No schedule is needed or enabled by this guide. Never reset/delete records to rerun first setup or unlock a different faction.

### Installation troubleshooting

| Symptom | What to check |
| --- | --- |
| Workflow or Run workflow is missing | Enable Actions in that repository and commit the YAML to its default branch. The fork and profile have separate Actions pages. |
| Nothing appears after a successful preview | Dry-run saves nothing. First publish a ready fork snapshot, then separately publish the profile block. |
| `FACTION_ALREADY_CONFIRMED` | Clear **both** faction and confirmation inputs. The saved choice—including a pending reservation—is permanent. |
| Profile sync holds or keeps old content | Confirm the source is your same-owner public fork, its five files form a ready matched snapshot, and README has one unescaped marker pair. Preserve existing records. |
| Collection is pending, unavailable or over budget | Inspect the bounded reason/request diagnostics. Resolve known-target access or intentionally configure exclusions; retry after the reported quota reset when applicable. Do not assume missing data is zero. |
| Publication fails with permissions, rulesets or a branch conflict | Both contents-write and dry-run false are required, but repository/organization policies may still block writes. Review the stated cause or competing commit; do not add a PAT, force-push or weaken protection as a workaround. An uncertain write must be checked before retrying. |
| Expected work is missing from the stats | Only qualified observed public activity counts. Automatic discovery is best-effort; add public repositories below. A completed empty scope is different from an incomplete analysis. |

Both Actions run Node.js 24 with pinned dependencies and lifecycle scripts disabled. The fork's local `uses: ./` runs its checked-out code, so review fork updates before running; the profile executes only its pinned renderer, never code or arbitrary Markdown from display data. Each [built-in token is repository-scoped](https://docs.github.com/en/actions/concepts/security/github_token). Public workflow inputs/logs and configuration may be visible. Stop after a held/uncertain publication and follow [recovery](#recovery); do not blindly replay or mix snapshots.

<details>
<summary>Maintainer's author-only installation exception</summary>

`JEONTAK/commitkin-character` is an ordinary public installation, bound in reviewed code to repository ID `1421634321`, owner ID `76037656` and that canonical slug. It is not the repository other users should fork or use as their source. Other users must fork **JEONTAK/commitkin**. This is not a configurable bypass for copied repositories; rename/transfer/recreation requires review and no saved record IDs are rebound. This documentation does not change the maintainer's growth records or installed workflows.

</details>

### Extra repositories and exclusions

Optional `.github/commitkin.yml`:

```yaml
version: 1
repositories:
  additional:
    - owner/project
  exclude:
    - owner/generated-only-repo
```

Omit the file on first install to accept empty lists. Once a configuration has been used, deleting it requires attention, not silent defaults. Values are public `owner/repo` names, not URLs or credentials. Names normalize; stable IDs preserve tracking across renames. Explicit exclusions stop future analysis, not retained legitimate XP. An unavailable known required repository holds the run until access is restored or explicitly excluded. This does not prove undiscovered history.

### Generated files

Only these five paths publish together **in the fork**:

```text
.commitkin/state.json
.commitkin/ledger.json
.commitkin/status.json
.commitkin/character.png   # character pixels only
.commitkin/profile.json    # bounded, versioned display projection, not growth authority
```

The fork README is not rewritten. The separate profile writer can update only `README.md`; it copies no records or images into that repository. The PNG link pins the same fork commit as the display JSON, preventing mixed-revision image/text. Markdown is generated from validated structured data, never imported as arbitrary remote Markdown/HTML.

The product upstream remains free of personal growth records so future forks do not inherit someone else's character/history. It permits maintainer read-only previews only; publication to its durable repository ID is rejected as `UPSTREAM_PREVIEW_ONLY`, including legacy layouts. It is not a storage-source exception for profile sync. Only the separately reviewed author repository described above is an ordinary-repository exception; fork/owner validation for other users stays unchanged. Its one explicitly approved first snapshot does not authorize writes for another user, later refreshes or profile publication.

IDs, dates, aggregates and hashes are public. Hashes are not encryption or anonymity. No raw activity content, file contents, titles/bodies, emails, participant lists or credentials are archived. Keep fork Git history for recovery. Same-date no-ops do not rewrite files or claim new successful freshness. Family scores are independent 0–100 contribution-style indicators, not percentages that sum to 100 or skill rankings. Recent summary counts refer to qualified facts in the verified scope/window, not account-wide totals or coding time.

## Recovery

- `hold`: required proof is missing, inaccessible, over budget or contradictory. Preserve the character; inspect the bounded code and resolve the cause.
- `Analysis pending`: faction confirmed, growth unknown. Retry without faction/confirmation; do not delete files or treat unknown XP as zero.
- Missing/corrupt/mismatched records: restore **all three growth JSON files from the latest valid same-owner, same-storage-repository commit/backup in the fork**, keeping matched revisions. Restore its character and display projection from the same snapshot. Then preview profile sync separately. Same-date growth no-ops do not repair independently edited presentation. Unverifiable restored history holds; do not mix snapshots, reset XP, reselect faction or revert unrelated files.
- Competing publication: expected-head compare-and-swap rejects a changed branch. Read authoritative state before retrying; ambiguous writes are never blindly replayed.
- Uninstall: disable/remove both workflows and optionally the profile block, retaining fork `.commitkin` and its history. No automatic expiry/deletion; history redaction is a separate explicit user operation.

Legacy `LOGIN/LOGIN` storage installations remain supported in place with their old five-file layout. They are not copied, rebound, reset or automatically migrated into a fork. The v1 field `owner.profileRepositoryId` retains its wire name and is the immutable installation/storage repository ID; new fork records bind it to the fork. Copying another repository's records is rejected. Rewritten history or creating another fork is not an account-wide anti-tamper guarantee; there is no central registry.

Rewritten-away user-managed history cannot always be detected. Old uncollected periods remain explicit gaps, not inactivity or guaranteed recoverable history. Required failures never advance successful freshness or growth observations.

First regular assignment after an earlier successful Adventurer analysis requires a verified reachable matched-record lineage (at most 100 state-history entries, also subject to request budget). This scan happens only when there is an actual first-class candidate; ordinary no-candidate XP/traits continue without it. Insufficient origin proof explicitly holds rather than trusting an empty class history or rewriting the faction.

### Request diagnostics

Action reports expose the underlying pending cause, per-public-repository request counts/completion and fixed endpoint-category totals, including retries and available provider quota headers. No request URLs, source text or credentials are included. These diagnostics live in the run log, not growth records. The 900-request analysis ceiling is unchanged; quota exhaustion still holds the entire analysis.

The observed collector still enumerates the complete fixed-HEAD ancestry and every PR/review history. After validating each Git committed date, it skips commit-to-PR association requests for commits already outside the eligible analysis window. It does not use author dates, stop ancestry pagination early, exclude repositories or turn missing activity into zero. Legacy historical collection is unchanged.

Unlinked Git authors outside the validated eligible window are explicitly excluded by date, not guessed as the subject or described as inactivity. Inside-window unknown attribution still holds the entire analysis. Invalid source shapes/times and conflicts with retained facts fail before this date exclusion; saved facts/XP are preserved.

## Development and validation

```sh
npm --prefix packages/record-validator ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/commitkin ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/record-validator test
npm --prefix packages/commitkin run test:coverage
node packages/commitkin/bin/commitkin.mjs demo --faction bloomguard --name first-demo
```

Demos write fictional output only in fresh `deliverables/commitkin-local-preview/NAME/`, never real records. Keep both packages, schemas and fixtures together. Do not commit `node_modules`, coverage or generated output. See [runtime instructions](packages/commitkin/README.md) and [implementation status](docs/product/github-character/local-mvp-implementation.md).

[Read-only core validation](.github/workflows/core-validation.yml) is manual-only, `contents: read`: tests, fictional previews, actual basic-token read adapters and no-live-record footprint. Earlier [token](.github/workflows/token-probe.yml) and [discovery](.github/workflows/operations-discovery-probe.yml) probes remain diagnostic-only. None enables a scheduled publisher or writes growth files. Empty successful reads do not prove populated endpoint semantics.

## Credits

First-party code, README and workflows: [MIT](LICENSE), copyright 2026 JEONTAK. Keep package notices. Dependencies retain original licenses, including canonicalize's Apache-2.0. GitHub APIs/Actions and third-party activity retain their terms. Public fixtures such as `cli/cli` belong to their maintainers and imply no endorsement.

Bloomguard Adventurer uses the owner's previously approved original [character reference](packages/commitkin/assets/characters/README.md), copied byte-for-byte with transparency and provenance preserved. Other class/faction art still uses programmatic development fallbacks; the 530-image production set is unfinished. The approved image is excluded from the code's MIT license and is not certified CC BY 4.0; AI-image rights review remains mandatory before public release. No external font or game asset is loaded. Selected OFL 1.1 fonts retain original notices. Code licensing does not license user profiles or growth data under MIT.
