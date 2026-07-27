# Pi Dependency Upgrade CI Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scheduled Pi dependency upgrades produce Nix-compatible lockfiles
and keep their CLI validation test independent of the currently pinned Pi
version.

**Architecture:** Add a focused lockfile-integrity module that repairs missing
registry integrity values by hashing the exact resolved tarball bytes. Integrate
it after npm regenerates both lockfiles, then make the Git-independent CLI test
read its manual validation targets from the current root pins.

**Tech Stack:** Node.js 24 ESM, built-in `node:crypto`, npm lockfile v3, Node's
built-in test runner, Bash, and Nix `buildNpmPackage`.

## Global Constraints

- Use the exact `http:` or `https:` tarball URL stored in each lockfile entry.
- Compute integrity as SHA-512 SRI: `sha512-<base64 digest>`.
- Fetch each unique resolved URL once across both lockfiles.
- Never overwrite an existing integrity value.
- Ignore git-resolved dependencies; fail on unsupported non-git resolved URLs.
- Include lockfile label, package path, URL, and HTTP status in actionable
  download errors.
- Add no npm dependency; use Node.js built-ins and the injected fetch function.
- Keep the final branch on Pi `0.80.10`; the `0.82.1` metadata is verification
  output, not part of this fix.
- Do not downgrade `npmDepsFetcherVersion = 2`.
- Preserve the existing metadata restoration behavior when repair fails.
- Keep reusable repair logic in a focused module rather than growing the
  302-line CLI entrypoint.

---

### Task 1: Repair missing lockfile integrity values

**Files:**

- Create: `scripts/lockfile-integrity.mjs`
- Create: `scripts/lockfile-integrity.test.mjs`

**Interfaces:**

- Consumes: parsed npm lockfile objects with a `packages` record and an optional
  `{ fetchImpl }` dependency.
- Produces: `repairMissingLockfileIntegrities(lockfiles, { fetchImpl } = {})`,
  where `lockfiles` is an array of `{ label: string, lockfile: object }`. The
  function mutates only missing `integrity` fields and resolves with
  `undefined`.

- [ ] **Step 1: Write the primary failing test**

Create `scripts/lockfile-integrity.test.mjs` with the successful repair,
deduplication, preservation, and git cases:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { repairMissingLockfileIntegrities } from "./lockfile-integrity.mjs";

const resolved = "https://registry.example.test/shared-1.0.0.tgz";
const expectedIntegrity =
  "sha512-B8POa95m3GJFaMFp1MsqEvsPvqIJoPCLbH2k06iUbfIjuNSkCqtohW801kLScBVmPs4lTysbJEGKUysB9lnEYw==";

function lockfile(packages) {
  return { packages: { "": {}, ...packages } };
}

test("repairs each missing registry integrity from the resolved tarball once", async () => {
  const packageLock = lockfile({
    "node_modules/shared": { version: "1.0.0", resolved },
    "node_modules/existing": {
      version: "2.0.0",
      resolved: "https://registry.example.test/existing-2.0.0.tgz",
      integrity: "sha512-existing",
    },
    "node_modules/git-package": {
      version: "3.0.0",
      resolved: "git+https://example.test/git-package.git#commit",
    },
  });
  const shrinkwrap = lockfile({
    "node_modules/nested/shared": { version: "1.0.0", resolved },
  });
  let fetchCount = 0;

  await repairMissingLockfileIntegrities(
    [
      { label: "package-lock.json", lockfile: packageLock },
      { label: "npm-shrinkwrap.json", lockfile: shrinkwrap },
    ],
    {
      fetchImpl: async (url) => {
        fetchCount += 1;
        assert.equal(url, resolved);
        return new Response("tarball bytes");
      },
    },
  );

  assert.equal(
    packageLock.packages["node_modules/shared"].integrity,
    expectedIntegrity,
  );
  assert.equal(
    shrinkwrap.packages["node_modules/nested/shared"].integrity,
    expectedIntegrity,
  );
  assert.equal(
    packageLock.packages["node_modules/existing"].integrity,
    "sha512-existing",
  );
  assert.equal(
    packageLock.packages["node_modules/git-package"].integrity,
    undefined,
  );
  assert.equal(fetchCount, 1);
});
```

- [ ] **Step 2: Run the primary test and verify RED**

Run:

```bash
node --test scripts/lockfile-integrity.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./lockfile-integrity.mjs`. This
proves the test depends on the new production module.

- [ ] **Step 3: Write the minimal successful-path implementation**

Create `scripts/lockfile-integrity.mjs`:

```js
import { createHash } from "node:crypto";

function isGitResolvedUrl(resolved) {
  return /^(?:git(?:\+ssh|\+https|\+file|):|github:)/u.test(resolved);
}

export async function repairMissingLockfileIntegrities(
  lockfiles,
  { fetchImpl = fetch } = {},
) {
  const integrityByUrl = new Map();

  for (const { lockfile } of lockfiles) {
    for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
      const resolved = entry?.resolved;
      if (
        path === "" ||
        entry?.link === true ||
        entry?.version === undefined ||
        resolved === undefined ||
        entry?.integrity !== undefined ||
        isGitResolvedUrl(resolved) ||
        !/^https?:/u.test(resolved)
      ) {
        continue;
      }

      let integrityPromise = integrityByUrl.get(resolved);
      if (!integrityPromise) {
        integrityPromise = fetchImpl(resolved).then(async (response) => {
          const tarball = Buffer.from(await response.arrayBuffer());
          const digest = createHash("sha512").update(tarball).digest("base64");
          return `sha512-${digest}`;
        });
        integrityByUrl.set(resolved, integrityPromise);
      }
      entry.integrity = await integrityPromise;
    }
  }
}
```

- [ ] **Step 4: Run the primary test and verify GREEN**

Run:

```bash
node --test scripts/lockfile-integrity.test.mjs
```

Expected: PASS with one test and zero failures.

- [ ] **Step 5: Add failing error-path tests**

Append these tests to `scripts/lockfile-integrity.test.mjs`:

```js
test("rejects a missing integrity with an unsupported resolved URL", async () => {
  const packageLock = lockfile({
    "node_modules/local": {
      version: "1.0.0",
      resolved: "file:../local",
    },
  });

  await assert.rejects(
    repairMissingLockfileIntegrities([
      { label: "package-lock.json", lockfile: packageLock },
    ]),
    /package-lock\.json: node_modules\/local@1\.0\.0 is missing integrity and uses unsupported resolved URL file:\.\.\/local/u,
  );
});

test("reports the lockfile entry and status when a tarball fetch fails", async () => {
  const packageLock = lockfile({
    "node_modules/missing": {
      version: "4.0.0",
      resolved: "https://registry.example.test/missing-4.0.0.tgz",
    },
  });

  await assert.rejects(
    repairMissingLockfileIntegrities(
      [{ label: "package-lock.json", lockfile: packageLock }],
      {
        fetchImpl: async () =>
          new Response("not found", {
            status: 404,
            statusText: "Not Found",
          }),
      },
    ),
    /package-lock\.json: unable to fetch node_modules\/missing@4\.0\.0 from https:\/\/registry\.example\.test\/missing-4\.0\.0\.tgz \(404 Not Found\)/u,
  );
});
```

- [ ] **Step 6: Run the error tests and verify RED**

Run:

```bash
node --test scripts/lockfile-integrity.test.mjs
```

Expected: two failures. The unsupported URL currently gets skipped, and the 404
response currently gets hashed instead of rejected.

- [ ] **Step 7: Implement actionable URL and download failures**

Replace `scripts/lockfile-integrity.mjs` with:

```js
import { createHash } from "node:crypto";

function isGitResolvedUrl(resolved) {
  return /^(?:git(?:\+ssh|\+https|\+file|):|github:)/u.test(resolved);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function fetchTarballIntegrity({
  fetchImpl,
  label,
  path,
  resolved,
  version,
}) {
  let response;
  try {
    response = await fetchImpl(resolved);
  } catch (error) {
    throw new Error(
      `${label}: unable to fetch ${path}@${version} from ${resolved}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    throw new Error(
      `${label}: unable to fetch ${path}@${version} from ${resolved} (${response.status} ${response.statusText})`,
    );
  }

  const tarball = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha512").update(tarball).digest("base64");
  return `sha512-${digest}`;
}

export async function repairMissingLockfileIntegrities(
  lockfiles,
  { fetchImpl = fetch } = {},
) {
  const integrityByUrl = new Map();

  for (const { label, lockfile } of lockfiles) {
    for (const [path, entry] of Object.entries(lockfile.packages ?? {})) {
      const resolved = entry?.resolved;
      if (
        path === "" ||
        entry?.link === true ||
        entry?.version === undefined ||
        resolved === undefined ||
        entry?.integrity !== undefined ||
        isGitResolvedUrl(resolved)
      ) {
        continue;
      }

      let url;
      try {
        url = new URL(resolved);
      } catch {
        throw new Error(
          `${label}: ${path}@${entry.version} is missing integrity and uses unsupported resolved URL ${resolved}`,
        );
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(
          `${label}: ${path}@${entry.version} is missing integrity and uses unsupported resolved URL ${resolved}`,
        );
      }

      let integrityPromise = integrityByUrl.get(resolved);
      if (!integrityPromise) {
        integrityPromise = fetchTarballIntegrity({
          fetchImpl,
          label,
          path,
          resolved,
          version: entry.version,
        });
        integrityByUrl.set(resolved, integrityPromise);
      }
      entry.integrity = await integrityPromise;
    }
  }
}
```

- [ ] **Step 8: Run the complete module tests and verify GREEN**

Run:

```bash
node --test scripts/lockfile-integrity.test.mjs
npx prettier --check \
  scripts/lockfile-integrity.mjs \
  scripts/lockfile-integrity.test.mjs
```

Expected: all three tests pass and Prettier reports both files formatted.

- [ ] **Step 9: Commit the focused module**

```bash
git add scripts/lockfile-integrity.mjs scripts/lockfile-integrity.test.mjs
git commit -m "fix(ci): repair missing lockfile integrities"
```

### Task 2: Integrate repair into Pi upgrades

**Files:**

- Modify: `scripts/update-pi-deps.mjs:2-17,110-149`
- Modify: `scripts/update-pi-deps.test.mjs:1-49`
- Test: `scripts/lockfile-integrity.test.mjs`
- Test: `test-support/npm-shrinkwrap.test.ts`

**Interfaces:**

- Consumes: `repairMissingLockfileIntegrities([{ label, lockfile }], options)`
  from Task 1 and `getRootPins(packageJson)` from
  `scripts/pi-dependency-upgrade-lib.mjs`.
- Produces: regenerated `package-lock.json` and `npm-shrinkwrap.json` in which
  every non-git resolved dependency has integrity before Nix hash regeneration.

- [ ] **Step 1: Remove the hard-coded Pi version from the CLI test**

In `scripts/update-pi-deps.test.mjs`, add this import:

```js
import { PI_PACKAGES, getRootPins } from "./pi-dependency-upgrade-lib.mjs";
```

Then replace the argument setup inside
`test("update CLI works without Git on PATH", ...)` with:

```js
const packageJson = JSON.parse(
  await readFile(join(rootDir, "package.json"), "utf8"),
);
const currentPins = getRootPins(packageJson);
const result = await runUpdateScript(
  [
    "--mode",
    "manual",
    "--pi-coding-agent-version",
    currentPins[PI_PACKAGES[0]],
    "--pi-tui-version",
    currentPins[PI_PACKAGES[1]],
    "--validate-only",
    "--skip-nix-hash",
    "--summary-json",
    summaryPath,
  ],
  { env: { ...process.env, PATH: tempDir } },
);
```

The RED evidence for this test maintenance is the reproduced Nix test failure
recorded in the design spec: with `0.82.1` metadata, the old test exits 1 with
`package.json: @earendil-works/pi-coding-agent expected 0.80.10`.

- [ ] **Step 2: Verify the dynamic CLI test on the current pins**

Run:

```bash
node --test scripts/update-pi-deps.test.mjs
```

Expected: all update CLI tests pass with no Git binary available to the first
test.

- [ ] **Step 3: Integrate integrity repair after both npm lock updates**

Add this import near the top of `scripts/update-pi-deps.mjs`:

```js
import { repairMissingLockfileIntegrities } from "./lockfile-integrity.mjs";
```

Inside `updatePackageMetadata`, immediately after restoring `updatedShrinkwrap`
to `packagePaths.shrinkwrap` and before invoking Prettier, add:

```js
const [packageLock, shrinkwrap] = await Promise.all([
  readJson(packagePaths.packageLock),
  readJson(packagePaths.shrinkwrap),
]);
await repairMissingLockfileIntegrities([
  { label: "package-lock.json", lockfile: packageLock },
  { label: "npm-shrinkwrap.json", lockfile: shrinkwrap },
]);
await Promise.all([
  writeJson(packagePaths.packageLock, packageLock),
  writeJson(packagePaths.shrinkwrap, shrinkwrap),
]);
```

Keep this code inside the existing `try` block so the existing `catch` restores
`package.json`, `package-lock.json`, and `npm-shrinkwrap.json` if fetching or
hashing fails.

- [ ] **Step 4: Run focused regression tests**

Run:

```bash
node --test \
  scripts/lockfile-integrity.test.mjs \
  scripts/update-pi-deps.test.mjs \
  test-support/npm-shrinkwrap.test.ts
```

Expected: all tests pass. The first file proves repair behavior, the second
proves current-pin validation without Git, and the third proves the committed
shrinkwrap remains complete.

A source-structure-only integration test is intentionally not added: it would
restate script wiring rather than prove behavior. Task 3 directly executes the
real upgrade, npm, and Nix boundaries instead.

- [ ] **Step 5: Run formatter and lint checks for changed code**

Run:

```bash
npx prettier --write \
  scripts/lockfile-integrity.mjs \
  scripts/lockfile-integrity.test.mjs \
  scripts/update-pi-deps.mjs \
  scripts/update-pi-deps.test.mjs
npm run lint
```

Expected: Prettier completes successfully and lint exits 0.

- [ ] **Step 6: Commit the integration**

```bash
git add scripts/update-pi-deps.mjs scripts/update-pi-deps.test.mjs
git commit -m "fix(ci): integrate Pi lockfile integrity repair"
```

### Task 3: Reproduce the full workflow and verify the branch

**Files:**

- Temporarily modify, then restore: `package.json`
- Temporarily modify, then restore: `package-lock.json`
- Temporarily modify, then restore: `npm-shrinkwrap.json`
- Temporarily modify, then restore: `nix/package.nix`
- Verify: `.github/workflows/pi-dependency-upgrade.yml`

**Interfaces:**

- Consumes: the update CLI and lockfile repair integrated in Tasks 1 and 2.
- Produces: verification evidence only; no generated dependency metadata remains
  in the final diff.

- [ ] **Step 1: Run the real Pi `0.82.1` metadata update**

Run:

```bash
mkdir -p .tmp
node scripts/update-pi-deps.mjs \
  --mode manual \
  --target-version 0.82.1 \
  --summary-json .tmp/pi-deps-summary.json
```

Expected: exit 0; both selected targets are `0.82.1`; Nix no longer prints
`non-git dependencies should have associated integrity`; and the script updates
`nix/package.nix` with the matching npm dependency hash.

- [ ] **Step 2: Assert both generated lockfiles are Nix-compatible**

Run:

```bash
node <<'NODE'
const fs = require("node:fs");

for (const filename of ["package-lock.json", "npm-shrinkwrap.json"]) {
  const lockfile = JSON.parse(fs.readFileSync(filename, "utf8"));
  const missing = Object.entries(lockfile.packages ?? {})
    .filter(([path]) => path !== "")
    .filter(([, entry]) => entry.link !== true)
    .filter(([, entry]) => entry.version !== undefined)
    .filter(([, entry]) => entry.resolved !== undefined)
    .filter(([, entry]) =>
      !/^(?:git(?:\+ssh|\+https|\+file|):|github:)/u.test(entry.resolved),
    )
    .filter(([, entry]) => entry.integrity === undefined)
    .map(([path, entry]) => `${path}@${entry.version}`);
  if (missing.length > 0) {
    throw new Error(`${filename} is missing integrity: ${missing.join(", ")}`);
  }
  console.log(`${filename}: all non-git resolved dependencies have integrity`);
}
NODE
```

Expected: both success messages and exit 0.

- [ ] **Step 3: Execute the remaining workflow validation sequence**

Run:

```bash
npm ci
node --test src/cli/commands/init/pi-dependency-contract.test.ts
npm test
node scripts/smoke-packed-artifact.mjs
npm run lint
cp nix/package.nix .tmp/nix-package.nix.before-hash
scripts/update-npm-deps-hash.sh
cmp --silent .tmp/nix-package.nix.before-hash nix/package.nix
nix build .#patchmill --print-build-logs
nix flake check --accept-flake-config --print-build-logs
```

Expected: every command exits 0. The second hash update reports that the hash
already matches, `cmp` detects no change, the Nix package builds, and the flake
check succeeds. This repository has no `checks.*.pi-config-extension-load`
output; its runtime integration is covered by the Pi compatibility contract,
packed artifact smoke test, and Nix package install checks above.

- [ ] **Step 4: Restore generated dependency metadata**

Run:

```bash
git checkout -- \
  package.json \
  package-lock.json \
  npm-shrinkwrap.json \
  nix/package.nix
npm ci
```

Expected: the four generated files return to Pi `0.80.10`, and local
`node_modules` matches the restored lockfile.

- [ ] **Step 5: Run final verification against the committed branch state**

Run:

```bash
node --test \
  scripts/lockfile-integrity.test.mjs \
  scripts/update-pi-deps.test.mjs \
  test-support/npm-shrinkwrap.test.ts
npm test
npm run lint
node scripts/smoke-packed-artifact.mjs
nix build .#patchmill --print-build-logs
nix flake check --accept-flake-config --print-build-logs
git diff --check
git status --short
```

Expected: all tests, lint, smoke tests, and Nix commands exit 0;
`git diff --check` is silent; and `git status --short` is silent because
generated Pi `0.82.1` metadata has been restored.
