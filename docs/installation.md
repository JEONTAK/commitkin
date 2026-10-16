# Install Commitkin

[← Commitkin](../README.md)

**Fork → Set up → Connect your profile.** No repeated YAML edits, PAT, custom secret, signup or server.

Use a personal GitHub.com account and two public repositories under the same owner:

- `YOUR_LOGIN/commitkin`: your real fork of [JEONTAK/commitkin](https://github.com/JEONTAK/commitkin); renamed forks work too.
- `YOUR_LOGIN/YOUR_LOGIN`: your profile repository, with a `README.md`.

Private activity and organization-owned installations are unsupported. This is a pre-release: other-user live installation and live recovery remain unverified. Every run below is manual.

## 1. Fork

Fork the product into your personal account, keep it public and enable Actions if prompted. Use its default branch, normally `main`.

Do not use a template/copied repository, fork `commitkin-character`, or copy someone else's `.commitkin` files. Existing forks need to sync the product changes once to receive the guided setup; do not discard records or overwrite custom workflows.

## 2. Set up your character

Open **your fork → Actions → Set up Commitkin → Run workflow**.

| Input | First preview (optional) | First save | Later preview/update |
| --- | --- | --- | --- |
| `mode` | `preview` | `save` | `preview` or `save` |
| `faction` | Choose either faction | Your chosen faction | Leave empty |
| `confirm_faction` | Unchecked | Checked | Unchecked |

**First save makes your faction permanent—even if analysis is pending.** Bloomguard and Ashbound cannot be switched later. Public records and Git history include repository IDs, dates, aggregates and identity hashes. Hashes are not encryption or anonymity.

There is no phrase to type and no workflow file to edit. Preview runs in a read-only job. Save runs in a separate write-capable job and publishes only the five character files in your fork; it never edits the fork README or your profile.

Open the completed run's **Summary**:

- **Preview:** nothing saved or locked. Review the JSON result in the step log; saving remains your explicit choice.
- **Character saved / Saved character unchanged:** your personalized profile connection code is shown. It uses the actual fork path, including renamed forks.
- **Faction saved permanently. Analysis is pending:** no connection code yet. Fix the reported cause, then retry `save` with faction empty and confirmation unchecked. Never delete records or reselect a faction.
- **Setup stopped / outcome unknown:** follow the diagnostic and inspect uncertain writes before retrying.

The first save may take several minutes. Before profile connection, the saved `state.json` must have `growth.phase: "ready"` and `profile.json` must have `analysis.phase: "ready"`.

## 3. Connect your profile

1. Open your public **`YOUR_LOGIN/YOUR_LOGIN`** repository. Create it with a README if needed.
2. Create **`.github/workflows/commitkin-profile-sync.yml`** on its default branch. Paste the **entire YAML block from the successful setup Summary**, then commit. Your account and fork path are already filled in; do not paste the generated stats or replace anything.
3. Open **Actions → Commitkin profile → Run workflow**.

| Input | First connection | Later preview/update |
| --- | --- | --- |
| `mode` | `publish` | `preview` or `publish` |
| `connect_if_missing` | Checked | Unchecked |

You can select `preview` with the first-connection checkbox checked before publishing. A preview prepares the display without writing it.

On first connection, Commitkin appends its managed block to the end of your existing README. All existing bytes stay in place. If you already have one valid marker pair, Commitkin updates only that region and preserves the surrounding content. Malformed, escaped, duplicate or code-fenced marker examples stop first connection safely.

For a custom position, optionally put this pair where you want the character before connecting:

```md
<!-- COMMITKIN:START -->
<!-- COMMITKIN:END -->
```

Paste only the two lines, not the surrounding fence. Markers are optional for normal first connection; Commitkin creates them after your explicit checkbox approval.

Expect `PROFILE_SYNC_PREPARED` for a changed preview, `published: true` for a confirmed README-only publication, or `PROFILE_ALREADY_CURRENT` with no commit. Open your profile: the character is the only image; all six stat bars and recent activity remain Markdown.

The generated workflow runs a reviewed, commit-pinned product renderer—not code or arbitrary Markdown from your fork. It never calculates growth or writes your fork. Both workflows use their own built-in GitHub token. GitHub scopes each token to its own repository, so this one-time profile file is still necessary. [GitHub token documentation](https://docs.github.com/en/actions/concepts/security/github_token).

## Update without editing YAML

1. In the fork, run **Set up Commitkin → save**, faction empty, confirmation unchecked.
2. After a ready save, in the profile run **Commitkin profile → publish**, connection checkbox unchecked.

Use the preview modes whenever you want no-write checks. Only the selected job runs; previews have `contents: read`, publishers have `contents: write`. The first run does not trigger the second. No schedules, push hooks or cross-repository dispatches are installed.

To recover the connection code, reopen the successful setup run's Summary. A read-only, same-date unchanged preview also shows it. Do not save a character merely to retrieve installation code.

Existing installed workflows keep working unchanged. This release does not migrate your existing workflow permissions, pins, records or automatic-run settings.

## Troubleshooting

| Problem | Check |
| --- | --- |
| No Run workflow button | Enable Actions and commit the workflow to the default branch. Fork and profile have separate Actions pages. |
| Setup workflow still has the old name | Sync your fork with upstream once; preserve existing records and review workflow conflicts instead of overwriting custom files. |
| Preview passed, nothing appeared | Preview saves nothing. Save a ready fork snapshot, then run profile `publish`. |
| `SETUP_FACTION_CONFIRMATION_REQUIRED` | First save requires a faction and the confirmation checkbox. |
| `SETUP_FACTION_REQUIRED` | Choose a faction for first use, or clear the checkbox for an existing character. |
| `FACTION_ALREADY_CONFIRMED` | Leave faction empty and the confirmation unchecked, including after a saved pending reservation. |
| Missing profile block | First connection needs `connect_if_missing` checked. Later missing blocks hold unless you explicitly reconnect. |
| Invalid profile markers | Keep one unescaped marker pair outside code fences. Never delete records to fix README markup. |
| Missing or pending source | Check the source fork's ready snapshot; profile sync cannot initialize or repair growth. |
| `SETUP_SUMMARY_UNAVAILABLE` | Inspect the JSON result and fork files first. A missing Summary is not evidence that publication failed. |
| Collection pending or over budget | Inspect diagnostics and retry after quota reset where applicable. Missing data is not zero. |
| Write denied / branch changed / outcome unknown | Inspect repository policy and authoritative state. Do not add a PAT, force-push or weaken protection. |
| Expected activity absent | Only qualified public activity counts. Add known public repositories below; discovery is best-effort. |

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
