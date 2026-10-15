# Commitkin

Your GitHub activity. Your evolving pixel character.

An open-source, user-owned GitHub Action that turns observed public activity into a chunky pixel character on your profile README. No separate signup, hosted backend or personal access token.

## Status

MVP implementation / pre-release validation. Class, trait, achievement, growth, rendering, collection and opt-in publication paths are implemented. Publication/recovery are covered by injected-HTTP tests; **a real profile growth write has not been performed**. Default mode is read-only. No release tag or automatic character workflow is enabled in this product repository.

The [initial diagnostic run](https://github.com/JEONTAK/commitkin/actions/runs/38712379879) passed 773 then-current tests and a real basic-token known-scope read probe. Later source changes need separate validation. A green diagnostic is not proof of every endpoint, complete discoverability, live installation or publication.

## How it works

- Choose **Bloomguard**, a cozy fantasy guild, or **Ashbound**, a dark fantasy order. First published choice is permanent.
- Public commits, merged PRs, reviews, documentation, tests, bug-recovery signals, releases and qualifying issue operations shape 25 classes, 12 traits and 36 achievement tiers.
- Regular-class appearance grows at five-level milestones through 50; numeric levels continue. Adventurer is a fixed starter until a clear activity pattern is established.
- Daily analysis uses completed UTC days: 90-day class window, 30-day traits, original-date XP settlement and 100 XP daily cap. This reflects observed contribution style, **not skill, seniority or productivity**.
- Minimal records live in your own public profile repository. This product repository is not central storage for user records.

Confirmed `observed-api-v1` uses current default-branch reachability plus Git committed date for direct commits, `published_at` plus currently public/normal release state, and current exact `bug` labels at first eligible analysis. It does not reconstruct first push, original release lifecycle or merge-time labels. Accepted facts/XP remain when mutable metadata later changes.

Automatic discovery is best-effort, supplemented by explicit repositories. Known required collection failures hold the whole analysis and preserve the last valid character; missing data is not inactivity. Bounded request/file limits may require narrowing scope. See [runtime details](packages/commitkin/README.md).

## Installation

This pre-release guide is opt-in, **not permission to write records on behalf of another user**.

1. Use your public personal profile repository `YOUR_LOGIN/YOUR_LOGIN`, with default-branch `README.md`. Organization/product repositories are rejected.
2. Add exactly one region yourself; Commitkin preserves bytes outside it:

```md
<!-- COMMITKIN:START -->
<!-- COMMITKIN:END -->
```

3. Add a manual-only workflow based on [examples/commitkin.yml](examples/commitkin.yml). Replace its placeholder with a reviewed **full 40-character source commit SHA** containing `action.yml`; no `@v1` release tag exists.
4. Preview manually with `dry-run` true, your faction and `CONFIRM_PERMANENT_FACTION`. Preview constructs no publisher and saves nothing. Inputs/logs in a public repository can be public.
5. Only if you intentionally want public records, grant that job `contents: write` and explicitly set `dry-run` false. First publication permanently binds the faction. An incomplete first analysis may publish only a confirmed pending faction, with null XP/class/evaluation; this is not successful analysis.
6. After first publication, leave faction/confirmation empty. Add a schedule only after reviewing your own successful installation. Use a non-round UTC minute and concurrency with `cancel-in-progress: false`. No schedule is needed for preview.

The Action uses Node.js 24 and pinned dependencies with lifecycle scripts disabled. No working-tree checkout is required: profile inputs come from a fixed Git head. Intended public reads use the basic repository-scoped `GITHUB_TOKEN` with `contents: read`. **Publishing your five files needs `contents: write`**. Branch protection/rulesets may still reject publication; Commitkin does not bypass them or fall back to a PAT.

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

Only these five paths publish together:

```text
.commitkin/state.json
.commitkin/ledger.json
.commitkin/status.json
.commitkin/card.png
README.md                 # one managed region only
```

IDs, dates, aggregates and hashes are public. Hashes are not encryption or anonymity. No raw activity content, file contents, titles/bodies, emails, participant lists or credentials are archived. Keep Git history for recovery. Same-date no-ops do not rewrite files or claim new successful freshness.

## Recovery

- `hold`: required proof is missing, inaccessible, over budget or contradictory. Preserve the character; inspect the bounded code and resolve the cause.
- `Analysis pending`: faction confirmed, growth unknown. Retry without faction/confirmation; do not delete files or treat unknown XP as zero.
- Missing/corrupt/mismatched records: restore **all three JSON files from one valid same-owner commit/backup**, keeping matched revisions. Do not mix snapshots, reset XP, reselect faction or revert unrelated files.
- Competing publication: expected-head compare-and-swap rejects a changed branch. Read authoritative state before retrying; ambiguous writes are never blindly replayed.
- Uninstall: disable/remove the workflow and optionally the managed block, retaining `.commitkin` and its history. No automatic expiry/deletion; history redaction is a separate explicit user operation.

Rewritten-away user-managed history cannot always be detected. Old uncollected periods remain explicit gaps, not inactivity or guaranteed recoverable history. Required failures never advance successful freshness or growth observations.

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
