# Automated Dependency Upgrades

## Pi runtime upgrades

Patchmill keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
on exact pins. The `Pi dependency upgrade` workflow discovers matching newer npm
`latest` versions on a schedule and opens a review-gated PR after compatibility,
packed-artifact, npm, and Nix validation pass.

### Manual validation

```bash
node scripts/update-pi-deps.mjs \
  --mode manual \
  --target-version 0.80.10 \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/pi-deps-summary.json
```

Omit `--skip-nix-hash` when preparing real dependency changes.

## Superpowers upgrades

The `Superpowers dependency upgrade` workflow runs daily and opens a dedicated
review-gated pull request when `obra/superpowers` publishes a newer stable
GitHub Release. It does not combine Superpowers and Pi runtime changes.

The pull request includes the upstream release body for every stable release
after the current pin through the target, ordered from oldest to newest. Missing
or empty release notes prevent pull-request creation.

Run a non-mutating local validation with:

```bash
node scripts/update-superpowers.mjs \
  --mode manual \
  --superpowers-version 6.0.3 \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/superpowers-summary.json
```

Omit `--superpowers-version` to validate discovery of the latest stable release.
Omit `--validate-only` and `--skip-nix-hash` only when intentionally preparing a
real Superpowers upgrade.

## Repository automation credentials

Configure the repository secrets `RELEASE_PLEASE_BOT_APP_ID` and
`RELEASE_PLEASE_BOT_PRIVATE_KEY` for a GitHub App that can create branches and
pull requests. Both workflows mint a short-lived installation token only after
all upgrade validations pass, so the resulting review-gated PR can trigger
normal pull request checks; GitHub Actions' default `GITHUB_TOKEN` does not
trigger those workflows. Checkout does not persist credentials while dependency
validation runs.

## Required local checks for a real upgrade

```bash
node --test src/cli/commands/init/pi-dependency-contract.test.ts
npm test
node scripts/smoke-packed-artifact.mjs
npm run lint
scripts/update-npm-deps-hash.sh
nix build .#patchmill --print-build-logs
```

Neither workflow auto-merges or publishes dependency upgrades.
