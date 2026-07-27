# Pi dependency upgrade lock integrity design

## Context

The scheduled `pi-dependency-upgrade.yml` workflow fails while updating Pi from
`0.80.10` to `0.82.1`. npm copies three nested Pi package entries from the
`@earendil-works/pi-coding-agent` tarball's embedded shrinkwrap into Patchmill's
`package-lock.json` and `npm-shrinkwrap.json`. Those entries contain registry
`resolved` URLs but omit `integrity` values. Nix's npm dependency fetcher
version 2 rejects such non-git entries before it can calculate a new
`npmDepsHash`.

Repairing those three integrity fields exposes a second failure: the
Git-independent update CLI test hard-codes `0.80.10`, so it fails whenever the
repository metadata has been upgraded.

## Goals

- Let automated Pi upgrades produce lockfiles accepted by Nix.
- Derive integrity from the exact tarball URL recorded in each lockfile.
- Avoid overwriting integrity values already supplied by npm.
- Keep network failures and unsupported lockfile entries actionable.
- Keep update CLI tests independent of the currently pinned Pi version.

## Non-goals

- Changing the selected Pi upgrade target.
- Downgrading Nix's npm dependency fetcher.
- Modifying published Pi packages or their embedded shrinkwrap.
- Committing the `0.82.1` dependency upgrade as part of this fix.

## Design

### Lockfile integrity repair

Add a focused `scripts/lockfile-integrity.mjs` module. It will accept the parsed
lockfiles and a fetch implementation, identify entries that:

- are not the lockfile root;
- are not links;
- have a version and a `resolved` value;
- are not git dependencies; and
- have no `integrity` value.

For each unique `http:` or `https:` resolved URL, the module will fetch the
exact tarball bytes and compute an SHA-512 Subresource Integrity value in the
form `sha512-<base64>`. A shared URL cache will ensure equivalent entries across
`package-lock.json` and `npm-shrinkwrap.json` are downloaded once. The resulting
integrity value will be assigned to every matching entry. Existing integrity
values will remain unchanged.

The repair will fail rather than guess when a missing-integrity entry uses an
unsupported non-git URL. Failed HTTP responses will report the lockfile label,
package path, URL, and status. This keeps errors attributable to the exact
metadata entry that prevented the upgrade.

### Upgrade flow integration

After `update-pi-deps.mjs` regenerates both lockfiles and before Prettier
formats them, it will:

1. read `package-lock.json` and `npm-shrinkwrap.json`;
2. repair missing registry integrity values through the new module;
3. write both lockfiles; and
4. continue with existing formatting, target validation, Nix hash regeneration,
   and compatibility checks.

The existing metadata restoration path will continue restoring all three npm
metadata files if lockfile regeneration or integrity repair fails.

### Version-independent CLI test

The `update CLI works without Git on PATH` test will read the current root Pi
pins from `package.json` and pass them as the manual validation targets. It will
no longer encode a historical version. This preserves the test's purpose—proving
that validation does not require Git—across dependency upgrades.

## Testing

Unit tests for the integrity module will prove that it:

- repairs a missing registry integrity value from fetched tarball bytes;
- fetches a shared resolved URL only once across both lockfiles;
- preserves existing integrity values without fetching;
- ignores git-resolved entries; and
- reports actionable errors for unsupported URLs and failed downloads.

The existing whole-file
`npm-shrinkwrap records integrity for non-git dependencies` test remains the
repository-level regression guard. The CLI test will cover dynamic target
selection.

Verification will run targeted tests first, then the full Node test suite, lint,
packed-artifact smoke test, npm install/build integration, and the Nix build. A
local manual upgrade to Pi `0.82.1` will exercise lockfile generation, integrity
repair, npm dependency hash regeneration, and all workflow validation steps.
Generated `0.82.1` metadata will be restored afterward so this branch contains
only the workflow fix.
