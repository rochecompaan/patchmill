# Pi Extension Package-Root Resolution Design

**Issue:** [#121](https://github.com/rochecompaan/patchmill/issues/121)

**Parent:** [#116](https://github.com/rochecompaan/patchmill/issues/116)

## Context

Patchmill owns Pi extension resources that must load from the source tree,
compiled npm packages, and Nix installations. `src/pi/resource-profiles.ts`
currently derives the Patchmill package root by resolving `../..` from its
module directory. That reaches the repository root when the module runs from
`src/pi/`, but reaches `<package>/dist` when the compiled module runs from
`dist/src/pi/`. The resulting `dist/extensions/todos.ts` path does not exist.

Issue #117 fixed a different path problem: an outer Pi process could pass a
foreign `PI_PACKAGE_DIR` into Patchmill and redirect bundled Pi's own resource
lookup. Commit `4319009899a96d5e2a58e86a14456f706f3b187f` removes that inherited
override before the CLI loads. It does not change Patchmill-owned extension
resolution and does not supersede this issue.

Issue #116 is an automation-excluded umbrella for run-once subagent metadata
work. Its concise umbrella specification makes #121 an independent prerequisite
for the later package-owned observer in #124. The prior monolithic specification
is superseded and no longer authoritative. The deprecated monolithic plan at
commit `bcf7798dc6d5a747eb3105de32fac7992df62643` remains reference material
only. This design extracts that plan's package-root fix and packaging checks
without adopting observer or progress-reporting work.

## Goals

- Resolve the nearest owning package root without assuming a fixed
  source-directory depth.
- Use one shared resolver for Patchmill-owned extension, fixture, and version
  resources.
- Preserve existing run-once extension ordering and todos-extension behavior.
- Prove source, compiled/npm-packed, and Nix-installed layouts resolve extension
  files that exist.
- Fail clearly when no package boundary can be found, a boundary cannot be
  inspected, or a package-owned extension is missing.

## Non-goals

- Change `pi-subagents` or its package resolution.
- Add the run-once lifecycle observer owned by #124.
- Add subagent progress streaming, correlation, or rendering.
- Change Pi resource-profile composition, ordering, or CLI arguments beyond
  correcting absolute paths.
- Change fixture contents, version output, package metadata, or dependency
  versions.
- Validate that an owning `package.json` has the package name `patchmill`.

## Architecture

### Shared package-root resolver

Create `src/package-root.ts` with one synchronous resolver and a distinct
not-found error:

```ts
export class PackageRootNotFoundError extends Error;
export function findPackageRoot(startDir: string): string;
```

The resolver normalizes `startDir` to an absolute path, then walks upward one
directory at a time. It uses `statSync()` to return the nearest directory whose
`package.json` is a regular file. It does not parse that file, validate its
package name, dereference the start path with `realpath`, or cache results.

Only `ENOENT` and `ENOTDIR` mean the current candidate is absent and permit
traversal to continue. Filesystem failures such as `EACCES` and `ELOOP`
propagate unchanged; a non-file `package.json` fails explicitly rather than
selecting an outer package. If traversal reaches the filesystem root without a
package file, the resolver throws `PackageRootNotFoundError` containing the
normalized starting path. Synchronous behavior is intentional: resource profiles
compute package-owned paths during module initialization, while the other
consumers can call the same API without introducing a second asynchronous
implementation.

### Pi resource profiles

`src/pi/resource-profiles.ts` resolves its module directory from
`import.meta.url`, calls `findPackageRoot()`, and joins `extensions/todos.ts`
onto the result. During module initialization it verifies that the resolved
todos extension is a regular file. A missing, inaccessible, cyclic, or non-file
extension fails initialization instead of passing a plausible nonexistent path
to Pi. Dependency-owned `pi-subagents` continues to resolve through
`require.resolve("pi-subagents/package.json")` because its package boundary is
independent of Patchmill's.

Run-once extension paths remain ordered as:

1. the `pi-subagents` package root;
2. Patchmill's `extensions/todos.ts`.

Planning, development-environment, and implementation profiles continue to use
those two paths. Triage continues to load no additional extensions.

### Setup-test-repo fixtures

`src/cli/commands/setup-test-repo/fixtures.ts` removes its private asynchronous
root walker and calls the shared synchronous resolver.
`resolveFixtureDirectory()` remains asynchronous and keeps its current signature
and return value; only its internal package-boundary discovery changes. Fixture
validation and copying behavior remain unchanged.

### Version lookup

`src/cli/commands/version/main.ts` replaces its two hard-coded `package.json`
candidates with the shared resolver. `readPackageVersion(moduleUrl)` converts
the module URL to a directory, resolves the nearest package root, reads that
root's `package.json`, and returns its string `version`.

Malformed JSON and non-string version values retain explicit failures.
`readPackageVersion()` is the compatibility boundary for its existing missing-
root contract: it catches only `PackageRootNotFoundError` and rethrows
`Could not locate Patchmill package.json` with the resolver error as its cause.
It does not catch filesystem access errors, symlink loops, JSON failures, or
validation errors. Nearest-boundary selection remains the explicitly approved
semantic change for this consumer.

## Resolution flow by layout

### Source tree

A module under `<repo>/src/...` walks upward to `<repo>/package.json`.
Package-owned extensions resolve below `<repo>/extensions/`.

### Compiled and npm-packed layout

A module under `<package>/dist/src/...` walks upward through `dist/` to
`<package>/package.json`. Package-owned extensions resolve below
`<package>/extensions/`, which is already included by npm package metadata.

### Nix-installed layout

Patchmill's Nix wrapper executes source under `$out/share/patchmill/`. The
installation copies `package.json`, `src/`, `extensions/`, and the dependency
link into that same package root. Source modules therefore resolve
`$out/share/patchmill/package.json` and
`$out/share/patchmill/extensions/todos.ts` without Nix-specific path logic.

## Failure behavior

- A missing package boundary fails with the normalized starting path; version
  lookup translates only that typed not-found error to its established public
  error and retains the original error as `cause`.
- `ENOENT` and `ENOTDIR` are the only candidate-probe errors treated as absence.
  `EACCES`, `ELOOP`, and other filesystem failures propagate immediately.
- Resource-profile initialization verifies `extensions/todos.ts` is a regular
  file and does not allow Pi to continue with a missing or invalid extension.
- An unreadable or malformed version `package.json` remains a version-read
  failure rather than being treated as a missing package boundary.
- The nearest ancestor wins when nested package boundaries exist.
- Consumers do not infer or search for alternative resource locations after the
  resolver succeeds.

## Testing strategy

### Resolver behavior

Create `src/package-root.test.ts` to prove that the shared resolver:

- finds roots from source-style and arbitrarily nested dist-style directories;
- selects the nearest ancestor when package boundaries are nested;
- normalizes relative starting paths;
- skips only `ENOENT` and `ENOTDIR` candidate probes;
- propagates `EACCES`, `ELOOP`, and comparable filesystem failures;
- rejects a non-file `package.json`; and
- throws the typed not-found error with the starting path when no ancestor
  contains `package.json`.

These tests pass Patchmill's Testing Value Gate because they protect reusable
filesystem behavior and fail for meaningful regressions to fixed-depth lookup.

### Consumer regressions

Update focused tests so that:

- `src/pi/resource-profiles.test.ts` confirms every configured run-once
  extension path exists while preserving extension order and triage behavior;
- `src/pi/resource-profiles.compiled.test.ts` compiles the real profile into an
  isolated package layout, imports the emitted JavaScript, proves all extension
  paths exist, and proves module initialization fails when `extensions/todos.ts`
  is absent;
- setup-test-repo fixture tests continue resolving the fixture directory from
  nested module-style paths through the shared resolver; and
- version tests prove arbitrary nesting works and preserve malformed JSON and
  non-string version failures.

Tests should assert observable paths and errors, not source imports or
implementation text.

### npm-packed layout

After building, create an npm tarball inside a trap-managed temporary directory
with `npm pack --pack-destination`, install it into a temporary project, import
`dist/src/pi/resource-profiles.js`, construct a run-once profile, and assert
that every returned extension path exists. Creating the work directory before
packing guarantees cleanup even if npm's JSON output cannot be decoded; JSON
parsing remains fail-loud.

`npm pack --dry-run` alone is insufficient because it proves file inclusion but
not runtime path resolution. The existing package-content test remains
responsible for confirming that `extensions/todos.ts` is shipped; no new test
should merely restate the `package.json` file list.

### Nix-installed layout

Extend `nix/package.nix`'s `installCheckPhase` to import the installed resource
profile from `$out/share/patchmill`, construct a run-once profile, and fail if
any extension path is missing. Use the Nix build as direct verification rather
than adding a test that only asserts Nix expression text.

Verification must include:

```sh
node --test \
  src/package-root.test.ts \
  src/pi/resource-profiles.test.ts \
  src/pi/resource-profiles.compiled.test.ts \
  src/cli/commands/setup-test-repo/fixtures.test.ts \
  src/cli/commands/version/main.test.ts
npm test
npm run lint
npm run build
nix build .#patchmill --no-link --print-build-logs
```

The implementation plan will include the exact temporary npm-packed installation
command and its expected output.

## Compatibility and scope control

The change introduces no dependency or package-lock updates. Successful public
CLI output, command signatures, and the version command's established missing-
root message remain unchanged. `resolveFixtureDirectory()` remains asynchronous,
and `readPackageVersion()` retains its injectable module URL used by tests.

The shared migration intentionally covers three existing package-root consumers:
resource profiles, setup-test-repo fixtures, and version lookup. The human
reviewer explicitly approved this expanded scope and nearest-boundary semantics
during #121 design review. It does not search for or refactor unrelated
resource-location code outside those consumers.

The implementation should remain within three reviewable tasks:

1. add and test the shared resolver, then migrate fixture and version lookup;
2. migrate Pi resource profiles and add source/dist regression coverage; and
3. verify npm-packed and Nix-installed layouts.

## Alternatives considered

### Keep the resolver inside resource profiles

This was the deprecated monolithic plan's narrow approach. It fixes the
immediate extension bug but leaves duplicate package-root discovery in
setup-test-repo and fixed candidate depths in version lookup. The approved
design instead consolidates those callers behind one contract.

### Resolve `patchmill/package.json` through Node

Package self-resolution is concise after npm installation but is less reliable
when executing directly from a source checkout and can depend on package exports
or workspace resolution. Ancestor traversal behaves consistently in every
required layout.

### Inject the root at build or wrapper time

Generated constants or environment variables avoid filesystem traversal but
create separate npm and Nix configuration paths. That duplicates layout
knowledge and risks reproducing the divergence this issue removes.

## Acceptance criteria

- One shared resolver returns the nearest ancestor containing a regular
  `package.json` file from arbitrary nesting.
- Candidate traversal suppresses only `ENOENT` and `ENOTDIR`; access errors,
  symlink loops, and comparable filesystem failures propagate.
- Resource profiles, setup-test-repo fixtures, and version lookup use that
  resolver.
- Source execution resolves the existing `pi-subagents` and todos extension
  paths in their current order.
- Compiled/npm-packed execution resolves the same existing extension files from
  the package root.
- Nix-installed execution resolves the same existing extension files from
  `$out/share/patchmill`.
- Existing todos-extension loading and triage resource behavior remain
  unchanged.
- Resource-profile initialization fails when the todos extension is missing or
  not a regular file.
- A committed compiled-layout regression test imports the built profile and
  fails if extension resolution depends on source-tree directory depth.
- Missing package roots fail explicitly instead of depending on source-tree
  directory depth; version lookup preserves its established public not-found
  message.
- Focused tests, the full test suite, lint, build, packed-install verification,
  and the Nix package build pass.
