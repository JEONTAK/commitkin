# Commitkin

Your GitHub activity. Your evolving pixel character.

An open-source, user-owned GitHub Action that turns observed public activity into a chunky pixel character and readable Markdown stats. Your fork owns configuration and growth; a separate profile Action updates only your README block. No signup, hosted backend or personal access token.

## Status

MVP implementation / pre-release validation. Fork-owned growth, character-only PNG rendering, six activity-family scores, recent activity Markdown and profile-only synchronization are implemented locally. Publication/recovery are covered by injected-HTTP tests; **real growth publication and live profile synchronization have not been performed**. All supplied workflows are manual-only previews. No schedule or release tag is enabled.

The [initial diagnostic run](https://github.com/JEONTAK/commitkin/actions/runs/38712379879) passed 773 then-current tests and a real basic-token known-scope read probe. Later source changes need separate validation. A green diagnostic is not proof of every endpoint, complete discoverability, live installation or publication.

The [observed-source read diagnostic](https://github.com/JEONTAK/commitkin/actions/runs/38719578588) at `f54463901518d36b47c69f1ec740697409e5dd09` passed 1,183 tests plus actual built-in-token collection, multi-page file acquisition and a fixed public closing-issues query. No growth files were written. Later installation-only fixes have their own source tests; unchanged public probes may be explicitly skipped to conserve quota, never relabeled as executed.

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

This pre-release guide is opt-in, **not permission to write records on behalf of another user**.

1. Fork this repository to your personal account, normally `YOUR_LOGIN/commitkin`. Keep it public. GitHub's root fork-network ID binds it to Commitkin; a copied unrelated repository is not an installation. Enable Actions in the fork when you intentionally want to preview. There are no push/timer triggers.
2. Keep optional analysis configuration in the **fork's** `.github/commitkin.yml`. Run its included **Commitkin fork preview** workflow manually. First preview takes a faction and `CONFIRM_PERMANENT_FACTION`; the checked-in `contents: read` and literal `dry-run: 'true'` save nothing.
3. In your public personal profile repository `YOUR_LOGIN/YOUR_LOGIN`, add exactly one region yourself. Bytes outside it remain unchanged:

```md
<!-- COMMITKIN:START -->
<!-- COMMITKIN:END -->
```

4. Copy [examples/profile-sync.yml](examples/profile-sync.yml) to the **profile repository's** `.github/workflows/commitkin-profile-sync.yml`. Replace the placeholder with a reviewed **full 40-character source SHA** containing `profile-sync/action.yml`. No `@v1` tag exists. Its only product input is the source fork slug; it never stores faction/scope/growth there.
5. Profile sync reads a successfully published display projection from the same owner's fork at one immutable commit. With no published fork snapshot, preview holds and preserves the profile; it does not invent a character or write growth to make the preview pass. A synthetic offline preview is available below.
6. **Later, only with intentional publication:** change the fork workflow to `contents: write` and `dry-run: 'false'` to publish growth. The first published faction is permanent; later runs leave faction/confirmation empty. An incomplete first analysis may reserve a pending faction, not zero XP or a successful class.
7. **Separately, only with intentional profile publication:** change the profile sync workflow to `contents: write` and `dry-run: 'false'`. It updates only the README block using the profile's own basic token. It never computes XP or writes the fork. Keep all execution manual until you explicitly decide otherwise.

The fork previews its own checked-out Action code; stored inputs are still read from a fixed Git head. The profile executes only reviewed pinned renderer code, never code from display data. Both use Node.js 24 and pinned dependencies with lifecycle scripts disabled. The fork token writes only its fork; the profile token writes only its profile. [GitHub tokens are repository-scoped](https://docs.github.com/en/actions/concepts/security/github_token). Branch protection/rulesets may reject writes; there is no PAT or weaker-write fallback. Inputs/logs in public repositories may be public.

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

Original programmatic pixels and bitmap lettering provide 530 distinct appearance projections, not hand-painted assets. No external font, game asset or AI concept sheet is distributed. Future rights-cleared character images follow planned CC BY 4.0; AI image rights must be checked **before** redistribution. Selected OFL 1.1 fonts retain original notices. Code licensing does not license user profiles or growth data under MIT.
