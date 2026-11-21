# Fail Hung Patchmill Tests Implementation Plan

> **For agentic workers:** Execute this plan inline with the sibling
> `executing-plans` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a hung test in Patchmill's own suite fail after 120 seconds, so
that `npm test` and `npm run test:cli` never wait forever.

**Architecture:** Add two Node test runner flags to two `package.json` scripts
and document the limit. Product code does not change.

**Tech Stack:** Node.js test runner (`node --test`), npm scripts.

**Spec:**
[`docs/specs/2026-11-21-issue-316-hung-tests-can-stall-a-run-once-implementation-f-design.md`](../specs/2026-11-21-issue-316-hung-tests-can-stall-a-run-once-implementation-f-design.md)

## Inputs

- The spec above, including its `## Visual explanation`.
- Issue #316 and the planning chat decision: test timeout only. The fail-fast
  fakes are not required. The inactivity warning is dropped.
- No mockups. No HTML companions.

## Global Constraints

- Timeout value: `--test-timeout=120000`. It must be safe for a whole test file,
  because Node 22 (permitted by `engines`) applies the limit to each file.
- Use Node 24 for the dry runs. CI, the Nix build, and devenv use Node 24. On
  Node 22, the dry-run results are different (see the spec).
- Also add `--test-force-exit`.
- Scripts: `test` and `test:cli` in `package.json`. No other scripts.
- Do not change GitHub workflows, `devenv.nix`, `nix/`, or product code.
- npm dependencies do not change, so a Nix build rerun is not required.

## Review Focus

- A test file that keeps an interval active after its test times out: the run
  must still end. The Task 1 dry run covers this case.
- A test with its own `timeout` option longer than 120 seconds: there is none in
  the inspected base (the longest test option is 15,000 ms, in the console
  lifecycle tests). On Node 24, a per-test option has priority over the
  command-line default, so no change is necessary.
- A slow test file on Node 22: the slowest file took 12.4 seconds on Node 24
  with 8 files in parallel (`src/kernel/merged-cleanup-hook.test.ts`). The
  120-second limit gives more than nine times that margin. The spec records this
  measurement, so no extra step is necessary.
- Teardown in `t.after` hooks: `--test-force-exit` ends the process only after
  all tests and their hooks finish. The full suite run in Task 1 confirms that
  the results do not change.

---

### Task 1: Add the test timeout and force exit

**Files:**

- Modify: `package.json` (scripts `test` and `test:cli`)
- Modify: `docs/quality-checks.md` (the "Behavioral tests" row)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing that a later task uses.

- [ ] **Step 1: Do a dry run of a hung test without the flags**

Create a temporary directory outside the repository (for example `mktemp -d`).
Write `hang.test.mjs` into it:

```js
import test from "node:test";
test("hang", async () => {
  setInterval(() => {}, 10);
  await new Promise(() => {});
});
```

Run: `timeout 20 node --test --test-timeout=1000 <dir>/hang.test.mjs; echo $?`

Expected on Node 24: the runner reports `test timed out after 1000ms`, but the
command continues until `timeout` stops it. The exit code is `124`. This proves
that `--test-timeout` alone is not sufficient.

- [ ] **Step 2: Do the dry run again with both flags**

Run:
`timeout 20 node --test --test-timeout=1000 --test-force-exit <dir>/hang.test.mjs; echo $?`

Expected on Node 24: the run ends in about 1 second with
`test timed out after 1000ms`. The exit code is `1`, not `124`.

- [ ] **Step 3: Change the scripts**

In `package.json`, add `--test-timeout=120000 --test-force-exit` directly after
`node --test` in the `test` and `test:cli` scripts. Keep all other arguments,
the environment variables, and the `npm run check:types &&` prefix of `test`.

- [ ] **Step 4: Make sure that the npm script uses the flags**

Copy `hang.test.mjs` into the repository as `scripts/hang.test.mjs`.

Run: `timeout 200 npm run test:cli -- scripts/hang.test.mjs; echo $?`

Expected on Node 24: the output shows `test timed out after 120000ms` for
`hang`. The run ends after about 120 seconds, and the exit code is `1`, not
`124`.

Remove `scripts/hang.test.mjs` and the temporary directory. Make sure that
`git status` shows no untracked file.

- [ ] **Step 5: Document the limit**

In `docs/quality-checks.md`, add one sentence to the "Behavioral tests" row: a
test that runs longer than 120 seconds fails. Use Simplified Technical English.
Keep the table aligned for Prettier.

- [ ] **Step 6: Run the quality checks**

Run: `npm test`

Expected: all tests pass. If the worktree has no `node_modules` of its own, the
6 dependency-path failures that the spec names can occur. Compare them with a
run without the flags. Any other failure is a regression.

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json docs/quality-checks.md
git commit -m "test: fail hung tests after 120 seconds (#316)"
```

## Visual explanation

```text
Task 1
├── Step 1-2  dry run outside the repo: prove that force exit is necessary
├── Step 3    package.json: test, test:cli  += --test-timeout=120000 --test-force-exit
├── Step 4    dry run through npm run test:cli: prove that the script uses the flags
├── Step 5    docs/quality-checks.md: state the 120-second limit
├── Step 6    npm test, npm run lint, npm run build
└── Step 7    commit
```

## Planning review

### Pass 1: initial review

- **Scope:** spec and plan together (no gate; boundary: start of
  implementation). Other document: the spec.
- **Reviewer:** `reviewer` agent, model `openai-codex/gpt-6.1-sol`, thinking
  `xhigh`, base revision `b9421ecac0a35f53032604dbfdd26fde0b2aa456`.
- **Reviewed body SHA-256:** spec
  `00b37df06a06f3d2a950075ffa7c7d08cdeee442e4ea20330d03e6c08286de91`, plan
  `60034da981111468795ea45e0717613bcb41b83d8c7407af7ed56655f031418f`. The plan
  was compared with the spec body
  `00b37df06a06f3d2a950075ffa7c7d08cdeee442e4ea20330d03e6c08286de91`.
- **Survey:** `package.json` owns the test commands. `test:run-once` no longer
  exists. `nix/package.nix` runs `npm test`. `test-support/fake-pi.mjs` rejects
  unexpected invocations, and Git history shows that the old hung fakes were
  removed. `docs/quality-checks.md` is the right document. No module, seam, or
  adapter changes. With both flags, the suite results did not change, and a copy
  with complete dependencies passed all 1,546 tests.
- **PR316-01 (blocker): accepted.** Node 22, which `engines` permits, applies
  `--test-timeout` to each whole test file. The 60-second value was sized from
  the slowest test only, and the dry-run expectations were not version-aware.
  Revision: the timeout is now 120,000 ms. The spec describes the Node 24 and
  Node 22 behavior and records the slowest file (12.4 seconds on Node 24). The
  plan labels the dry-run expectations "on Node 24", and the visuals and
  override claims are qualified.
- **Limits:** Node 22.19.0, Nix performance, and the full npm dry run were not
  tested.
- **Outcome:** `blocked`, pending confirmation.

### Pass 2: scoped confirmation

- **Reviewer:** `reviewer` agent, model `openai-codex/gpt-6.1-sol`, thinking
  `xhigh`, base revision `b9421ecac0a35f53032604dbfdd26fde0b2aa456`.
- **Reviewed body SHA-256:** spec
  `3780ff4f6be2865accec90f444be6d6b3b4524a4c5bdd5607bc87fb05d88ca51`, plan
  `8ddeef53ede11b999ba451f74a720cec645d5b183e0835c773ec476e11bc36c3`. The plan
  was compared with the spec body
  `3780ff4f6be2865accec90f444be6d6b3b4524a4c5bdd5607bc87fb05d88ca51`.
- **Result:** PR316-01 is resolved. Independent checks in `/tmp` confirmed the
  behavior for each version. CI, Nix, and devenv use Node 24. The plan commands
  can run. No new findings.
- **Limits:** the healthy file durations on Node 22 are not measured, because
  `fs-ext` fails to load there (`ERR_DLOPEN_FAILED`). The final 120-second npm
  dry run was not run.
- **Final body SHA-256:** spec
  `85dfdae1c3ecf3e0e18bba723a24ba74d263bd4f9baa2105eacfe89c40c8ca62`, plan
  `36dddfd5d64d519ae1f64266f5a5d857419254b1cdbbbe78e24cd9f6e1d4a562`. These
  hashes differ from the confirmed hashes only by the blank line before this
  record. Without that line, the bodies hash to the confirmed values.
- **Outcome:** `ready`.
