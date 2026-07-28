# Sanitize Inherited Pi Package Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure executable Patchmill invocations remove an inherited
`PI_PACKAGE_DIR` before loading or launching bundled Pi code while preserving
every unrelated environment value.

**Architecture:** Make the executable-only branch in `bin/patchmill.ts` the
single process-ownership boundary. It will delete the inherited package
override, dynamically import the existing CLI dispatcher, invoke it, and
propagate its exit code; a registered ESM loader and deterministic CLI probe
will test the actual executable in a fresh process without exporting a
production test seam.

**Tech Stack:** Node.js 24, TypeScript ES modules, Node's built-in test runner
and ESM loader hooks, ESLint, Prettier, markdownlint, TypeScript compiler, Nix

**Specification:**
`docs/specs/2026-07-27-sanitize-inherited-pi-package-dir-design.md`

## Global Constraints

- Apply sanitization only to Patchmill launched through `bin/patchmill.ts`;
  direct imports of `src/cli/main.ts` retain current behavior.
- Delete only `process.env.PI_PACKAGE_DIR`, before importing `src/cli/main.ts`
  or any bundled Pi command graph.
- Do not restore `PI_PACKAGE_DIR` during the executable process lifetime.
- Preserve provider credentials, Pi session metadata, Patchmill configuration
  variables, and every other environment entry unchanged.
- Do not export a bootstrap helper or dependency-injection seam; `bin` and
  `dist` are published and deep-importable because the package has no `exports`
  map.
- Do not add cleanup to doctor, triage, run-once, init, Pi call sites, or the
  shared command runner.
- Do not change provider authentication, skill loading, resource discovery,
  subprocess APIs, configuration, dependencies, lock files, or package exports.
- Preserve symlink-based executable detection, fail-fast dynamic-import and
  `main()` behavior, and exit-code propagation; do not add a local catch or
  fallback.
- Parse the child-process probe JSON directly with `JSON.parse`; malformed
  output must fail the test rather than fall back.
- The implementation worker must use `test-driven-development` and
  `verification-before-completion` because this is a production regression at a
  reusable process boundary.

---

### Task 1: Sanitize the actual executable before loading the CLI

**Files:**

- Create: `test-support/patchmill-bootstrap-register.mjs`
- Create: `test-support/patchmill-bootstrap-loader.mjs`
- Create: `test-support/patchmill-bootstrap-main.mjs`
- Modify: `bin/patchmill.test.ts:1-31`
- Modify: `bin/patchmill.ts:1-18`

**Interfaces:**

- Consumes: the real `bin/patchmill.ts` executable; inherited `process.env`;
  Node's `--import` preload option; `node:module` `register()`; an ESM
  `resolve(specifier, context, nextResolve)` hook; existing `isMainModule()`
  behavior.
- Produces: no new production export. The executable removes `PI_PACKAGE_DIR`,
  dynamically imports `src/cli/main.ts`, awaits `main()`, and assigns its
  numeric result to `process.exitCode`.
- Test contract: the loader redirects only `../src/cli/main.ts` to a probe
  module in the spawned test process. The probe rejects a package override
  during module evaluation, launches a child with inherited environment, emits
  one JSON object, and returns exit code `23`.

- [ ] **Step 1: Create the ESM loader registration fixture**

Create `test-support/patchmill-bootstrap-register.mjs`:

```js
import { register } from "node:module";

register("./patchmill-bootstrap-loader.mjs", import.meta.url);
```

This module is preloaded with Node's `--import` option before the actual
executable is evaluated. It registers the resolver hook without modifying
production code or using deprecated loader flags.

- [ ] **Step 2: Create the CLI-module resolver fixture**

Create `test-support/patchmill-bootstrap-loader.mjs`:

```js
const cliFixtureUrl = new URL("./patchmill-bootstrap-main.mjs", import.meta.url)
  .href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "../src/cli/main.ts") {
    return { url: cliFixtureUrl, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
```

The hook must redirect only the CLI import used by `bin/patchmill.ts`. Every
other module resolution delegates to Node and fails normally if Node cannot
resolve it.

- [ ] **Step 3: Create the fail-fast CLI and child-inheritance probe**

Create `test-support/patchmill-bootstrap-main.mjs`:

```js
import { spawnSync } from "node:child_process";

if (process.env.PI_PACKAGE_DIR !== undefined) {
  throw new Error("PI_PACKAGE_DIR reached the CLI module");
}

export function main() {
  const child = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `process.stdout.write(JSON.stringify({
        piPackageDir: process.env.PI_PACKAGE_DIR ?? null,
        providerCredential: process.env.ANTHROPIC_API_KEY,
        parentSession: process.env.PI_SUBAGENT_PARENT_SESSION,
        sentinel: process.env.PATCHMILL_TEST_SENTINEL,
      }));`,
    ],
    { encoding: "utf8" },
  );

  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(
      `child environment probe failed (${child.status}): ${child.stderr}`,
    );
  }

  process.stdout.write(child.stdout);
  return 23;
}
```

The top-level check proves sanitization precedes CLI-module evaluation. Omitting
`env` from `spawnSync` proves a later child inherits the sanitized process
environment. Errors are rethrown or raised with command context; no fallback
output is permitted.

- [ ] **Step 4: Add the failing fresh-process executable regression test**

Add this test before the existing symlink test in `bin/patchmill.test.ts`:

```ts
test("patchmill sanitizes inherited Pi state before loading the actual executable CLI", () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const registerPath = join(
    repoRoot,
    "test-support",
    "patchmill-bootstrap-register.mjs",
  );
  const executablePath = join(repoRoot, "bin", "patchmill.ts");

  const result = spawnSync(
    process.execPath,
    ["--import", registerPath, executablePath],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PI_PACKAGE_DIR: "/nix/store/outer-pi/libexec/pi",
        ANTHROPIC_API_KEY: "test-provider-token",
        PI_SUBAGENT_PARENT_SESSION: "test-parent-session",
        PATCHMILL_TEST_SENTINEL: "preserved",
      },
    },
  );

  assert.equal(result.error, undefined);
  assert.equal(result.status, 23, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    piPackageDir: null,
    providerCredential: "test-provider-token",
    parentSession: "test-parent-session",
    sentinel: "preserved",
  });
});
```

Do not import a bootstrap helper. The test must set the foreign value in the
spawned process before `bin/patchmill.ts` or its static dependency graph can
evaluate.

- [ ] **Step 5: Run the targeted test and verify the real regression fails**

Run:

```sh
node --test bin/patchmill.test.ts
```

Expected: exit non-zero. The new test reports that the spawned executable exited
with status `1`, and its assertion message includes:

```text
PI_PACKAGE_DIR reached the CLI module
```

This failure proves the registered probe replaced the real CLI import while the
current static import still evaluates before any sanitization. Do not continue
if the failure comes from loader registration, fixture resolution, JSON parsing,
or another setup problem.

- [ ] **Step 6: Implement the private executable bootstrap sequence**

Replace `bin/patchmill.ts` with:

```ts
#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

function isMainModule(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;

  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url)) {
  delete process.env.PI_PACKAGE_DIR;
  const { main } = await import("../src/cli/main.ts");
  process.exitCode = await main();
}
```

The deletion must remain before the dynamic import. Do not retain a static
import of `src/cli/main.ts`, export the bootstrap sequence, copy or restore the
environment, catch import or command failures, or modify command-specific Pi
integrations.

- [ ] **Step 7: Run the targeted test and verify executable coverage passes**

Run:

```sh
node --test bin/patchmill.test.ts
```

Expected: exit 0 with two passing tests and zero failures:

```text
patchmill sanitizes inherited Pi state before loading the actual executable CLI
patchmill executes when invoked through a symlink
```

The first test's child JSON proves that `PI_PACKAGE_DIR` was absent before the
probe module loaded and remained absent in a later child while the credential,
parent-session metadata, and sentinel survived unchanged. Exit status `23`
proves `main()` result propagation through the actual executable branch.

- [ ] **Step 8: Run the complete automated test suite**

Run:

```sh
npm test
```

Expected: exit 0 with all tests passing and zero failures.

- [ ] **Step 9: Run the repository linters and format checks**

Run:

```sh
npm run lint
```

Expected: exit 0 with no Prettier, ESLint, or markdownlint errors.

- [ ] **Step 10: Emit the distributable JavaScript**

Run:

```sh
npm run build
```

Expected: exit 0 and a generated `dist/bin/patchmill.js` whose dynamic CLI
import path was rewritten successfully.

This is an emission/build check, not a semantic TypeScript check:
`tsconfig.build.json` sets `noCheck: true`. Do not report it as proof that the
repository is free of TypeScript type errors.

- [ ] **Step 11: Smoke-test the npm-built executable path**

Run:

```sh
node dist/bin/patchmill.js --help
```

Expected: exit 0, no stderr, and stdout beginning with:

```text
Usage:
  patchmill <command> [options]
```

- [ ] **Step 12: Build and smoke-test the Nix-packaged TypeScript entrypoint**

Run:

```sh
package_path="$(nix build .#patchmill --no-link --print-out-paths)"
PI_PACKAGE_DIR=/nix/store/outer-pi/libexec/pi \
  "$package_path/bin/patchmill" --help
```

Expected: the Nix build and its package checks exit 0 without creating a
`result` link. The packaged wrapper, which executes
`$out/share/patchmill/bin/patchmill.ts`, exits 0 with normal Patchmill help
despite the foreign `PI_PACKAGE_DIR`.

No dependency file changes are planned, so this Nix build verifies the directly
affected packaged entrypoint rather than satisfying the dependency-change
policy.

- [ ] **Step 13: Check the final implementation diff**

Run:

```sh
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing and exits 0. Status lists only:

```text
 M bin/patchmill.test.ts
 M bin/patchmill.ts
?? test-support/patchmill-bootstrap-loader.mjs
?? test-support/patchmill-bootstrap-main.mjs
?? test-support/patchmill-bootstrap-register.mjs
```

If any dependency, lock, configuration, doctor, Pi integration, command-runner,
or other production file appears, remove the unrelated change or stop for
review.

- [ ] **Step 14: Commit the verified implementation**

Run:

```sh
git add \
  bin/patchmill.test.ts \
  bin/patchmill.ts \
  test-support/patchmill-bootstrap-loader.mjs \
  test-support/patchmill-bootstrap-main.mjs \
  test-support/patchmill-bootstrap-register.mjs
git commit -m "fix(cli): sanitize inherited Pi package directory"
```

Expected: one commit containing only the fresh-process regression fixtures and
private executable bootstrap change.
