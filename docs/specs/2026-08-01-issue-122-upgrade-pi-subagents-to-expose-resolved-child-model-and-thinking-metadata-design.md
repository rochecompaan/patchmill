# Upgrade pi-subagents Child Metadata Contract Design

**Issue:** #122

**Parent:** #116

## Context

Patchmill delegates planning, development-environment, and implementation work
to Pi with the bundled `pi-subagents` extension loaded before Patchmill's todos
extension. The current dependency range in `package.json` is `^0.25.0`, and the
lockfiles currently resolve `pi-subagents` to `0.25.0`. That version is too old
for the child-result metadata contract needed by the later Patchmill lifecycle
observer work owned outside this issue.

Issue #122 is the dependency-contract slice of the #116 subagent metadata work.
It does not implement Patchmill's observer, session streaming, progress
correlation, or console rendering. Its job is to consume an upstream
`pi-subagents` release that reports authoritative child runtime metadata and to
prove that Patchmill can load and validate that release without reimplementing
upstream configuration resolution.

## Goals

- Pin one `pi-subagents` release that satisfies Patchmill's child metadata
  contract. The issue identifies `0.37.2` as the expected first candidate; the
  implementation should validate that candidate from the installed package and
  pin the first release that passes the contract. Implementation validated
  `0.37.2` first, found the missing foreground row identity blocker, and then
  selected `0.39.0` as the first release whose raw foreground rows satisfy the
  required identity, model, thinking, and ordering contract.
- Require effective child `model` and `thinking` metadata for every Patchmill-
  supported `pi-subagents` execution shape: direct, counted, parallel, and
  chain.
- Validate stable per-child correlation identity and ordering across partial and
  final results for every child in those execution shapes, including direct
  single-child results.
- Preserve absence semantics: Patchmill must fail contract validation or report
  an upstream blocker when required metadata or identity is absent, not infer
  the values locally from parent configuration, agent files, defaults, or array
  positions.
- Keep all source, npm lockfile, shrinkwrap, Nix hash, installed-file, and live
  extension-load references aligned on the same upstream `pi-subagents` version.

## Non-goals

- Implement Patchmill lifecycle observation or render subagent progress.
- Add session streaming or progress correlation logic.
- Recreate `pi-subagents` model, thinking, settings, override, chain, or
  discovery resolution inside Patchmill.
- Change Patchmill's subagent prompts, default implementation workflow, todo
  extension behavior, or extension ordering except where validation proves the
  dependency contract.
- Broaden the scheduled Pi runtime dependency workflow unless implementation
  discovers an existing helper must be shared for exact dependency validation.
  In particular, do not add `pi-subagents` to helper lists that assume
  `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` upgrade in
  version lockstep.

## Proposed approach

Use an exact dependency pin plus a focused contract-validation layer. This is
the recommended approach because it treats `pi-subagents` as the authority for
child runtime metadata while giving Patchmill repeatable evidence that the
bundled extension still loads in source, packed npm, and Nix-installed layouts.

Alternatives considered:

1. **Keep the semver range and rely on lockfile resolution.** This leaves
   package metadata ambiguous and can let later installs resolve a different
   upstream contract than the one Patchmill verified.
2. **Infer child model and thinking from Patchmill or pi-subagents config.**
   This is explicitly out of scope and would duplicate upstream resolution rules
   that may change independently.
3. **Validate only the direct single-child result shape.** This misses the
   execution modes Patchmill implementation skills use in practice and would not
   satisfy the later observer's correlation requirements.

## Runtime contract

Patchmill's contract is over the raw `pi-subagents` child-result metadata, not
over Patchmill-derived fields.

For each supported execution shape, the validation fixture should capture:

- every child entry emitted in partial results;
- every child entry emitted in the final tool result;
- the upstream-supplied child correlation identity for each entry;
- the child entry's authoritative `model` value;
- the child entry's effective `thinking` value, including explicit upstream
  absence when a model or execution mode truly has no thinking level; and
- the array ordering of children within each result.

A passing execution shape must show that:

- each child present in a partial result can be matched to the corresponding
  child in the final result by upstream identity;
- every final child, including a direct single child, has an upstream identity;
- every multi-child shape has unique upstream identities for siblings, including
  counted, parallel, and chain-produced siblings;
- child ordering is stable from partial to final result;
- `model` equals the effective known model configured for the validation child,
  without Patchmill recomputing that value from agent resolution rules;
- `thinking` equals the effective known thinking level configured for the
  validation child when one is configured;
- a dedicated no-thinking fixture proves legitimate upstream absence remains
  absent rather than being backfilled; and
- counted and parallel children remain distinguishable even when they use the
  same agent definition, task text, model, or thinking level.

If upstream does not expose a stable identity or required metadata for one of
Patchmill's supported shapes, implementation should stop and document a focused
upstream blocker. Patchmill should not downgrade the shape to an inferred local
contract.

## Execution shapes to validate

The contract suite should cover these shapes with at least two children wherever
that shape can produce multiple children:

1. **Direct single child:** one foreground `subagent` call.
2. **Counted children:** a counted invocation of the same agent that produces
   multiple sibling child results.
3. **Parallel children:** a `tasks`-based parallel invocation with distinct
   child tasks and a repeated-count parallel task.
4. **Chain children:** a sequential chain with at least two steps, plus a chain
   step that fans out to parallel children if supported by the pinned release.

The suite should observe both Pi tool-execution updates and final tool results
when those partial updates are available. If a supported shape emits no partial
result by design, the test should assert that absence explicitly and still
validate final result metadata and ordering. It should not synthesize partial
rows from final rows.

## Affected components

### Dependency metadata

Update the root dependency from the current range to one exact `pi-subagents`
version. Regenerate and commit:

- `package.json`;
- `package-lock.json`;
- `npm-shrinkwrap.json`; and
- `nix/package.nix` `npmDepsHash`.

The exact root pin, both lockfile root dependency entries, both resolved
`node_modules/pi-subagents` entries, and the installed package's own
`package.json.version` must agree.

### Pi resource profile validation

`src/pi/resource-profiles.ts` should continue resolving the dependency-owned
`pi-subagents` package root through normal Node package resolution and loading
it before `extensions/todos.ts`. Because modern `pi-subagents` packages do not
export the `./package.json` subpath, Patchmill resolves the public package entry
and reads the adjacent manifest instead of relying on
`require.resolve("pi-subagents/package.json")`. Tests should verify not only
that the package root exists, but also that the installed `pi-subagents` package
manifest exposes its declared Pi extension files and that those files exist at
the paths Pi will load.

### Dependency contract tests

Add a focused `pi-subagents` dependency-contract test or script that:

- reads the exact root `pi-subagents` pin;
- locates the installed package through normal Node resolution;
- asserts the installed version equals the root pin;
- asserts the package manifest declares Pi extension resources and those files
  exist;
- loads the extension through Pi with `-e` followed by the resolved
  `pi-subagents` package-root path, matching the style used by Patchmill; and
- validates the child-result metadata contract for direct, counted, parallel,
  and chain shapes.

Where deterministic local model execution is unavailable, keep the package and
extension-load checks automated and make the shape contract a named live
verification command that uses normal Pi credentials. The implementation plan
should state the required environment and expected output. It must not replace
live metadata validation with static source inspection or local inference.

### Packed npm and Nix checks

Extend packed-artifact and Nix-installed verification so both layouts prove:

- Patchmill can initialize;
- the resolved `pi-subagents` package version matches the root pin;
- the `pi-subagents` package manifest's extension files exist in the installed
  layout; and
- run-once resource profiles return existing extension paths in the expected
  order: `pi-subagents`, then Patchmill's todos extension.

The Nix build remains required because the dependency graph and npm hash change.

## Failure behavior

- Missing `model` for any final child in a supported shape fails the dependency
  contract.
- Missing effective `thinking` for a child that upstream should resolve fails
  the dependency contract.
- Missing child identity for any child in a supported shape fails the dependency
  contract.
- Non-unique sibling identities in counted, parallel, or chain-produced children
  fail the dependency contract.
- Any supported shape that upstream cannot report with required metadata or
  identity blocks this dependency PR until a focused upstream blocker is opened
  and linked.
- Identity changes between partial and final results fail the dependency
  contract.
- Ordering differences between partial and final results fail the dependency
  contract.
- Package, lockfile, shrinkwrap, installed package, or Nix-version drift fails
  validation.
- Patchmill never fills missing metadata from the parent model, parent thinking
  level, agent frontmatter, settings overrides, or child array index.

## Verification strategy

Focused verification for the implementation PR should include:

```sh
node --test src/pi/resource-profiles.test.ts
node --test src/pi/pi-subagents-dependency-contract.test.ts
node scripts/verify-pi-subagents-child-metadata.mjs
npm test
node scripts/smoke-packed-artifact.mjs
npm run lint
scripts/update-npm-deps-hash.sh
git diff --exit-code -- nix/package.nix
nix build .#patchmill --print-build-logs
nix flake check --print-build-logs
```

If the live metadata command cannot pass for a supported execution shape because
upstream omits required metadata or identity, the PR should not pin a locally
inferred workaround; it should instead block on a focused upstream issue and
include the failing command output.

## Testing value gate

Automated tests are warranted for dependency contract parsing, installed-file
resolution, package-version agreement, resource-profile extension existence, and
any deterministic child-metadata fixture because those behaviors can regress in
ways that break Patchmill runs.

Do not add tests that merely assert dependency strings, lockfile text, Nix
expression text, or documentation prose. Validate those with exact-pin checks,
lockfile contract code, package smoke checks, `scripts/update-npm-deps-hash.sh`,
and the Nix build.

## Acceptance mapping

- Effective child `model` and `thinking` metadata is available for every
  supported execution shape: covered by the direct, counted, parallel, and chain
  metadata contract suite.
- Partial and final results preserve stable child correlation identity and
  ordering: covered by observing tool-execution updates and final results for
  each supported shape.
- Missing metadata or identity remains absent rather than inferred: covered by
  failure behavior and the prohibition on Patchmill-side resolution logic.
- All source, npm, and Nix references agree on one upstream version: covered by
  exact root pin, lockfile/shrinkwrap validation, installed package checks, and
  Nix hash refresh.
- Required extension-load and full flake verification pass: covered by the live
  extension-load contract, packed-artifact smoke check,
  `nix build .#patchmill --print-build-logs`, and
  `nix flake check --print-build-logs`.
