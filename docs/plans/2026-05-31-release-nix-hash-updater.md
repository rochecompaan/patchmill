# Release Nix Hash Updater Implementation Plan

**Goal:** Keep release-please version bumps from merging with stale Nix npm
dependency hashes.

**Approach:** Add a same-repo release-please PR workflow that runs
`nix build .#patchmill`, parses fixed-output hash mismatches, updates
`nix/package.nix`, verifies the build, and commits the hash-only change back as
`chore(nix): update release npm deps hash`.

**Files:**

- Create `.github/workflows/update-release-nix-hash.yml`
- Modify `nix/package.nix` for the already-merged `0.2.1` hash mismatch

**Verification:**

- `nix build --print-build-logs .#patchmill`
- `npm run lint`
