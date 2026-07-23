# Pi Dependency Upgrades

Patchmill keeps `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`
on exact pins. The `Pi dependency upgrade` workflow discovers matching newer npm
`latest` versions on a schedule and opens a review-gated PR after compatibility,
packed-artifact, npm, and Nix validation pass.

## Manual validation

```bash
node scripts/update-pi-deps.mjs \
  --mode manual \
  --target-version 0.80.10 \
  --validate-only \
  --skip-nix-hash \
  --summary-json .tmp/pi-deps-summary.json
```

Omit `--skip-nix-hash` when preparing real dependency changes.

## Repository automation token

Configure the repository secret `PATCHMILL_AUTOMATION_TOKEN` with a fine-grained
personal access token for a dedicated automation account that can create
branches and pull requests. The workflow uses it only after all upgrade
validations pass, so the resulting review-gated PR can trigger normal pull
request checks; GitHub Actions' default `GITHUB_TOKEN` does not trigger those
workflows. Checkout does not persist this token while dependency validation
runs.

## Required local checks for a real upgrade

```bash
node --test src/cli/commands/init/pi-dependency-contract.test.ts
npm test
node scripts/smoke-packed-artifact.mjs
npm run lint
scripts/update-npm-deps-hash.sh
nix build .#patchmill --print-build-logs
```

The workflow does not auto-merge or publish Pi dependency upgrades.
