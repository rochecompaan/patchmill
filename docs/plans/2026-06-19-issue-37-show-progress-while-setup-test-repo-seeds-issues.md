# Setup Test Repo Seed Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show low-noise stdout progress while `patchmill setup-test-repo`
pushes the seed commit, ensures labels, and creates fixture issues.

**Architecture:** Keep progress reporting inside `runSetupTestRepo` and the
existing `SetupTestRepoOutput.stdout` dependency. Add a tiny internal progress
event formatter in `src/cli/commands/setup-test-repo/main.ts`, then emit plain
text lines immediately before the network-bound operations described by the
approved spec.

**Tech Stack:** Node.js test runner, TypeScript ES modules, existing Patchmill
CLI command dependencies.

---

## Context and constraints

- Approved spec:
  `docs/specs/2026-06-19-issue-37-show-progress-while-setup-test-repo-seeds-issues-design.md`.
- Repository note: no `AGENTS.md` exists at the repository root; validation
  commands below are selected from `package.json` and the approved spec.
- Do not change provider interfaces in `src/host/types.ts`.
- Do not change fixture parsing, fixture content, label definitions, repository
  reset behavior, rollback behavior, or next-step output.
- Progress must be plain stdout lines only: no ANSI, spinner, progress bar,
  cursor control, or carriage returns.
- Emit every per-issue progress line before awaiting the matching
  `provider.createIssue(config.target, issue)` call.

## File structure

- Modify: `src/cli/commands/setup-test-repo/main.ts`
  - Add `SetupSeedProgressEvent` and a formatter/emitter helper near
    `SetupTestRepoOutput` or before `runSetupTestRepo`.
  - Emit progress lines after `prepareRepository` succeeds and before push,
    label, and issue creation work.
- Modify: `src/cli/commands/setup-test-repo/main.test.ts`
  - Extend existing happy-path and reset assertions for progress output.
  - Extend test helpers enough to record stdout and provider issue-creation
    events in one ordered event list.
  - Add/extend failure-path assertions for stdout progress plus unchanged stderr
    rollback behavior.

## Task 1: Assert happy-path and reset progress output

**Files:**

- Modify: `src/cli/commands/setup-test-repo/main.test.ts`

- [ ] **Step 1: Add happy-path stdout assertions before implementation**

In test
`runSetupTestRepo creates a new repo, pushes fixtures, labels, and issues`, keep
the existing assertions and add these assertions after the current `stdout`
URL/next-step checks:

```ts
assert.deepEqual(stdout.slice(0, 16), [
  "Pushing seed commit",
  "Ensuring labels",
  "Seeding issues (12)",
  "  [1/12] Create the Team Lunch Poll app scaffold",
  "  [2/12] Define the poll domain model",
  "  [3/12] Build the create poll form",
  "  [4/12] Add poll listing and detail pages",
  "  [5/12] Implement vote submission",
  "  [6/12] Show live poll results",
  "  [7/12] Add poll closing behavior",
  "  [8/12] Improve empty and loading states",
  "  [9/12] Document local development workflow",
  "  [10/12] Polish responsive layout",
  "  [11/12] Add basic accessibility checks",
  "  [12/12] Fix votes disappearing after refresh",
  "Seeded https://example.test/OWNER/patchmill-test",
]);
```

This deliberately asserts exact fixture order from `loadSetupIssues`.

- [ ] **Step 2: Add reset ordering assertions before implementation**

In test `runSetupTestRepo deletes and recreates when reset is supplied`, add
this assertion after the existing reset stdout matches:

```ts
const resetOutput = stdout.join("\n");
assert.ok(
  resetOutput.indexOf("Creating public repository OWNER/patchmill-test") <
    resetOutput.indexOf("Pushing seed commit"),
  resetOutput,
);
assert.ok(
  resetOutput.indexOf("Pushing seed commit") <
    resetOutput.indexOf("Seeded https://example.test/OWNER/patchmill-test"),
  resetOutput,
);
```

- [ ] **Step 3: Run the focused test file and verify the expected failure**

Run:

```bash
node --test src/cli/commands/setup-test-repo/main.test.ts
```

Expected now: FAIL because `stdout.slice(0, 16)` currently begins with
`Seeded ...`, and reset output does not include `Pushing seed commit`.

- [ ] **Step 4: Commit the failing tests when working in a feature branch**

```bash
git add src/cli/commands/setup-test-repo/main.test.ts
git commit -m "test: cover setup-test-repo seed progress output"
```

## Task 2: Assert per-issue ordering and failure-path stdout

**Files:**

- Modify: `src/cli/commands/setup-test-repo/main.test.ts`

- [ ] **Step 1: Extend `createProvider` to record label and issue events**

Change `createProvider` methods to push events for label and issue creation:

```ts
    async createLabel(target: RepositoryTarget, label: LabelDefinition) {
      events?.push(`createLabel:${label.name}`);
      labels.push({ target, label });
    },
    async createIssue(target: RepositoryTarget, issue: HostIssueCreateInput) {
      events?.push(`createIssue:${issue.title}`);
      if (options.failCreateIssue) throw new Error("issue create failed");
      issues.push({ target, issue });
    },
```

Keep the existing `calls`, `labels`, and `issues` behavior intact.

- [ ] **Step 2: Add an ordered stdout/provider test before implementation**

Add this new test near
`runSetupTestRepo prepares and commits local fixtures before mutating the host`:

```ts
test("runSetupTestRepo prints per-issue progress before creating each issue", async () => {
  const tempParent = await mkdtemp(join(tmpdir(), "patchmill-setup-test-"));
  const events: string[] = [];
  const { provider } = createProvider({ exists: false, events });

  const code = await runSetupTestRepo(
    ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
    {
      runner: createEventedGitRunner(events),
      tempParent,
      output: {
        stdout: (line) => events.push(`stdout:${line}`),
        stderr: () => undefined,
      },
      createProvider: () => provider,
    },
  );

  assert.equal(code, 0);
  assert.ok(
    events.indexOf("stdout:Pushing seed commit") < events.indexOf("git:push"),
    events.join("\n"),
  );
  assert.ok(
    events.indexOf("stdout:Ensuring labels") <
      events.indexOf("createLabel:feature"),
    events.join("\n"),
  );
  assert.ok(
    events.indexOf("stdout:  [1/12] Create the Team Lunch Poll app scaffold") <
      events.indexOf("createIssue:Create the Team Lunch Poll app scaffold"),
    events.join("\n"),
  );

  await rm(tempParent, { recursive: true, force: true });
});
```

- [ ] **Step 3: Extend rollback failure test to capture stdout progress**

In test `runSetupTestRepo rolls back the created repository when seeding fails`,
add `const stdout: string[] = [];`, change output to collect stdout, and add
stdout assertions:

```ts
const stdout: string[] = [];

const code = await runSetupTestRepo(
  ["--provider", "github-gh", "--repo", "OWNER/patchmill-test"],
  {
    runner,
    tempParent,
    output: {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    },
    createProvider: () => provider,
  },
);

assert.match(stdout.join("\n"), /Pushing seed commit/u);
assert.match(stdout.join("\n"), /Ensuring labels/u);
assert.match(stdout.join("\n"), /Seeding issues \(12\)/u);
assert.match(
  stdout.join("\n"),
  /\[1\/12\] Create the Team Lunch Poll app scaffold/u,
);
```

Keep the existing stderr assertions for `issue create failed` and
`Rolled back OWNER/patchmill-test`.

- [ ] **Step 4: Run the focused test file and verify the expected failures**

Run:

```bash
node --test src/cli/commands/setup-test-repo/main.test.ts
```

Expected now: FAIL because progress lines have not been implemented yet. The
provider event additions themselves should not break unrelated tests.

- [ ] **Step 5: Commit the additional failing tests when working in a feature
      branch**

```bash
git add src/cli/commands/setup-test-repo/main.test.ts
git commit -m "test: cover setup-test-repo seed progress ordering"
```

## Task 3: Implement setup-test-repo seed progress emission

**Files:**

- Modify: `src/cli/commands/setup-test-repo/main.ts`

- [ ] **Step 1: Add the progress event type and formatter**

Add this code after `SetupTestRepoDependencies` and before `DEFAULT_OUTPUT`:

```ts
type SetupSeedProgressEvent =
  | { type: "push-seed-commit" }
  | { type: "ensure-labels" }
  | { type: "seed-issues-start"; total: number }
  | { type: "seed-issue"; completed: number; total: number; title: string };

function formatSetupSeedProgress(event: SetupSeedProgressEvent): string {
  switch (event.type) {
    case "push-seed-commit":
      return "Pushing seed commit";
    case "ensure-labels":
      return "Ensuring labels";
    case "seed-issues-start":
      return `Seeding issues (${event.total})`;
    case "seed-issue":
      return `  [${event.completed}/${event.total}] ${event.title}`;
  }
}

function emitSetupSeedProgress(
  output: SetupTestRepoOutput,
  event: SetupSeedProgressEvent,
): void {
  output.stdout(formatSetupSeedProgress(event));
}
```

The helper is intentionally not exported because it is command-internal behavior
covered through `runSetupTestRepo` tests.

- [ ] **Step 2: Emit progress around the seeding operations**

Replace the current post-`prepareRepository` block:

```ts
await pushSeedCommit({
  runner,
  repoRoot,
  remoteUrl: repository.gitRemoteUrl,
});

await createMissingLabels(provider, config.target);
for (const issue of issues) await provider.createIssue(config.target, issue);

output.stdout(`Seeded ${repository.publicUrl}`);
```

with:

```ts
emitSetupSeedProgress(output, { type: "push-seed-commit" });
await pushSeedCommit({
  runner,
  repoRoot,
  remoteUrl: repository.gitRemoteUrl,
});

emitSetupSeedProgress(output, { type: "ensure-labels" });
await createMissingLabels(provider, config.target);

emitSetupSeedProgress(output, {
  type: "seed-issues-start",
  total: issues.length,
});
for (const [index, issue] of issues.entries()) {
  emitSetupSeedProgress(output, {
    type: "seed-issue",
    completed: index + 1,
    total: issues.length,
    title: issue.title,
  });
  await provider.createIssue(config.target, issue);
}

output.stdout(`Seeded ${repository.publicUrl}`);
```

This also handles zero issues by printing `Seeding issues (0)` and skipping the
loop.

- [ ] **Step 3: Run focused setup-test-repo tests**

Run:

```bash
node --test src/cli/commands/setup-test-repo/*.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the implementation when tests pass**

```bash
git add src/cli/commands/setup-test-repo/main.ts src/cli/commands/setup-test-repo/main.test.ts
git commit -m "feat: show setup-test-repo seed progress"
```

## Task 4: Final validation and handoff

**Files:**

- Inspect: `src/cli/commands/setup-test-repo/main.ts`
- Inspect: `src/cli/commands/setup-test-repo/main.test.ts`

- [ ] **Step 1: Run targeted validation from the approved spec**

Run:

```bash
node --test src/cli/commands/setup-test-repo/*.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite when the repository baseline is
      suitable**

Run:

```bash
npm test
```

Expected: PASS, unless an unrelated pre-existing baseline failure appears. If an
unrelated baseline failure appears, copy the failing test name and error message
into the implementation handoff and do not broaden this issue's scope.

- [ ] **Step 3: Run formatting and lint checks before final handoff**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Review the final diff for scope control**

Run:

```bash
git diff -- src/cli/commands/setup-test-repo/main.ts src/cli/commands/setup-test-repo/main.test.ts
```

Confirm the diff only:

- adds plain stdout progress formatting/emission in `main.ts`;
- extends setup-test-repo tests in `main.test.ts`;
- does not change host-provider interfaces, fixtures, labels, reset semantics,
  rollback semantics, stderr formatting, or final next-step output.

- [ ] **Step 5: Commit any final validation-only fixes**

If lint or tests required small fixes, commit them:

```bash
git add src/cli/commands/setup-test-repo/main.ts src/cli/commands/setup-test-repo/main.test.ts
git commit -m "fix: align setup-test-repo progress tests"
```

If no fixes were required, do not create an empty commit.
