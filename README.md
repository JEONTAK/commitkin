# Commitkin

Your GitHub activity. Your evolving pixel character.

Turn your public GitHub activity into an evolving pixel character on your profile README.

## Status

Pre-release local core and read-only integration validation. **Commitkin is not ready to install as a live character Action.**

The source now includes the offline class/trait/achievement and XP engines, strict record/evidence validation, original code-native pixel previews, safe managed README generation and bounded GitHub adapters. Synthetic local tests are not proof of a complete installed character. Trusted acquisition, some historical proof, production artwork and actual growth-record publication remain gated. This source repository is never central storage for users' growth records.

## Development source and validation

Start with [local core instructions](packages/commitkin/README.md) and [implementation status](docs/product/github-character/local-mvp-implementation.md). Both packages and root schemas/fixtures must remain together; the private package directories are not standalone npm releases.

```sh
npm --prefix packages/record-validator ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/commitkin ci --ignore-scripts --no-audit --no-fund
npm --prefix packages/record-validator test
npm --prefix packages/commitkin run test:coverage
node packages/commitkin/bin/commitkin.mjs demo --faction bloomguard --name first-demo
```

The demo writes only a new, explicitly fictional directory under `deliverables/commitkin-local-preview/`; it never writes a real owner's `.commitkin` records or contacts GitHub. Developer dependencies/output are local-only: do not commit `node_modules`, coverage or generated demo directories.

The [Read-only core validation](.github/workflows/core-validation.yml) workflow is manual-only, uses `contents: read`, runs pinned-dependency tests and fictional previews, then exercises the actual read-only adapter with the job's built-in `GITHUB_TOKEN`. It has no publisher, schedule, PAT, arbitrary target input or growth-record write step. A green run proves only the named tests/known-scope reads; it does not authenticate arbitrary JSON history or demonstrate full product installation.

## Planned experience

- A chunky pixel-art character shaped by observed public GitHub activity, not a rating of developer ability or productivity.
- 25 classes, including the Adventurer starter; 12 traits; levels and 36 achievement tiers.
- A permanent choice between Bloomguard, a cozy fantasy guild, and Ashbound, a dark fantasy order.
- Appearance upgrades at five-level milestones for regular classes, with a fixed starter appearance per faction.
- A user-owned workflow and minimum public growth record in the user's own profile repository, with no separate product signup or hosted backend.

The pure mechanics are implemented and locally tested; the complete installed experience is not shipped. This product source repository is separate from each user's profile repository and must not become central storage for user growth records.

## Read-only token probe

File: [`.github/workflows/token-probe.yml`](.github/workflows/token-probe.yml)

Purpose: check whether an actual GitHub Actions `GITHUB_TOKEN`, with only `contents: read`, can access representative public REST and GraphQL data needed for later collection design.

### Safety boundaries

- Manual `workflow_dispatch` only. No push, pull-request or scheduled triggers.
- Uses only the job's built-in `github.token`; no PAT, extra secrets or anonymous fallback.
- Makes read-only REST GET requests and fixed GraphQL queries. No GraphQL mutations.
- No checkout, dependency installation, third-party Actions, repository writes, artifacts, character state or README changes.
- Fixed GitHub.com API destination, rejected redirects, bounded requests and a five-minute job timeout.
- Logs only controlled result labels, HTTP status, allowlisted GraphQL error types and remaining rate quota. Never logs tokens, response payloads, activity content or raw errors.

The intended later runtime will need separate design and verification for writing its own profile repository. This probe does not request write access.

### What it checks

The probe reads its own repository metadata and a fixed external public fixture, `cli/cli` PR #14485: repository visibility, merged PR details, changed-file names, reviews, releases, issue events and commits. It also checks public merged-PR search for the supplied username and a small GraphQL contribution sample from the previous 90 completed UTC days.

The fixture belongs to its respective maintainers and is not affiliated with or endorsing Commitkin. Fixture availability and API behavior may change.

### Future manual verification

**Do not run this workflow as part of repository initialization.** A maintainer must separately approve the first execution. Once approved, select **Actions → Read-only GITHUB_TOKEN probe → Run workflow** and provide a public GitHub username, such as `JEONTAK`. Never enter credentials in that input.

Workflow inputs and logs can be public in this public repository. The probe intentionally does not publish raw activity data.

### Interpreting results

| Result | Meaning |
|---|---|
| `PASS` | Request succeeded and the expected sample shape was present. |
| `PASS_EMPTY` | Request succeeded with a valid empty collection; sample fields remain unproven. |
| `FAIL_HTTP` | HTTP request was rejected; this alone does not identify the cause. |
| `FAIL_GRAPHQL` | GraphQL returned errors, even if HTTP status was 200. |
| `NO_SAMPLE_OR_SCHEMA_MISMATCH` | Expected fixture/sample fields were missing; this is not proof of a permission failure. |
| `NETWORK_OR_RESPONSE_ERROR` | Network, timeout or response parsing failed. |
| `SKIP_RATE_LIMIT` | Remaining probes were skipped after rate exhaustion. |

Any result other than `PASS` or `PASS_EMPTY` makes the job unsuccessful. An empty account is not a collection failure and is not evidence of account-wide inactivity.

Even all passing probes do **not** prove complete 90-day coverage, pagination, every public repository's discoverability, release/triage attribution, rate-budget feasibility, write access or a working character engine. No private/internal activity or restricted contribution totals are part of the planned MVP.

## Licensing

Commitkin-owned code/README/workflows are licensed under MIT; retain the notices in each package and [LICENSE](LICENSE). Third-party dependencies, services and data retain their own terms.

No AI concept sheets or external image/font files are distributed here. The development renderer generates original code-native fallback pixels and bitmap lettering, not certified final artwork. Planned image licensing is CC BY 4.0 only after relevant rights are verified; AI-image rights verification remains a mandatory pre-distribution gate. Selected external fonts must retain their original OFL 1.1 notices. This does not license user profiles, activity or growth data under MIT.

### MIT License

Copyright (c) 2026 JEONTAK

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
