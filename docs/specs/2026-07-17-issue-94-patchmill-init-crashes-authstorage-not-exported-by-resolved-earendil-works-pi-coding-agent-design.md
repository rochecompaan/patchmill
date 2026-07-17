# Issue 94 Patchmill init AuthStorage export compatibility design

## Context

Issue #94 reports that a fresh global install of `patchmill@0.16.0` can fail
before `patchmill init` starts because the resolved
`@earendil-works/pi-coding-agent` package does not export `AuthStorage`:

```text
SyntaxError: The requested module '@earendil-works/pi-coding-agent' does not provide an export named 'AuthStorage'
```

Patchmill's init path imports `AuthStorage` in two modules:

- `src/cli/commands/init/pi-preflight.ts`, which builds a Pi `ModelRegistry` for
  readiness detection.
- `src/cli/commands/init/pi-auth-flow.ts`, which creates repo-local auth storage
  and registry objects for interactive auth setup.

The current checkout already pins `@earendil-works/pi-coding-agent` and
`@earendil-works/pi-tui` exactly to `0.80.3` in both `package.json` and
`package-lock.json`. That version exports `AuthStorage`, so the immediate crash
is a dependency-resolution regression in the published `0.16.0` metadata that
allowed newer `0.80.x` Pi packages to satisfy Patchmill's dependency range.

## Decision

Fix this release line by making Patchmill's Pi package dependency contract
explicit and verified instead of migrating the init/auth code to the newer Pi
credential API in this issue.

Patchmill should continue using the `AuthStorage` + `ModelRegistry` API for the
current init implementation, and it must publish package metadata that prevents
npm from resolving a Pi version that removed `AuthStorage`. The implementation
should confirm the exact pins are present in the root package and lockfile, then
add regression coverage that fails if Patchmill's runtime dependency no longer
exports every Pi symbol imported by the init/auth path.

A later feature can migrate init/auth to `readStoredCredential` or other newer Pi
APIs, but that migration should be planned separately because `AuthStorage` is
also used for writes, OAuth login, provider selection state, and registry
construction. A dependency-contract fix is the lowest-risk high-priority bug fix
for the reported install-time crash.

## Goals

- A fresh install of the next Patchmill package cannot resolve a
  `pi-coding-agent` version that omits `AuthStorage` while Patchmill still
  imports it.
- `package.json` and `package-lock.json` enforce the same compatible
  `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` versions.
- Init/auth source continues to import only symbols that exist in the resolved Pi
  dependency.
- Add a regression test or verification script that would fail if
  `patchmill init` could import a missing Pi export.
- Preserve current init readiness detection, interactive API-key auth,
  subscription/OAuth auth, repo-local `.patchmill/pi-agent/auth.json`, and model
  selection behavior.

## Non-goals

- Do not migrate Patchmill init/auth to Pi `0.80.8+` credential APIs in this
  issue.
- Do not redesign Pi's auth storage, registry, OAuth, or model configuration
  behavior.
- Do not change user-facing init prompts except for any incidental wording from
  existing code paths.
- Do not add automated tests that merely assert static dependency strings. Use
  direct package metadata checks for static pins and behavioral/import tests for
  runtime compatibility.

## Proposed approaches considered

### Recommended: keep exact compatible Pi pins and test imported exports

Keep the exact Pi dependency pins and add a runtime export-compatibility
regression test. This directly addresses the reported crash, is small enough for
a high-priority patch, and avoids coupling this bug fix to a larger auth API
migration.

### Alternative: migrate to newer Pi credential APIs now

Updating init/auth to newer Pi APIs may be desirable later, but it is riskier for
this bug. The current code needs auth reads, writes, OAuth login, auth-status
labels, OAuth provider discovery, and model registry refreshes. The issue only
requires preventing incompatible install resolution, not changing those
semantics.

### Alternative: loosen the pin but add an upper bound

A semver range such as `<0.80.8` would also block the missing export, but exact
pins better match Patchmill's current package-lock state and reduce future
install-time drift for tightly coupled Pi internals.

## Affected components

### Package metadata

- `package.json` must use exact versions for:
  - `@earendil-works/pi-coding-agent`
  - `@earendil-works/pi-tui`
- `package-lock.json` must resolve those same exact versions at the root package
  and installed package entries.
- If either file changes, the Nix build must be rerun as required by project
  instructions.

### Init/auth modules

- `src/cli/commands/init/pi-preflight.ts` may continue constructing
  `AuthStorage.create(join(agentDir, "auth.json"))` and
  `ModelRegistry.create(auth, join(agentDir, "models.json"))`.
- `src/cli/commands/init/pi-auth-flow.ts` may continue constructing repo-local
  auth storage and registry objects with `AuthStorage` and `ModelRegistry`.
- Type-only imports such as `AuthCredential` and `AuthStatus` should remain
  type-only so runtime import validation focuses on actual runtime symbols.

### Regression coverage

Add coverage that imports the resolved `@earendil-works/pi-coding-agent` module
and verifies the runtime symbols Patchmill imports from it exist, including at
least:

- `AuthStorage`
- `ModelRegistry`
- `getAgentDir`

This test should live near the init/auth tests or another CLI dependency
contract test location. It should fail with the same class of problem as the
reported crash: Patchmill's source imports a runtime symbol that the resolved Pi
package does not export.

Optionally, a second lightweight packaging verification can run `npm pack --dry-run`
or inspect the generated package metadata to confirm the published package would
carry the exact pins. That should be verification, not a unit test that only
repeats static JSON values.

## Verification strategy

- Run the new Pi export-compatibility regression test.
- Run relevant init/auth tests, including:
  - `src/cli/commands/init/pi-preflight.test.ts`
  - `src/cli/commands/init/pi-auth-flow.test.ts`
  - any new dependency-contract test file.
- Run the standard test suite or at least the CLI/init subset selected by the
  implementation plan.
- Run `npm run build` so generated `dist` code reflects the source imports and
  package metadata.
- If dependency metadata changes, run the Nix build per `AGENTS.md`.
- Verify packaging metadata with `npm pack --dry-run` or equivalent so the next
  published tarball cannot reintroduce the broad Pi range that caused the crash.

## Open questions

None. The issue is clear enough for automated implementation using the exact-pin
compatibility fix described above.
