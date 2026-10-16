# Commit identity correction — 2026-10-16

The owner explicitly authorized correcting work-account author/committer metadata to the personal **JEONTAK** identity and updating the affected installation pins. This is a Git history correction, not a new growth analysis, reset or runtime release.

Fourteen commits have corrected identities: six in the product, two in the bound author installation, and six in the owner's profile. Two later profile bot commits also receive new hashes because their parent hashes changed. Bot/contributor identities, original author/committer timestamps, commit messages and every original commit's file tree are preserved. Invalidated signatures on the two rewritten bot descendants cannot be retained as valid signatures.

## Active immutable references

| Reference | Previous commit | Corrected commit |
| --- | --- | --- |
| Six-row profile renderer | `72e2a0a0f6f9cac2bf78fface9e1d5ecea719c15` | `6e507b17f0eaafaa81f4eef6df83404df72a684a` |
| Bound author's read-only preview | `603760d17a48db6bdec36db62e433f1e08f6a9ce` | `92d5175c0963e9b6178ac920a9b1b8673fabb3e4` |
| Saved author portrait snapshot | `36d4026a04c05da43e72f1d3db72f92efc880eb7` | `c19303f41cc8e3d8c31358154f45394bbee2ab57` |

Each pair has the same Git tree. The profile portrait URL changes only its commit component; the PNG and the four other saved character/growth/display files remain byte-for-byte unchanged. The older `b4a8bba2d418021ea94a355eccbb8baf2c5861ad` diagnostic pin is unaffected and is not upgraded by this correction.

The product README, bound author preview, profile renderer pin and existing profile portrait URL are updated intentionally. Workflow triggers, permissions, dry-run values, inputs, concurrency, original configuration and the unrelated profile schedule stay unchanged. No Action is dispatched as part of this operation.

## Existing copies and evidence

- Repository IDs, owners, faction, class, XP, analysis dates and deduplication facts are not rebound or recalculated. Saved source-activity hashes are not rewritten.
- Previous Actions run links and historical verification notes retain their original commit IDs. They describe the original execution, not a live check of the corrected commits.
- Complete pre-correction history bundles and full old-to-new commit maps are retained privately in the owner's local toy workspace. No public backup branch/tag is created.
- A force push changes current branch history; it does not guarantee removal of old commit URLs, caches, other forks or existing clones.
- Existing personal clones must reconcile the rewritten history before pushing. Preserve local changes first; a separate fresh checkout is safer than blindly merging divergent history. Do not force-push other users' forks, delete their records or reset a saved character to follow this source correction.

This change does not enable automatic operation, establish other-user live installation/recovery proof, or clear the existing artwork rights/release gates.
