# Automate Pi dependency upgrade PRs with compatibility validation

## Summary

Patchmill should automate review-gated upgrade PRs for its tightly coupled Pi
runtime dependencies, `@earendil-works/pi-coding-agent` and
`@earendil-works/pi-tui`, while preserving exact pins and the compatibility
boundary established by the Pi `0.80.10` upgrade.

The automation will discover newer Pi package versions, update all generated
package metadata consistently, refresh the Nix npm dependency hash when needed,
and run the same compatibility and packed-artifact smoke checks that protect
published Patchmill releases. It will open or update a pull request for human
review; it will not auto-merge, publish, or bypass failing compatibility checks.

## Current state

- `package.json` pins both Pi runtime packages exactly at `0.80.10`.
- `package-lock.json` and `npm-shrinkwrap.json` publish the resolved dependency
  graph.
- `nix/package.nix` uses `buildNpmPackage` with an `npmDepsHash` maintained by
  `scripts/update-npm-deps-hash.sh`.
- CI already runs Node tests, linting, packed npm install smoke checks, Nix hash
  validation, and Nix install smoke checks.
- `src/cli/commands/init/pi-dependency-contract.test.ts` asserts the validated
  Pi version and the Pi runtime exports Patchmill depends on.

## Goals

- Scheduled and manual CI can prepare or validate a Pi dependency upgrade PR
  without hand-editing package metadata.
- Upgrade PRs update exact pins in `package.json`, resolved entries in
  `package-lock.json` and `npm-shrinkwrap.json`, and `nix/package.nix`
  `npmDepsHash` when the dependency graph changes.
- Upgrade PRs run Pi compatibility tests and packed-artifact smoke checks before
  review.
- Smoke checks run from a packed tarball and cover `patchmill --help`,
  `patchmill init`, installed skill presence, and resolved Pi package versions.
- Failures identify the package, target version, or Pi capability check that
  failed.
- The workflow remains review-gated: no auto-publish and no auto-merge.

## Non-goals

- Do not implement or redesign Patchmill's Pi compatibility boundary itself.
- Do not change upstream `@earendil-works/*` APIs or vendor upstream internals.
- Do not widen Pi dependency ranges; exact pins remain the release boundary.
- Do not add tests that only assert static workflow YAML or lockfile text.

## Design options considered

### Option A: Dependabot-only version PRs

Dependabot can detect npm updates and open PRs, but it will not know how to keep
Patchmill's `npm-shrinkwrap.json`, Nix `npmDepsHash`, compatibility assertions,
and packed-artifact smoke checks synchronized. This would still require manual
repair on every Pi upgrade.

### Option B: Scheduled GitHub Actions workflow with Patchmill-owned scripts

A scheduled/manual workflow runs repository scripts that discover the target Pi
versions, update package metadata, refresh the Nix hash, validate the result,
and create or update a PR branch. This keeps the repository-specific upgrade
contract in versioned code and makes failures actionable in CI logs.

### Option C: External release bot

An external bot could run the same logic outside GitHub Actions, but it would
add new credentials and operational surface area without improving validation.
The repository already has the needed CI, Nix, and PR automation primitives.

**Decision:** Use Option B. Keep the core logic in repository scripts so it can
run locally, under `workflow_dispatch`, on a schedule, and on PR validation.

## Proposed behavior

### Candidate discovery

Add a Patchmill-owned update script, for example `scripts/update-pi-deps.mjs`,
that accepts either explicit target versions or a discovery mode:

- Scheduled mode queries npm registry metadata for the `latest` dist-tag of both
  Pi packages.
- Manual mode accepts explicit package versions through workflow inputs for
  rollback or pre-release validation.
- Scheduled mode only prepares an upgrade when both packages have a newer shared
  `latest` version than the current exact pins. If latest versions diverge, the
  script exits non-zero before editing files and logs both package names and
  dist-tag versions.
- Manual mode may accept different explicit versions, but the PR body must call
  out the non-matching pair so reviewers can decide whether it is intentional.
- If no newer candidate exists, scheduled mode exits successfully without
  opening a PR.

The script should verify that the root `package.json` dependencies are exact
semver strings before proceeding. A range such as `^0.80.10` is an error because
it weakens Patchmill's compatibility boundary.

### Metadata update

The update script should codify the proven manual upgrade workflow:

1. Set `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` in
   `package.json` to exact target versions.
2. Regenerate `npm-shrinkwrap.json` and `package-lock.json` with npm in
   lockfile-only, ignore-scripts mode.
3. Format `package.json`, `package-lock.json`, and `npm-shrinkwrap.json` with
   Prettier.
4. Validate that root dependencies and each lockfile's `node_modules/<package>`
   entries resolve to the requested versions.
5. Run `scripts/update-npm-deps-hash.sh` after lockfile changes so
   `nix/package.nix` records the correct `npmDepsHash`.

The script should print a concise summary of changed files and target versions.
If npm cannot resolve either target version, the error should include the
package name and requested version.

### Compatibility assertions

Keep `src/cli/commands/init/pi-dependency-contract.test.ts` as the primary Pi
runtime boundary test, but make the expected version derive from the exact root
`package.json` pins instead of requiring a hand-edited constant on every
upgrade. The test should fail with messages such as:

- `@earendil-works/pi-coding-agent resolved 0.x.y but package.json pins 0.a.b`;
- `@earendil-works/pi-tui resolved 0.x.y but package.json pins 0.a.b`;
- `@earendil-works/pi-coding-agent must export ModelRuntime`.

This keeps version assertions tied to the PR's proposed pins while preserving
capability checks for Patchmill's current Pi SDK usage.

### Packed-artifact smoke script

Move the packed npm artifact smoke behavior into a reusable script, for example
`scripts/smoke-packed-artifact.mjs` or `scripts/smoke-packed-artifact.sh`, and
have CI call it. The script should:

1. run `npm pack --silent` from the repository;
2. install the tarball in a temporary npm project with isolated `HOME`,
   `XDG_CONFIG_HOME`, and npm cache;
3. run `./node_modules/.bin/patchmill --help`;
4. run `./node_modules/.bin/patchmill init` non-interactively in the temporary
   project;
5. assert an installed Patchmill skill file exists;
6. resolve `@earendil-works/pi-coding-agent/package.json` and
   `@earendil-works/pi-tui/package.json` from the installed package and compare
   their versions to the root package pins.

Version mismatch failures should include the package name, expected pin, actual
resolved version, and installed package path when available.

### GitHub Actions workflow

Add `.github/workflows/pi-dependency-upgrade.yml` with:

- `schedule`, for example weekly;
- `workflow_dispatch` with optional target versions and a validate-only mode;
- `permissions: contents: write, pull-requests: write` for PR creation;
- concurrency keyed to the Pi dependency upgrade branch.

The workflow should:

1. check out `main`;
2. set up Node 24 and run `npm ci`;
3. discover or accept target Pi versions;
4. run the update script;
5. stop successfully if there are no changes;
6. install Nix and run `scripts/update-npm-deps-hash.sh`;
7. run targeted Pi compatibility tests, full `npm test`, the packed-artifact
   smoke script, `npm run lint`, and `nix build .#patchmill --print-build-logs`;
8. create or update a branch such as `automation/pi-deps-<version>`;
9. open or update a PR with a generated body containing target versions, changed
   metadata files, and validation results.

The PR should have a clear title such as
`chore(deps): update Pi runtime packages to <version>` and should not request
release publication or auto-merge. If validation fails, the workflow should fail
without updating a successful PR body; logs remain the source of actionable
failure details.

### CI validation on upgrade PRs

Update the existing CI workflow to call the reusable packed-artifact smoke
script instead of duplicating shell logic. The normal PR checks will then
validate both manually opened and automation-created Pi upgrade PRs.

The Nix job should continue to run `scripts/update-npm-deps-hash.sh` and fail if
`nix/package.nix` changes, ensuring contributors cannot forget the hash update.

## Affected components

- New: Pi dependency update script under `scripts/`.
- New: reusable packed-artifact smoke script under `scripts/`.
- New: scheduled/manual workflow `.github/workflows/pi-dependency-upgrade.yml`.
- Modified: `.github/workflows/ci.yml` to call the reusable smoke script.
- Modified: `src/cli/commands/init/pi-dependency-contract.test.ts` to derive
  expected versions from exact root package pins.
- Modified during generated PRs: `package.json`, `package-lock.json`,
  `npm-shrinkwrap.json`, and `nix/package.nix` when the dependency graph
  changes.

## Error handling and logs

The scripts should prefer explicit validation errors over silent drift:

- no update available: log current and latest versions, exit 0;
- divergent scheduled latest versions: log both package versions, exit non-zero
  before editing;
- non-exact root pins: log the offending package and dependency spec;
- npm resolution failure: log package and requested target version;
- lockfile mismatch: log file, package, expected version, and actual version;
- Nix hash failure without a parseable mismatch: preserve and print the existing
  `scripts/update-npm-deps-hash.sh` diagnostic;
- compatibility failure: rely on the Pi contract test's package/export-specific
  assertion messages;
- packed smoke failure: log the command being run, package path, expected Pi
  versions, and actual resolved versions.

## Verification strategy

Implementation should use automated tests for reusable parsing and validation
logic because those checks prove behavior and can fail for meaningful future
regressions. It should avoid tests that merely duplicate workflow YAML.

Recommended verification for the implementation plan:

- unit-test the version discovery/update helpers with fixture package files and
  mocked npm metadata;
- unit-test exact-pin and lockfile-version validation failures;
- run the Pi dependency contract test:
  `node --test src/cli/commands/init/pi-dependency-contract.test.ts`;
- run full Node tests: `npm test`;
- run the packed-artifact smoke script from a local tarball;
- run lint: `npm run lint`;
- because npm metadata can change in generated PRs, run
  `scripts/update-npm-deps-hash.sh` and
  `nix build .#patchmill --print-build-logs`;
- manually dispatch the new workflow in validate-only mode before relying on the
  schedule.

## Rollout

1. Land the automation scripts and workflow without changing the current Pi
   versions.
2. Manually dispatch validate-only mode against the current pins to prove the
   workflow does not require an actual newer version.
3. Manually dispatch with explicit current versions or a harmless fixture path
   if supported by the implementation to exercise the no-op and validation
   paths.
4. Let the next scheduled run create a real upgrade PR when npm publishes newer
   compatible Pi packages.

## Security and review posture

The workflow should only use npm registry metadata and repository code. It must
not execute commands from issue or PR text. Generated PRs remain normal review
artifacts, and failing compatibility or smoke checks block merge through the
existing branch protection rather than through an auto-merge policy.
