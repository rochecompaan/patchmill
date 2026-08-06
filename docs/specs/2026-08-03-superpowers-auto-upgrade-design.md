# Superpowers Auto-Upgrade Design

## Summary

Patchmill will add a dedicated daily GitHub Actions workflow that discovers new
stable Superpowers releases, updates the pinned GitHub tarball dependency and
all related skill-pack metadata, validates the resulting package and Nix
integration, and opens a review-gated Superpowers-only pull request.

The pull request will embed the upstream release notes for every intervening
release so reviewers can evaluate the complete change from the current pin to
the proposed target.

## Goals

- Upgrade `obra/superpowers` independently from Pi runtime dependencies.
- Open a separate pull request for each proposed Superpowers target.
- Keep every live Superpowers version reference synchronized.
- Regenerate Patchmill's checked-in project-local Superpowers skills and
  metadata from the newly installed package.
- Include complete upstream release notes for every release after the current
  pin through the target release.
- Fail before opening a pull request when dependency metadata, release notes,
  required skill files, tests, packaging, or Nix validation are incomplete.
- Support scheduled discovery, explicit manual targets, and non-mutating
  validation runs.

## Non-goals

- Generalizing the existing Pi dependency updater into a universal dependency
  framework.
- Combining Pi and Superpowers changes in one pull request.
- Automatically merging or publishing dependency upgrades.
- Including draft or prerelease Superpowers versions.
- Automatically changing Patchmill's selected set of Superpowers skills when
  upstream adds or removes skills.

## Workflow Boundary

Add `.github/workflows/superpowers-upgrade.yml`. The existing Pi dependency
workflow and updater remain unchanged.

The dedicated workflow owns:

- Superpowers release discovery;
- Superpowers dependency and skill-pack synchronization;
- release-note collection and rendering;
- Superpowers-specific pull-request identity;
- compatibility and packaging validation for the resulting change.

The workflow runs daily on a schedule offset from the Pi dependency workflow. It
also supports `workflow_dispatch` inputs:

- `superpowers-version`: an optional explicit stable version;
- `validate-only`: resolve and validate without changing files or opening a pull
  request.

Scheduled runs select the latest stable GitHub release. Manual runs use the
explicit version when supplied and otherwise resolve the latest stable release.

## Components

### Dedicated updater

Add `scripts/update-superpowers.mjs` with a supporting testable library, such as
`scripts/superpowers-upgrade-lib.mjs`.

The library owns pure or dependency-injected behavior:

- parsing and formatting semantic versions and `v`-prefixed tags;
- parsing the current version from Patchmill's canonical GitHub tarball
  dependency;
- constructing the canonical tarball URL;
- selecting releases in the upgrade range;
- validating release metadata and release-note bodies;
- validating package and lockfile consistency;
- rendering the Superpowers pull-request body.

The CLI owns filesystem mutation, command execution, summary-file output, and
restoration after failures.

### GitHub release source

The updater queries GitHub Releases for `obra/superpowers` using the workflow's
standard GitHub token. Discovery excludes draft and prerelease entries.

The current dependency remains in canonical form:

```text
https://github.com/obra/superpowers/archive/refs/tags/vX.Y.Z.tar.gz
```

A malformed current dependency, malformed target tag, missing target release, or
target whose package version does not match its tag is a hard failure.

### Pull-request creation

The workflow mints the existing automation GitHub App token only after all
validation passes. It then creates or updates a branch named for the Superpowers
target, for example:

```text
automation/superpowers-v6.2.0
```

The pull-request title and commit subject use Superpowers-specific wording, for
example:

```text
chore(deps): update Superpowers to v6.2.0
```

The pull request remains review-gated and does not auto-merge or publish.

## Upgrade Data Flow

1. Check out the repository without persisting credentials.
2. Set up Node.js and install the current dependency graph with `npm ci`.
3. Install Nix with flakes enabled.
4. Read and validate the current Superpowers tarball pin from `package.json`.
5. Fetch the target stable GitHub release and all releases in the upgrade range.
6. Exit successfully without mutation when the target is not newer than the
   current pin.
7. Update `package.json` to the target tarball URL.
8. Regenerate `package-lock.json` and `npm-shrinkwrap.json` using the
   repository's existing lockfile-integrity safeguards.
9. Synchronize the target tag and tarball URL into `src/workflow/skill-pack.ts`
   and `THIRD_PARTY_NOTICES.md`.
10. Reinstall the target dependency graph with `npm ci`.
11. Run `patchmill skills update` to copy configured upstream skills into
    `.patchmill/skills` and regenerate `patchmill-skill-pack.json` with current
    hashes and source metadata.
12. Refresh `nix/package.nix` with `scripts/update-npm-deps-hash.sh`.
13. Run all validation commands.
14. Render the pull-request body from the validated summary and collected
    release metadata.
15. Mint the automation App token and create or update the dedicated pull
    request.

Local updater execution restores files it changed if mutation or validation
performed inside the updater fails. GitHub Actions failures leave no pull
request because token creation and pull-request creation occur last.

## Synchronized Files

A real Superpowers upgrade may change:

- `package.json`;
- `package-lock.json`;
- `npm-shrinkwrap.json`;
- `nix/package.nix`;
- `src/workflow/skill-pack.ts`;
- `THIRD_PARTY_NOTICES.md`;
- `.patchmill/skills/patchmill-skill-pack.json`;
- configured Superpowers directories under `.patchmill/skills`.

The updater's changed-file summary and `create-pull-request` pathspecs must
include additions, modifications, and removals under `.patchmill/skills` without
relying on Git being available to the updater.

Historical references in changelogs, completed plans, and completed
specifications are not rewritten.

## Skill-Pack Consistency

`package.json` is the canonical installed dependency pin. Before completion, the
workflow verifies that:

- `package.json` names the target canonical tarball URL;
- both lockfiles name the same root dependency URL;
- both lockfiles resolve `node_modules/superpowers` to the target package
  version and target tarball;
- `PATCHMILL_RECOMMENDED_SKILL_PACK.source` names the same repository, tag, and
  tarball URL;
- `THIRD_PARTY_NOTICES.md` links to the same upstream tag;
- checked-in project-local skill-pack metadata names the same source;
- every configured `source: "superpowers"` skill exists under
  `node_modules/superpowers/skills/<name>/SKILL.md`;
- project-local managed files and their recorded hashes match the newly
  installed source.

Upstream additions do not automatically enter Patchmill's recommended pack. An
upstream removal or rename of a configured skill fails the upgrade for human
review.

## Release Notes

For a change from `v6.0.3` to `v6.2.0`, the pull request includes the release
bodies for `v6.1.0`, `v6.1.1`, and `v6.2.0` in ascending chronological/version
order.

Each section contains:

- the release tag;
- publication date;
- a link to the GitHub release;
- the upstream release body, preserving its Markdown.

The current pinned release is excluded. Drafts, prereleases, releases at or
below the current pin, and releases above the target are excluded.

Release discovery handles GitHub API pagination rather than assuming the
complete range fits on one response page. The workflow fails instead of opening
an incomplete pull request when:

- an expected stable release in the version range cannot be fetched;
- a release has no non-whitespace release-note body;
- release tags are malformed or ambiguous;
- the explicit manual target does not identify a stable release.

The pull-request body also lists changed files, validation commands, and the
current and target versions.

## Error Handling

The workflow fails before pull-request creation for:

- GitHub API authentication, rate-limit, or pagination failures;
- malformed dependency specifications or release tags;
- missing or empty release notes;
- npm lockfile generation or integrity failures;
- inconsistent version references;
- missing configured upstream skill files;
- refusal by `patchmill skills update` to overwrite customized or unmanaged
  project-local files;
- stale Nix npm dependency hashes;
- test, lint, packed-artifact, or Nix build failures.

Error messages identify the affected release, package, path, expected value, and
actual value where applicable. Summary JSON is written on both success and
failure so workflow logs retain actionable context.

## Validation

A proposed upgrade runs:

```bash
npm ci
node --test src/cli/commands/init/pi-dependency-contract.test.ts
npm test
node scripts/smoke-packed-artifact.mjs
npm run lint
scripts/update-npm-deps-hash.sh
nix build .#patchmill --print-build-logs
```

The existing Pi compatibility contract remains because Superpowers is consumed
through Patchmill's Pi-facing skill installation and execution paths. The full
npm suite covers skill installation, skill-pack updates, resolution, and
packaged behavior.

After refreshing the Nix hash, the workflow runs the hash updater a second time
and fails if it changes `nix/package.nix`, proving the committed hash is
current.

## Testing Strategy

Automated tests cover reusable and regression-prone behavior:

- current tarball version parsing;
- canonical target URL construction;
- GitHub release pagination and filtering;
- stable upgrade-range selection and ordering;
- scheduled, manual, validate-only, and no-update modes;
- malformed, missing, draft, and prerelease targets;
- missing release-note bodies;
- package and lockfile URL/version consistency;
- synchronized skill-pack source metadata;
- required upstream skill path checks;
- pull-request rendering with every intervening release body;
- failure summaries and restoration after partial mutation.

Existing fixed-version assertions in `src/workflow/skill-pack.test.ts` become
consistency assertions against the canonical package pin, preventing future
upgrades from passing by changing an expectation alongside the implementation.

No new test will assert static GitHub Actions YAML content. Workflow structure
is verified directly with the repository's available workflow/YAML tooling and a
manual `validate-only` dispatch or equivalent local updater invocation.

## Documentation

Update the dependency-upgrade documentation to describe:

- the independent Pi and Superpowers workflows;
- scheduled and manual Superpowers runs;
- release-note range behavior;
- required GitHub App credentials;
- local validation commands;
- the review-gated, non-auto-merge policy.

## Acceptance Criteria

- A daily scheduled run detects a newer stable Superpowers release independently
  of Pi versions.
- A Superpowers-only branch and pull request are created after successful
  validation.
- The pull request embeds non-empty release notes for every stable release after
  the current pin through the target.
- All package, lockfile, Nix, notice, skill-pack source, project-local metadata,
  and skill-file references agree on the target release.
- Missing notes, missing configured skills, inconsistent metadata, or failed
  validation prevent pull-request creation.
- No-update and validate-only runs create no branch or pull request.
- The Pi dependency workflow remains behaviorally unchanged.
