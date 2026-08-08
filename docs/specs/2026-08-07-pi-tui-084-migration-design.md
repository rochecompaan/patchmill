# Pi 0.84 pi-tui migration design

Issue: #144 — Pi 0.84 removes TUI class export: migrate Patchmill consumers to
unblock the nightly dependency upgrade.

## Problem

The nightly Pi dependency upgrade workflow fails when bumping
`@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` from 0.83.0 to
0.84.1. In pi-tui 0.84, the `TUI` class was removed from the package's value
exports; `TUI` is now a type-only interface. The former inline-screen class
lives on as `TuiMainScreen`, alongside a new fullscreen `TuiAltScreen`. Both
extend an abstract `TuiBase` whose constructor is unchanged:
`(terminal, showHardwareCursor?, logDirectory?)`.

Four Patchmill modules import `TUI` as a value:

- `pi-auth-dialog.ts`, `pi-auth-selector.ts`, and `pi-model-selector.ts`
  instantiate it with `new TUI(terminal, ...)`.
- `extensions/todos.ts` uses `TUI` only in type positions but does not mark the
  import as type-only. With verbatim ESM imports, Node still requests the
  missing runtime export.

Under 0.84.1, test files that load these modules fail at module load:

```text
SyntaxError: The requested module '@earendil-works/pi-tui' does not provide an export named 'TUI'
```

Evidence: failed run 31154881630 (2026-08-07), step "Update Pi dependency
metadata". The Nix build's test phase failed both the init tests and
`test-support/todos-extension.test.ts`.

The workflow currently calls `update-pi-deps.mjs` without `--skip-nix-hash`.
That script invokes `scripts/update-npm-deps-hash.sh`, which starts the Nix
build before the workflow reaches its Pi compatibility contract. The proposed
contract would therefore not fail fast unless the workflow order also changes.

A later Nix-hash or build failure does not roll back metadata. The updater's
inner metadata operation restores package files only when that operation itself
fails; its outer catch records changed files but does not restore them. The hash
helper can also leave `nix/package.nix` changed if its final build fails after
writing a discovered hash. CI discards its failed checkout, but a local run can
retain a partial update.

## Goal

Land the pi-tui 0.84.1 upgrade with all required code migrations in one atomic
change, make future missing pi-tui exports fail at the workflow's contract step
before any Nix build, and keep the nightly upgrade workflow able to update and
verify `npmDepsHash` after the fast checks pass.

## Non-goals

- Adopting `TuiAltScreen` or changing selector UX. `TuiMainScreen` (mode
  `"regular"`) is the behavioral equivalent of the removed class.
- A version-tolerant factory that supports both 0.83 and 0.84. Pins are exact
  and the swap is atomic, so dual-version support is dead weight.
- Runtime assertions for type-only imports (`Focusable`, `SelectItem`,
  `Terminal`, `TUI`). Type-only symbols cannot be checked at runtime.
- Adding a test that merely asserts workflow YAML text. Verify the workflow
  change with formatting, existing updater tests, and the real CI run instead.
- Cutting a release on merge. The squash-merge commit uses
  `chore(deps): update Pi runtime packages to 0.84.1`, matching prior upgrade
  PRs; 0.84.1 ships to npm users with the next feat/fix release. Published
  patchmill 0.19.0 pins pi-tui 0.83.0 exactly, so installs are unaffected today.

## Design

### Code migration

The three init modules replace the value import `TUI` with `TuiMainScreen`.
`pi-auth-dialog.ts` and `pi-auth-selector.ts` retain their `tui: TUI` type
annotations through a `type TUI` import. Constructor calls keep their current
arguments. `pi-model-selector.ts` does not use `TUI` as a type and drops it
entirely.

`extensions/todos.ts` does not construct a TUI. It changes `TUI` to `type TUI`
in its existing pi-tui import so Node no longer requests the removed runtime
export.

| File                                         | Migration                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `src/cli/commands/init/pi-auth-dialog.ts`    | `TuiMainScreen` at constructor calls 130 and 174; `type TUI` for `stopTui` |
| `src/cli/commands/init/pi-auth-selector.ts`  | `TuiMainScreen` at constructor calls 163 and 190; `type TUI` for `stopTui` |
| `src/cli/commands/init/pi-model-selector.ts` | `TuiMainScreen` at constructor call 130; remove `TUI`                      |
| `extensions/todos.ts`                        | Change the value import `TUI` to `type TUI`; no constructor change         |

The three init test files import only `type Terminal` and need no edits.
`test-support/todos-extension.test.ts` already imports and registers the bundled
extension, so it remains the direct runtime-load check for the extension.

### Contract test extension

Add a sibling test to `src/cli/commands/init/pi-dependency-contract.test.ts`
that namespace-imports `@earendil-works/pi-tui` and asserts every pi-tui value
export used by the init code or bundled todos extension is present and defined:

- Existing init values: `TuiMainScreen`, `Container`, `Input`, `Key`,
  `matchesKey`, `ProcessTerminal`, `Text`, `TruncatedText`, `getKeybindings`.
- Extension-only values: `Markdown`, `SelectList`, `Spacer`, `fuzzyMatch`,
  `truncateToWidth`, `visibleWidth`.

The namespace-import-plus-`in` pattern turns a missing export into a clear
assertion failure instead of an import-time crash. The test passes the Testing
Value Gate: it asserts an external API contract, fails for a meaningful
regression, and is cheap to maintain.

### Upgrade workflow ordering

Change `.github/workflows/pi-dependency-upgrade.yml` so no Nix build starts
before the contract and Node tests:

1. Always include `--skip-nix-hash` in the updater's argument list.
2. Reinstall updated dependencies.
3. Run the Pi compatibility contract.
4. Run Node tests, packed-artifact smoke test, and lint.
5. Run a new `Update Nix npm dependency hash` step that accepts the expected
   `nix/package.nix` change from `scripts/update-npm-deps-hash.sh`.
6. Keep a separate idempotency step: copy the updated `nix/package.nix`, rerun
   the helper, and fail explicitly if the file changes again.
7. Build `.#patchmill`.
8. Run `nix flake check --accept-flake-config --print-build-logs`.
9. Render and create the upgrade pull request.

The existing PR `add-paths` already includes `nix/package.nix`, so the hash
change created after the contract test is included in the automated PR. Update
the updater summary's `validationCommands` list with the full flake check so
generated PR bodies report the same evidence CI runs.

### Local bump sequencing and recovery

Neither intermediate source state is valid: migrated code cannot run against
pi-tui 0.83.0 (`TuiMainScreen` missing), and bumped pins cannot run against
unmigrated code (`TUI` missing). Apply the local change in this order:

1. Run
   `node scripts/update-pi-deps.mjs --mode manual --target-version 0.84.1 --skip-nix-hash`.
2. Reinstall with `npm ci`.
3. Migrate the three init modules and bundled todos extension.
4. Extend and run the contract test, then run the focused init and extension
   tests.
5. Run the full Node-side verification set.
6. Run `scripts/update-npm-deps-hash.sh` to refresh `nix/package.nix` after the
   fast checks pass.
7. Verify hash idempotency, build `.#patchmill`, and run the full flake check.

After any failed local updater or hash-helper invocation, inspect
`.tmp/pi-deps-summary.json` and `git status --short`; do not assume rollback.
The implementer may continue from the recorded changes after fixing the failure.
To abandon the partial bump, restore only the automation-managed files and
reinstall the original pins:

```bash
git restore -- package.json package-lock.json npm-shrinkwrap.json nix/package.nix
npm ci
```

Source migrations and contract-test edits are not part of this recovery command
and must be reviewed separately before restoration.

## Error handling

No new runtime error paths; the source migration changes imports only. The
workflow now prevents an upstream API removal from entering a Nix build before
its explicit contract runs. CI failures leave only an ephemeral checkout. The
local recovery procedure above handles the updater's non-transactional outer
failure path and the hash helper's possible partial write.

## Verification

- `node --test src/cli/commands/init/pi-dependency-contract.test.ts`
- `node --test src/cli/commands/init/pi-model-selector.test.ts test-support/todos-extension.test.ts`
- `npm test`
- `node scripts/smoke-packed-artifact.mjs`
- `npm run lint`
- After the refreshed `npmDepsHash` is committed, a fail-fast re-run of
  `scripts/update-npm-deps-hash.sh` must leave `nix/package.nix` unchanged.
- `nix build .#patchmill --print-build-logs`
- `nix flake check --accept-flake-config --print-build-logs`
- Pull-request CI must pass the reordered upgrade and package checks.
- After merge, wait for the next scheduled Pi dependency upgrade run, verify its
  creation time is after the merge, and require a successful conclusion. If
  0.84.1 is still latest, logs must contain `No Pi dependency update available`;
  if a newer version exists, the create-or-update-PR step must succeed. Do not
  use a blank or targeted manual dispatch as a substitute for scheduled-mode
  recovery.

## Chosen approach and alternatives

Chosen: direct migration to `TuiMainScreen` for constructors, type-only `TUI`
where only the interface is needed, a complete runtime-export contract, and a
workflow reorder that defers Nix work until after fast checks. Rejected
alternatives are a version-tolerant `createTui()` factory (YAGNI under exact
pins and an atomic swap) and reworking selectors onto `TuiAltScreen` (UX change
and scope creep).
