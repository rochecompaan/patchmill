# Approved Label Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `patchmill init` and `patchmill doctor --fix` create missing
required labels after explicit user approval while keeping default doctor
read-only.

**Architecture:** Add a focused shared label-setup module used by both init and
doctor. Init creates config first, then checks the configured host and offers to
create missing labels; doctor continues to run read-only checks unless `--fix`
is supplied. All host-specific mutation stays behind the existing
`IssueHostProvider.createLabel()` abstraction.

**Tech Stack:** TypeScript ESM, Node `node:test`, existing Patchmill
host/config/policy modules, existing `CommandRunner` host abstraction.

---

## File Structure

- Modify `src/cli/commands/init/args.ts`: parse `--yes`.
- Modify `src/cli/commands/init/args.test.ts`: cover `--yes`.
- Modify `src/cli/commands/init/main.ts`: wire label setup after config
  creation; expose test injections for host/label setup.
- Modify `src/cli/commands/init/main.test.ts`: cover
  prompt/decline/non-interactive/`--yes` init label flows.
- Modify `src/cli/commands/doctor/args.ts`: parse `--fix` and `--yes`; reject
  `--yes` without `--fix`.
- Modify `src/cli/commands/doctor/args.test.ts`: replace v1 rejection test with
  new flag coverage.
- Modify `src/cli/commands/doctor/main.ts`: wire `--fix` label repair flow.
- Modify `src/cli/commands/doctor/main.test.ts`: cover `--fix` prompting and
  `--fix --yes`.
- Modify `src/cli/commands/doctor/checks.ts`: shorten read-only label
  remediation to `patchmill doctor --fix` guidance.
- Modify `src/cli/commands/doctor/checks.test.ts`: update remediation
  expectations.
- Modify `src/cli/commands/doctor/reporting.test.ts`: update generic remediation
  example to match short repair guidance.
- Create `src/cli/commands/labels/setup.ts`: shared pure-ish label review/create
  helper.
- Create `src/cli/commands/labels/setup.test.ts`: focused tests for helper
  behavior.

---

## Task 1: Add argument parsing for approval flags

**Files:**

- Modify: `src/cli/commands/init/args.ts`
- Modify: `src/cli/commands/init/args.test.ts`
- Modify: `src/cli/commands/doctor/args.ts`
- Modify: `src/cli/commands/doctor/args.test.ts`

- [ ] **Step 1: Write failing init args test**

Add to `src/cli/commands/init/args.test.ts`:

```ts
test("parseArgs recognizes yes", () => {
  assert.deepEqual(parseArgs(["--yes"], "/repo"), {
    ...expectedDefault,
    yes: true,
  });
});
```

Update `expectedDefault` in the same file to include `yes: false`.

- [ ] **Step 2: Write failing doctor args tests**

In `src/cli/commands/doctor/args.test.ts`, update the default expectations to
include `fix: false` and `yes: false`, delete
`parseArgs rejects fix mode in v1`, and add:

```ts
test("parseArgs recognizes fix", () => {
  assert.deepEqual(parseArgs(["--fix"], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: false,
    fix: true,
    yes: false,
  });
});

test("parseArgs recognizes fix with yes", () => {
  assert.deepEqual(parseArgs(["--fix", "--yes"], "/repo"), {
    repoRoot: "/repo",
    showHelp: false,
    quiet: false,
    fix: true,
    yes: true,
  });
});

test("parseArgs rejects yes without fix", () => {
  assert.throws(
    () => parseArgs(["--yes"], "/repo"),
    /--yes can only be used with --fix/,
  );
});
```

- [ ] **Step 3: Run arg tests and verify RED**

Run:

```bash
node --test src/cli/commands/init/args.test.ts src/cli/commands/doctor/args.test.ts
```

Expected: failures showing missing `yes`, `fix`, and unknown `--fix`/`--yes`.

- [ ] **Step 4: Implement minimal arg parsing**

In `src/cli/commands/init/args.ts`, add `yes: boolean` to `InitConfig`, default
it to `false`, and parse `--yes`.

In `src/cli/commands/doctor/args.ts`, add `fix: boolean` and `yes: boolean` to
`DoctorConfig`, default both to `false`, parse `--fix` and `--yes`, then after
the loop:

```ts
if (config.yes && !config.fix) {
  throw new Error("--yes can only be used with --fix");
}
```

- [ ] **Step 5: Run arg tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/init/args.test.ts src/cli/commands/doctor/args.test.ts
```

Expected: all tests pass.

---

## Task 2: Create shared approved label setup helper

**Files:**

- Create: `src/cli/commands/labels/setup.ts`
- Create: `src/cli/commands/labels/setup.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/cli/commands/labels/setup.test.ts` with tests for: no missing
labels, declined prompt, approved prompt, `assumeYes`, non-interactive skip, and
creation failure. Use a fake `IssueHostProvider` that records `createLabel`
calls.

Key test expectations:

```ts
assert.match(
  result.message,
  /agent-ready — Ready for automated agent processing/,
);
assert.match(result.message, /patchmill doctor --fix/);
assert.deepEqual(createdLabels, ["agent-ready"]);
```

- [ ] **Step 2: Run helper test and verify RED**

Run:

```bash
node --test src/cli/commands/labels/setup.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement helper**

Create `src/cli/commands/labels/setup.ts` exporting:

```ts
export type LabelSetupResult = {
  status: "satisfied" | "created" | "skipped" | "failed";
  message: string;
  missingCount: number;
  createdCount: number;
};

export type LabelSetupOptions = {
  host: IssueHostProvider;
  policy: PatchmillTriagePolicy;
  prompt?: (question: string) => Promise<string>;
  isInteractive: boolean;
  assumeYes: boolean;
  command: "init" | "doctor";
};
```

Implement `ensureRequiredLabels(options)`:

1. `const missing = missingLabelDefinitions(await host.listLabels(), policy)`.
2. If none, return `satisfied` with `Required labels already exist.`.
3. Build a review list with one line per missing label:

   ```text
     ${name} — ${description}
   ```

4. If `assumeYes`, create all missing labels.
5. If interactive, print the label list in the prompt and create only for
   `y`/`yes`.
6. If declined or non-interactive without `assumeYes`, return `skipped` with
   guidance:
   `You can edit label names in patchmill.config.json after init, then run: patchmill doctor --fix`.
7. On create error, return `failed` and include the failing label name.

Keep helper independent of config loading and CLI output.

- [ ] **Step 4: Run helper tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/labels/setup.test.ts
```

Expected: all helper tests pass.

---

## Task 3: Wire init label creation

**Files:**

- Modify: `src/cli/commands/init/main.ts`
- Modify: `src/cli/commands/init/main.test.ts`

- [ ] **Step 1: Write failing init tests**

Add tests to `src/cli/commands/init/main.test.ts` that inject a label setup
function through `runInit` options:

```ts
test("runInit offers to create missing labels and prints edit guidance on decline", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let labelSetupCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        isInteractive: false,
        checkPiAvailable: async () => false,
        setupLabels: async () => {
          labelSetupCalled = true;
          return {
            status: "skipped",
            missingCount: 1,
            createdCount: 0,
            message:
              "Patchmill needs these labels:\n  agent-ready — Ready for automated agent processing\n\nSkipped label creation.\nYou can edit label names in patchmill.config.json after init, then run:\n  patchmill doctor --fix",
          };
        },
      },
    ),
    0,
  );

  assert.equal(labelSetupCalled, true);
  assert.match(
    stdout.join("\n"),
    /agent-ready — Ready for automated agent processing/,
  );
  assert.match(stdout.join("\n"), /patchmill doctor --fix/);
});
```

Also add a test asserting `runInit(["--yes", "--skills", "none"], ...)` passes
`assumeYes: true` to the setup function.

- [ ] **Step 2: Run init tests and verify RED**

Run:

```bash
node --test src/cli/commands/init/args.test.ts src/cli/commands/init/main.test.ts
```

Expected: unknown option type/property failures for `setupLabels` or missing
`--yes` support if Task 1 was not applied.

- [ ] **Step 3: Implement init wiring**

In `src/cli/commands/init/main.ts`:

- Import `createCommandRunner`, `createIssueHostProvider`, `createTriagePolicy`,
  and `ensureRequiredLabels`.
- Add option type:

```ts
setupLabels?: typeof ensureRequiredLabels;
```

- After `writeInitialConfig` succeeds, create host/policy from `result.config`
  and call:

```ts
const runner = createCommandRunner();
const host = createIssueHostProvider({
  runner,
  repoRoot: config.repoRoot,
  host: result.config.host,
});
const policy = createTriagePolicy(result.config.labels, result.config.triage);
const labelSetup = await (options.setupLabels ?? ensureRequiredLabels)({
  host,
  policy,
  prompt: options.prompt ?? defaultPrompt,
  isInteractive: options.isInteractive ?? defaultStdin.isTTY,
  assumeYes: config.yes,
  command: "init",
});
```

- Include `labelSetup.message` in final stdout before Pi setup or before next
  steps.
- If `labelSetup.status === "failed"`, still finish init but make the message
  explicit; `patchmill doctor` will verify later.

- [ ] **Step 4: Run init tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/init/args.test.ts src/cli/commands/init/main.test.ts
```

Expected: all init tests pass.

---

## Task 4: Shorten read-only doctor remediation

**Files:**

- Modify: `src/cli/commands/doctor/checks.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`
- Modify: `src/cli/commands/doctor/reporting.test.ts`

- [ ] **Step 1: Write/update failing tests**

Update `runDoctorChecks reports missing labels with manual commands` to become
`runDoctorChecks reports missing labels with doctor fix guidance` and assert
remediation contains:

```ts
"Patchmill doctor is read-only and did not create labels.",
"",
"Run the approved repair flow:",
"  patchmill doctor --fix",
"",
"You can edit label names in patchmill.config.json before running --fix.",
```

Assert remediation does not contain `tea labels create` or `gh label create`.

Update `reporting.test.ts` expected remediation similarly.

- [ ] **Step 2: Run doctor check/reporting tests and verify RED**

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts src/cli/commands/doctor/reporting.test.ts
```

Expected: old manual command remediation appears.

- [ ] **Step 3: Implement short remediation**

In `src/cli/commands/doctor/checks.ts`, replace missing-label remediation array
with:

```ts
[
  "Patchmill doctor is read-only and did not create labels.",
  "",
  "Run the approved repair flow:",
  "  patchmill doctor --fix",
  "",
  "You can edit label names in patchmill.config.json before running --fix.",
];
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/doctor/checks.test.ts src/cli/commands/doctor/reporting.test.ts
```

Expected: all tests pass.

---

## Task 5: Wire `patchmill doctor --fix`

**Files:**

- Modify: `src/cli/commands/doctor/main.ts`
- Modify: `src/cli/commands/doctor/main.test.ts`
- Modify: `src/cli/commands/doctor/checks.ts` if a new options type is needed

- [ ] **Step 1: Write failing doctor main tests**

Add tests to `src/cli/commands/doctor/main.test.ts`:

```ts
test("runDoctor --fix runs label setup and prints its review", async () => {
  const stdout: string[] = [];
  let called = false;

  assert.equal(
    await runDoctor(
      ["--fix"],
      "/repo",
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        runner,
        runChecks: async () => [
          { name: "labels", status: "pass", message: "ok" },
        ],
        setupLabels: async (options) => {
          called = true;
          assert.equal(options.assumeYes, false);
          return {
            status: "created",
            missingCount: 1,
            createdCount: 1,
            message:
              "Patchmill needs these labels:\n  agent-ready — Ready for automated agent processing\n\nCreated 1 label.",
          };
        },
      },
    ),
    0,
  );

  assert.equal(called, true);
  assert.match(stdout.join("\n"), /Created 1 label/);
});

test("runDoctor --fix --yes passes assumeYes", async () => {
  let assumeYes: boolean | undefined;
  await runDoctor(
    ["--fix", "--yes"],
    "/repo",
    {
      stdout: () => undefined,
      stderr: () => undefined,
    },
    {
      runner,
      runChecks: async () => [],
      setupLabels: async (options) => {
        assumeYes = options.assumeYes;
        return {
          status: "satisfied",
          missingCount: 0,
          createdCount: 0,
          message: "Required labels already exist.",
        };
      },
    },
  );
  assert.equal(assumeYes, true);
});
```

- [ ] **Step 2: Run doctor main tests and verify RED**

Run:

```bash
node --test src/cli/commands/doctor/args.test.ts src/cli/commands/doctor/main.test.ts
```

Expected: missing setupLabels option or no fix behavior.

- [ ] **Step 3: Implement doctor fix wiring**

In `src/cli/commands/doctor/main.ts`:

- Add prompt support like init if needed.
- Load config and host/policy for fix mode, or add a small helper that mirrors
  the label portion of `runDoctorChecks`.
- Call `ensureRequiredLabels` before or after read-only checks. Prefer before
  final report so mutation result appears first and fresh checks can reflect
  created labels if practical.
- Print `labelSetup.message` when `--fix` is used.
- Preserve default `runDoctor([])` behavior and return code based on read-only
  checks.

If re-running checks after creation is simpler than trying to splice results, do
that: run label setup, then run `runDoctorChecks` and print the normal report.

- [ ] **Step 4: Run doctor main tests and verify GREEN**

Run:

```bash
node --test src/cli/commands/doctor/args.test.ts src/cli/commands/doctor/main.test.ts
```

Expected: all tests pass.

---

## Task 6: End-to-end focused verification and cleanup

**Files:**

- All modified files

- [ ] **Step 1: Run focused command test suites**

Run:

```bash
node --test src/cli/commands/labels/setup.test.ts src/cli/commands/init/args.test.ts src/cli/commands/init/main.test.ts src/cli/commands/doctor/args.test.ts src/cli/commands/doctor/main.test.ts src/cli/commands/doctor/checks.test.ts src/cli/commands/doctor/reporting.test.ts
```

Expected: all tests pass, no warnings.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: formatter, TypeScript lint, and markdown lint pass.

- [ ] **Step 4: Review module sizes and cohesion**

Check:

```bash
wc -l src/cli/commands/labels/setup.ts src/cli/commands/init/main.ts src/cli/commands/doctor/main.ts src/cli/commands/doctor/checks.ts
```

Expected: new helper remains focused; init/doctor files do not absorb
label-creation internals.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs/specs/2026-05-31-approved-label-creation-design.md docs/plans/2026-05-31-approved-label-creation.md src/cli/commands/init/args.ts src/cli/commands/init/args.test.ts src/cli/commands/init/main.ts src/cli/commands/init/main.test.ts src/cli/commands/doctor/args.ts src/cli/commands/doctor/args.test.ts src/cli/commands/doctor/main.ts src/cli/commands/doctor/main.test.ts src/cli/commands/doctor/checks.ts src/cli/commands/doctor/checks.test.ts src/cli/commands/doctor/reporting.test.ts src/cli/commands/labels/setup.ts src/cli/commands/labels/setup.test.ts
git commit -m "feat(labels): automate approved setup"
```

Expected: commit succeeds. Do not push.

---

## Self-Review

- Spec coverage: init prompt, visible label list, decline guidance,
  `doctor --fix`, `--yes`, and read-only default doctor are covered by tasks.
- Placeholder scan: no unresolved placeholder markers remain.
- Type consistency: shared helper uses `IssueHostProvider`,
  `PatchmillTriagePolicy`, and existing `missingLabelDefinitions`; init/doctor
  pass `assumeYes` from parsed args.
