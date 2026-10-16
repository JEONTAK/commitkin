# Install Commitkin

[← Commitkin](../README.md)

Use a **personal GitHub.com account** with two public repositories under the same owner:

- `YOUR_LOGIN/commitkin`: a real fork of [JEONTAK/commitkin](https://github.com/JEONTAK/commitkin).
- `YOUR_LOGIN/YOUR_LOGIN`: your profile repository, with a `README.md`.

Replace `YOUR_LOGIN` with your username. No PAT, custom secret or server is needed. Both Actions use their own built-in `${{ github.token }}`. Private activity and organization-owned installations are unsupported.

This is a pre-release. Other-user installation and live recovery remain unverified. Every run below is manual.

## 1. Fork

Fork the product into your personal account, keep it public and enable Actions if prompted. Use the default branch, normally `main`.

Do not use a template/copied repository, fork `commitkin-character`, or copy someone else's `.commitkin` files.

## 2. Preview your faction

Your fork includes [`.github/workflows/commitkin.yml`](../.github/workflows/commitkin.yml).

Open **Actions → Commitkin fork preview → Run workflow**:

| Input | Value |
| --- | --- |
| `faction` | `bloomguard` or `ashbound` |
| `confirmation` | `CONFIRM_PERMANENT_FACTION` |

The preview uses `contents: read` and `dry-run: 'true'`. A ready result reports `decision: prepared`, `published: false` and `actualRecordsChanged: false`.

**Nothing is saved or locked.** You may preview either faction. Stop on `hold` or `pending` and inspect the reason.

## 3. Save your character

**First publication makes the faction permanent—even if analysis remains pending.** Repository IDs, dates, aggregates and identity hashes become public in your fork and Git history. Hashes are not encryption or anonymity.

When ready, replace **your fork's** `.github/workflows/commitkin.yml` with:

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

Commit to the default branch, then manually run **Commitkin character (manual)** with your faction and confirmation. Committing the workflow does not run it.

Check the [five generated files](#generated-files). Before profile setup, `state.json` must show `growth.phase: "ready"` and `profile.json` must show `analysis.phase: "ready"`.

If saved as `pending`, the faction is already fixed but XP/class remain unknown. Resolve the cause and retry with **both inputs empty**. Do not delete or edit records.

## 4. Add profile markers

In **`YOUR_LOGIN/YOUR_LOGIN`**, add this pair to `README.md` exactly once:

```md
<!-- COMMITKIN:START -->
<!-- COMMITKIN:END -->
```

Paste the lines, not the surrounding code fence. Do not escape them or copy a generated block. Commitkin fills the region and preserves everything outside it.

## 5. Preview profile sync

In **your profile repository**, create `.github/workflows/commitkin-profile-sync.yml`. Replace `YOUR_LOGIN/commitkin` with your fork:

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

Commit, then open **Actions → Commitkin profile sync (manual) → Run workflow** on the default branch. The source must be your same-owner public fork—not the product upstream or your profile.

Expect `PROFILE_SYNC_PREPARED`, `dryRun: true`, `published: false`. `PROFILE_ALREADY_CURRENT` is also valid. The README remains unchanged; missing/pending/invalid source data safely holds.

The renderer is pinned to reviewed code, not an unissued `@v1` tag. See [identity migration](commit-identity-migration.md) for the corrected SHA.

## 6. Publish your profile

After a successful preview, change only these values in the full profile workflow:

```diff
 permissions:
-  contents: read
+  contents: write

-          dry-run: 'true'
+          dry-run: 'false'
```

This is an edit illustration, not a standalone workflow. Commit and manually run profile sync again.

Expect `published: true` and a **README-only commit**, or `PROFILE_ALREADY_CURRENT` with no commit. Open your profile and check the character, six Markdown stat bars and recent activity. Only the character is an image; its URL is generated and commit-pinned.

Profile sync never calculates growth or writes your fork.

## 7. Update manually

1. Run the fork's **Commitkin character (manual)** with **both faction inputs empty**.
2. Once the saved snapshot is ready, run the profile's **Commitkin profile sync (manual)**.

The first run does not trigger the second. To return either workflow to preview-only, restore `contents: read` and `dry-run: 'true'`. No schedule is added.

## Troubleshooting

| Problem | Check |
| --- | --- |
| No Run workflow button | Enable Actions and commit the YAML to the default branch. Fork and profile have separate Actions pages. |
| Preview passed, nothing appeared | Preview saves nothing. Publish a ready fork snapshot, then separately publish the profile. |
| `FACTION_ALREADY_CONFIRMED` | Clear **both** faction inputs, including after a saved pending reservation. |
| Profile holds | Check the source owner/fork, ready snapshot and one unescaped marker pair. |
| Collection is pending or over budget | Inspect the reason/request diagnostics and retry after quota reset where applicable. Missing data is not zero. |
| Write denied or branch changed | Verify write/false, then inspect policy/conflict. Do not add a PAT, force-push or weaken protection. Check uncertain writes before retrying. |
| Expected activity is absent | Only qualified public activity counts. Discovery is best-effort; add known public repositories below. |

## Repository settings

Optional `.github/commitkin.yml` in **your fork**:

```yaml
version: 1
repositories:
  additional:
    - owner/project
  exclude:
    - owner/generated-only-repo
```

Use public `owner/repo` names, not URLs or credentials. On first install, omitting this file means empty lists. Once used, do not delete it to reset configuration.

Exclusions stop future analysis, not earned XP. An unavailable known required repository holds analysis until access is restored or it is explicitly excluded. Undiscovered history is not guaranteed.

## Generated files

These five paths publish together **in your fork**:

```text
.commitkin/state.json
.commitkin/ledger.json
.commitkin/status.json
.commitkin/character.png
.commitkin/profile.json
```

The fork README is untouched. The profile receives only its managed README display, not records or configuration. Its image and display model come from the same fixed fork commit.

Public records contain repository IDs, dates, aggregates and identity hashes—not raw titles/bodies, code, emails, participant lists or credentials. Records/history remain public when the profile block is hidden or removed.

## Recovery

- **Hold:** keep the current character; resolve the reported missing, inaccessible, contradictory or over-budget input.
- **Pending:** the saved faction is locked and growth is unknown. Retry without faction/confirmation; never treat unknown XP as zero.
- **Missing or corrupt files:** restore all three growth JSON files plus PNG/profile projection from **one valid same-owner, same-storage snapshot**. Preview profile sync separately. Do not mix revisions, reset XP, reselect a faction or roll back unrelated files. Unverifiable history still holds.
- **Concurrent/uncertain write:** inspect authoritative state before retrying. Never blindly replay a publication.
- **Uninstall:** disable/remove both workflows and optionally the profile block. Keep the fork's `.commitkin` files and Git history; records do not automatically expire.

Legacy profile-storage installations remain supported in place, not automatically copied or rebound into forks. Same-date no-ops do not repair independently edited presentation, and lost/uncollected history is not guaranteed recoverable. See [runtime limits](../packages/commitkin/README.md).

<details>
<summary>Maintainer-only installation</summary>

`JEONTAK/commitkin-character` is a specifically bound ordinary repository: ID `1421634321`, owner ID `76037656`, exact canonical slug. It is not a generic copied-repository bypass. Other users must fork `JEONTAK/commitkin`; the product upstream cannot store personal growth or serve as a profile source.

</details>

Both Actions use Node.js 24 with pinned dependencies and lifecycle scripts disabled. Review fork code before running its local `uses: ./`; the profile executes its pinned renderer, not code or arbitrary Markdown from display data. [Runtime details](../packages/commitkin/README.md) · [Credits](../README.md#credits).
