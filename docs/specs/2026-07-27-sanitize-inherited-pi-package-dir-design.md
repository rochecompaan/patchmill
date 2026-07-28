# Sanitize Inherited Pi Package Directory Design

**Issue:** [#117](https://github.com/rochecompaan/patchmill/issues/117)

## Problem

Patchmill can be launched by a command process created inside another Pi
session. That process inherits the outer Pi installation's `PI_PACKAGE_DIR`.
Patchmill bundles its own `@earendil-works/pi-coding-agent`, but the bundled
dependency treats `PI_PACKAGE_DIR` as an explicit package-root override. It can
therefore resolve themes and other runtime resources beneath the outer Pi
package instead of beneath Patchmill's dependency tree.

This produces misleading readiness failures even when Patchmill's repository
configuration, installed skills, and provider authentication are valid.

## Root Cause

`bin/patchmill.ts` statically imports `src/cli/main.ts`. That import loads the
complete command graph, including modules that use the bundled Pi API, before
the executable performs any environment ownership step.

The bundled Pi dependency reads `process.env.PI_PACKAGE_DIR` when resolving
package assets. Patchmill's command runner also either inherits `process.env`
directly or merges per-command overrides into it. A foreign package override can
therefore affect both in-process Pi API calls and bundled Pi subprocesses.

A dependency-level reproduction confirms the data flow: setting `PI_PACKAGE_DIR`
to a foreign directory makes Pi's `getPackageDir()` return that directory and
makes its theme path resolve beneath the same foreign root.

## Goals

- Make executable Patchmill invocations own the package-directory context used
  by their bundled Pi dependency.
- Remove an inherited `PI_PACKAGE_DIR` before any Patchmill command module or
  bundled Pi module loads.
- Ensure Pi subprocesses launched later inherit the same sanitized environment.
- Preserve provider credentials, Pi session metadata, Patchmill configuration
  variables, and all other unrelated environment entries.
- Add regression coverage that fails if command loading occurs before
  sanitization.

## Non-Goals

- Do not change the behavior of callers that import `src/cli/main.ts` directly.
  Embedding callers retain ownership of their process environment.
- Do not add command-specific cleanup to doctor, triage, run-once, init, or the
  shared command runner.
- Do not infer whether a `PI_PACKAGE_DIR` value is foreign; executable Patchmill
  invocations do not honor this Pi package override.
- Do not change provider authentication, skill loading, resource discovery, or
  subprocess option APIs.
- Do not add configuration or documentation for selecting a Pi package
  directory.

## Design

### Executable bootstrap boundary

`bin/patchmill.ts` becomes the single ownership boundary for executable
invocations. It will no longer statically import `src/cli/main.ts`.

The executable-only branch will:

1. Delete only `process.env.PI_PACKAGE_DIR`.
2. Dynamically import `src/cli/main.ts` after deletion.
3. Invoke the imported `main()` function.
4. Assign its exit code to `process.exitCode`.

The sequence remains private to the executable module. Patchmill will not export
a bootstrap helper or dependency-injection seam because the published package
includes `bin` and `dist`, allowing consumers to deep-import exported symbols
even without a package `exports` map.

The existing symlink-aware main-module detection remains unchanged.

### Environment lifetime

The deleted override will not be restored. Every operation in an executable
Patchmill process must use Patchmill's bundled Pi ownership context for the
entire process lifetime.

Deleting an absent `PI_PACKAGE_DIR` is a no-op. No other environment key is
copied, filtered, renamed, or removed.

### Data flow

The resulting startup flow is:

1. An outer process launches Patchmill with its inherited environment.
2. Patchmill's executable bootstrap removes `PI_PACKAGE_DIR`.
3. The bootstrap loads the CLI command graph.
4. In-process bundled Pi APIs resolve resources from their own installed
   package.
5. Command handlers launch subprocesses through the existing runner.
6. Those subprocesses inherit the already-sanitized `process.env`, plus their
   existing per-command overrides.

This one boundary covers current and future commands without duplicating
environment policy across Pi call sites.

### Module responsibilities

- `bin/patchmill.ts`: detect executable invocation, sanitize executable-owned
  environment, lazily load the CLI, and propagate its exit code.
- `src/cli/main.ts`: resolve and dispatch Patchmill commands exactly as it does
  today.
- Existing doctor, Pi command, and command-runner modules: remain unchanged and
  consume the sanitized process environment naturally.

The bootstrap remains a small, cohesive module; no new general-purpose
environment utility or command-runner abstraction is needed.

## Failure Behavior

Dynamic import failures continue to surface as startup failures, matching the
current behavior of static import failures. Existing command error handling and
exit-code behavior remain unchanged.

Patchmill will not restore or fall back to the removed override if bundled Pi
resource discovery fails for another reason. Remediation for genuine dependency,
provider, skill, or repository failures remains unchanged.

## Testing

The Testing Value Gate is satisfied because this is a production regression at a
reusable process boundary and a future static import or reordered bootstrap
could reintroduce it.

Extend `bin/patchmill.test.ts` with a fresh-process regression test that
launches the actual `bin/patchmill.ts` executable with:

- a foreign `PI_PACKAGE_DIR` present before bootstrap evaluation;
- representative unrelated values, including a provider credential and Pi
  session metadata; and
- a registered ESM loader that substitutes a deterministic CLI probe for
  `src/cli/main.ts` in the spawned process only.

The probe module must fail at module evaluation if `PI_PACKAGE_DIR` is still
present. Its `main()` function must launch a child process without an explicit
environment, emit that child's relevant environment as JSON, and return a known
non-zero exit code. The parent test must parse the JSON without fallback and
verify that the child lacks `PI_PACKAGE_DIR`, preserves every unrelated value,
and receives the known exit code through the real executable wiring.

This test fails if the CLI returns to a static import, sanitization moves after
the dynamic import, the executable bypasses the private bootstrap sequence,
unrelated variables are removed, child inheritance changes, or exit-code
propagation breaks. The probe and loader live under `test-support` and are not
published package APIs.

Keep the existing symlink execution test as integration coverage that the
executable still starts and dynamically reaches the real CLI.

Implementation verification will run:

```sh
node --test bin/patchmill.test.ts
npm test
npm run lint
npm run build
node dist/bin/patchmill.js --help
package_path="$(nix build .#patchmill --no-link --print-out-paths)"
PI_PACKAGE_DIR=/nix/store/outer-pi/libexec/pi \
  "$package_path/bin/patchmill" --help
```

`npm run build` is an emission check, not a semantic TypeScript check, because
`tsconfig.build.json` sets `noCheck: true`. No dependency files change, so the
dependency-triggered Nix requirement does not apply; the explicit Nix build is
still required here to verify the affected wrapper that executes
`$out/share/patchmill/bin/patchmill.ts`.

## Alternatives Considered

### Static side-effect prelude

A side-effect-only module could delete the variable before a static CLI import.
This would make ordering implicit in module evaluation and hide a process-wide
mutation inside an import. The explicit dynamic-import sequence is easier to
reason about and test.

### Per-integration sanitization

Doctor resource discovery and each bundled Pi subprocess could receive separate
cleanup. This duplicates policy, risks missing future call sites, and still
requires special handling for in-process APIs that read `process.env` directly.

### Command-runner-only sanitization

Filtering the variable in the shared child-process runner would cover
subprocesses but not in-process bundled Pi APIs. It would also apply Pi-specific
policy to unrelated child commands.

## Compatibility and Scope

The change affects only Patchmill launched through its executable entrypoint.
Command names, arguments, configuration, host operations, credentials, session
metadata, and direct programmatic CLI imports retain their existing behavior. No
dependencies, generated locks, or public package exports change.
