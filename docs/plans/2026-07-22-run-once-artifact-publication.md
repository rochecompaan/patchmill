# Run-once Approval Artifact Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically publish each Patchmill-created spec or plan to its issue
before requesting a required manual approval.

**Architecture:** Extract the deterministic file-to-issue publication behavior
behind `set-spec` and `set-plan` into a focused workflow module. Keep the CLI as
a thin adapter, then call the shared publisher from the existing planning stage
after an artifact commit and before the ready comment or review label. Persist
one publication checkpoint per artifact so later side-effect retries do not
repost after a recorded success.

**Tech Stack:** TypeScript, Node.js filesystem and path APIs, Node test runner,
existing Patchmill host providers, run-state checkpoints, Prettier, ESLint,
markdownlint.

## Global Constraints

- Keep the local spec and plan commits, planning branch, worktree, and resume
  behavior.
- The issue's deterministic artifact comment is the human review surface.
- Publish only a Patchmill-created artifact whose corresponding approval gate is
  required.
- Do not republish source-provided or pre-existing repository artifacts.
- Do not spawn `patchmill set-spec` or `patchmill set-plan`; call the shared
  internal publisher.
- Preserve the existing deterministic artifact format, trust rules, checksum
  validation, CLI syntax, and configured labels.
- A successful publisher return means successful publication; do not reload the
  issue to verify it.
- If publication throws, preserve the committed workspace and apply neither the
  ready comment nor the review label.
- No dependency or configuration migration is required.

---

### Task 1: Extract the shared workflow-artifact publisher

**Files:**

- Create: `src/workflow/artifacts/publish-artifact.ts`
- Create: `src/workflow/artifacts/publish-artifact.test.ts`
- Modify: `src/cli/commands/set-artifact/main.ts:1-205`
- Test: `src/cli/commands/set-artifact/main.test.ts`

**Interfaces:**

- Consumes: existing `formatPublishedArtifactComment(input)` from
  `src/workflow/artifacts/published-artifacts.ts`.
- Produces:

```ts
export type PublishComment = (
  issueNumber: number,
  body: string,
) => Promise<void>;

export type PublishWorkflowArtifactOptions = {
  kind: WorkflowArtifactKind;
  issueNumber: number;
  repoRoot: string;
  artifactPath: string;
  artifactDir: string;
  publishComment: PublishComment;
};

export type PublishedWorkflowArtifactResult = {
  path: string;
};

export async function publishWorkflowArtifact(
  options: PublishWorkflowArtifactOptions,
): Promise<PublishedWorkflowArtifactResult>;
```

- Later tasks call `publishWorkflowArtifact` from the planning stage with the
  issue worktree root, mirrored configured artifact directory, and
  `host.commentIssue` adapter.

- [ ] **Step 1: Write focused publisher tests**

Create `src/workflow/artifacts/publish-artifact.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatPublishedArtifactComment } from "./published-artifacts.ts";
import { publishWorkflowArtifact } from "./publish-artifact.ts";

test("publishWorkflowArtifact reads and publishes a deterministic spec", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-publish-"));
  const artifactDir = join(repoRoot, "docs", "specs");
  const artifactPath = join(artifactDir, "issue-42-design.md");
  const content = "# Issue 42 design\n\nApproved behavior.\n";
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, content, "utf8");
  const comments: Array<{ issueNumber: number; body: string }> = [];

  const result = await publishWorkflowArtifact({
    kind: "spec",
    issueNumber: 42,
    repoRoot,
    artifactPath,
    artifactDir,
    publishComment: async (issueNumber, body) => {
      comments.push({ issueNumber, body });
    },
  });

  assert.deepEqual(result, { path: "docs/specs/issue-42-design.md" });
  assert.deepEqual(comments, [
    {
      issueNumber: 42,
      body: formatPublishedArtifactComment({
        kind: "spec",
        path: "docs/specs/issue-42-design.md",
        content,
      }),
    },
  ]);
});

test("publishWorkflowArtifact rejects a path outside the configured artifact directory", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-publish-"));
  const artifactDir = join(repoRoot, "docs", "specs");
  const artifactPath = join(repoRoot, "README.md");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, "# Repository\n", "utf8");

  await assert.rejects(
    publishWorkflowArtifact({
      kind: "spec",
      issueNumber: 42,
      repoRoot,
      artifactPath,
      artifactDir,
      publishComment: async () => {},
    }),
    /spec path must be inside configured specsDir/,
  );
});
```

- [ ] **Step 2: Run the publisher test to verify RED**

Run:

```sh
node --test src/workflow/artifacts/publish-artifact.test.ts
```

Expected: FAIL because `./publish-artifact.ts` does not exist.

- [ ] **Step 3: Implement the shared publisher**

Create `src/workflow/artifacts/publish-artifact.ts`:

```ts
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  formatPublishedArtifactComment,
  type WorkflowArtifactKind,
} from "./published-artifacts.ts";

export type PublishComment = (
  issueNumber: number,
  body: string,
) => Promise<void>;

export type PublishWorkflowArtifactOptions = {
  kind: WorkflowArtifactKind;
  issueNumber: number;
  repoRoot: string;
  artifactPath: string;
  artifactDir: string;
  publishComment: PublishComment;
};

export type PublishedWorkflowArtifactResult = {
  path: string;
};

function artifactName(kind: WorkflowArtifactKind): string {
  return kind === "spec" ? "spec" : "plan";
}

function artifactDirName(kind: WorkflowArtifactKind): string {
  return kind === "spec" ? "specsDir" : "plansDir";
}

function normalizeRepoPath(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).replaceAll("\\", "/");
}

function pathInside(path: string, dir: string): boolean {
  const absoluteDir = resolve(dir);
  const absolutePath = resolve(path);
  const rel = relative(absoluteDir, absolutePath);
  return (
    rel.length === 0 || (!rel.startsWith("..") && !rel.includes(`..${sep}`))
  );
}

async function assertFile(path: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path} is not a file`);
}

export async function publishWorkflowArtifact(
  options: PublishWorkflowArtifactOptions,
): Promise<PublishedWorkflowArtifactResult> {
  const absolutePath = isAbsolute(options.artifactPath)
    ? resolve(options.artifactPath)
    : resolve(options.repoRoot, options.artifactPath);
  if (!pathInside(absolutePath, options.artifactDir)) {
    throw new Error(
      `${artifactName(options.kind)} path must be inside configured ${artifactDirName(options.kind)}`,
    );
  }
  await assertFile(absolutePath);

  const path = normalizeRepoPath(options.repoRoot, absolutePath);
  const content = await readFile(absolutePath, "utf8");
  await options.publishComment(
    options.issueNumber,
    formatPublishedArtifactComment({ kind: options.kind, path, content }),
  );
  return { path };
}
```

- [ ] **Step 4: Run the publisher tests to verify GREEN**

Run:

```sh
node --test src/workflow/artifacts/publish-artifact.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Refactor the CLI to delegate to the publisher**

In `src/cli/commands/set-artifact/main.ts`:

- Remove direct imports of `readFile`, `stat`, path-containment helpers, and
  `formatPublishedArtifactComment`.
- Import the shared API:

```ts
import {
  publishWorkflowArtifact,
  type PublishComment,
} from "../../../workflow/artifacts/publish-artifact.ts";
```

- Keep argument parsing, config loading, host construction, and output in the
  CLI.
- Replace direct file validation, reading, formatting, and comment posting with:

```ts
const expectedDir =
  kind === "spec" ? config.paths.specsDir : config.paths.plansDir;
const publishComment =
  options.publishComment ?? (await defaultPublishComment(repoRoot, args, env));
const published = await publishWorkflowArtifact({
  kind,
  issueNumber: parsed.issueNumber,
  repoRoot,
  artifactPath: parsed.path,
  artifactDir: expectedDir,
  publishComment,
});
output.stdout(
  `Set ${artifactName(kind)} for issue #${parsed.issueNumber} from ${published.path}.`,
);
```

Keep `SetArtifactCommandOptions.publishComment` typed as `PublishComment` so
existing command tests and external behavior remain unchanged.

- [ ] **Step 6: Run shared and CLI tests**

Run:

```sh
node --test \
  src/workflow/artifacts/publish-artifact.test.ts \
  src/cli/commands/set-artifact/main.test.ts
```

Expected: all publisher and command tests pass, including both deterministic
spec/plan comments and configured-directory rejection.

- [ ] **Step 7: Verify formatting and commit Task 1**

Run:

```sh
npx prettier --check \
  src/workflow/artifacts/publish-artifact.ts \
  src/workflow/artifacts/publish-artifact.test.ts \
  src/cli/commands/set-artifact/main.ts
git diff --check
```

Expected: both commands exit 0.

Commit:

```sh
git add \
  src/workflow/artifacts/publish-artifact.ts \
  src/workflow/artifacts/publish-artifact.test.ts \
  src/cli/commands/set-artifact/main.ts
git commit -m "refactor(artifacts): share issue publication logic"
```

---

### Task 2: Publish pipeline-created specs before required review

**Files:**

- Modify: `src/cli/commands/run-once/types.ts:90-107`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.ts:71-85`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.test.ts:25-33`
- Modify: `src/cli/commands/run-once/stage-advancement.ts:311-493`
- Modify: `src/cli/commands/run-once/pipeline-planning.test.ts:440-510`
- Test: `src/cli/commands/run-once/pipeline-planning.test.ts`

**Interfaces:**

- Consumes: `publishWorkflowArtifact(options)` from Task 1, `planningRepoRoot`,
  `planningSpecsDir`, `specPath`, `specCommit`, `specCreated`,
  `host.commentIssue`, and existing `writeRunState` merge behavior.
- Produces: `AgentIssueRunCheckpoints.specPublished?: boolean` and the ordering
  invariant
  `spec commit -> spec publication -> spec ready comment -> spec-review label`.
- Task 3 follows the same established pattern for plans.

- [ ] **Step 1: Extend the required-spec integration test to require publication
      ordering**

In `src/cli/commands/run-once/pipeline-planning.test.ts`, add `dirname` to the
path imports:

```ts
import { dirname, join } from "node:path";
```

Inside
`runOneIssue writes spec and stops at spec-review when spec approval is required`,
define committed content:

```ts
const specContent = "# Needs spec\n\nApproved behavior.\n";
const publishedSpec = formatPublishedArtifactComment({
  kind: "spec",
  path: expectedSpecPath,
  content: specContent,
});
```

When the mock Pi receives the spec prompt, materialize the file it claims to
have committed:

```ts
assert.ok(call.cwd);
const absoluteSpecPath = join(call.cwd, expectedSpecPath);
await mkdir(dirname(absoluteSpecPath), { recursive: true });
await writeFile(absoluteSpecPath, specContent, "utf8");
```

After `runOneIssue`, assert exact side-effect order and checkpoint state:

```ts
const publishedIndex = runner.calls.findIndex(
  (call) =>
    call.command === "tea" &&
    call.args[0] === "comment" &&
    commentBody(call) === publishedSpec,
);
const readyIndex = runner.calls.findIndex(
  (call) =>
    call.command === "tea" &&
    call.args[0] === "comment" &&
    /Spec ready/.test(commentBody(call)),
);
const reviewLabelIndex = runner.calls.findIndex(
  (call) =>
    call.command === "tea" &&
    call.args[0] === "issues" &&
    call.args[1] === "edit" &&
    call.args.includes("spec-review"),
);
assert.ok(publishedIndex >= 0);
assert.ok(publishedIndex < readyIndex);
assert.ok(readyIndex < reviewLabelIndex);

const state = JSON.parse(
  await readFile(runStatePath(config.runStateDir, 31), "utf8"),
);
assert.equal(state.checkpoints.specPublished, true);
```

- [ ] **Step 2: Add the publisher-failure safety test**

Add this focused test beside the required-spec test:

```ts
test("runOneIssue preserves a committed spec when required publication fails", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(
    34,
    ["agent-ready", "enhancement"],
    "Spec upload failure",
  );
  const expectedSpecPath =
    "docs/specs/2026-05-09-issue-34-spec-upload-failure-design.md";
  const specContent = "# Spec upload failure\n\nApproved behavior.\n";
  const publishedSpec = formatPublishedArtifactComment({
    kind: "spec",
    path: expectedSpecPath,
    content: specContent,
  });
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "comment" &&
      commentBody(call) === publishedSpec
    ) {
      return { code: 1, stdout: "", stderr: "artifact upload failed" };
    }
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      assert.ok(call.cwd);
      const absoluteSpecPath = join(call.cwd, expectedSpecPath);
      await mkdir(dirname(absoluteSpecPath), { recursive: true });
      await writeFile(absoluteSpecPath, specContent, "utf8");
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "spec-created",
          specPath: expectedSpecPath,
          commit: "abc123",
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /artifact upload failed/);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit" &&
        call.args.includes("spec-review"),
    ),
    false,
  );
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 34), "utf8"),
  );
  assert.equal(state.specCommit, "abc123");
  assert.equal(state.checkpoints.specCreated, true);
  assert.equal(state.checkpoints.specPublished, undefined);
  assert.equal(state.checkpoints.specReadyCommentPosted, undefined);
});
```

- [ ] **Step 3: Run the spec publication tests to verify RED**

Run:

```sh
node --test \
  --test-name-pattern="spec.*publish|writes spec and stops at spec-review" \
  src/cli/commands/run-once/pipeline-planning.test.ts
```

Expected: FAIL because no deterministic artifact comment is posted and
`specPublished` is absent.

- [ ] **Step 4: Add the spec publication checkpoint**

In `src/cli/commands/run-once/types.ts`, add the checkpoint after `specCreated`:

```ts
| "specCreated"
| "specPublished"
| "specReadyCommentPosted"
```

In `src/cli/commands/run-once/pipeline-lifecycle.ts`, include `specPublished` in
`RESUME_ONLY_SIDE_EFFECT_CHECKPOINTS`.

Expand the existing `effectiveCheckpoints` test:

```ts
assert.deepEqual(
  effectiveCheckpoints({ claimed: true, specPublished: true }),
  undefined,
);
assert.deepEqual(
  effectiveCheckpoints({ claimed: true, specPublished: true }, true),
  { claimed: true, specPublished: true },
);
```

- [ ] **Step 5: Publish a pipeline-created spec before review side effects**

Import the Task 1 API into `stage-advancement.ts`:

```ts
import { publishWorkflowArtifact } from "../../../workflow/artifacts/publish-artifact.ts";
```

Immediately before calculating `hasCurrentSpecApproval`, publish when the policy
requires approval, creation provenance is true, and no successful checkpoint
exists:

```ts
if (
  config.approvalPolicy.specApproval.required &&
  specCreated &&
  specPath &&
  !checkpoints.specPublished
) {
  await runStep("publish spec artifact", async () => {
    await publishWorkflowArtifact({
      kind: "spec",
      issueNumber: issue.number,
      repoRoot: planningRepoRoot,
      artifactPath: specPath,
      artifactDir: planningSpecsDir,
      publishComment: async (issueNumber, body) => {
        await host.commentIssue(issueNumber, body);
      },
    });
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status: "planning",
      ...planningWorkspaceState(),
      specPath,
      specCommit,
      checkpoints: { specPublished: true },
    },
    timestamp,
  );
  checkpoints.specPublished = true;
  await emitSimpleStep(issue.number, "publish spec");
}
```

Do not catch publisher errors in this block. Let the existing `runStep` and
pipeline failure handling preserve the committed planning state. Because this
block precedes `mustStopForSpecReview`, no ready comment or review label can
occur after a thrown publication error.

- [ ] **Step 6: Run spec and lifecycle tests to verify GREEN**

Run:

```sh
node --test \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
```

Expected: all planning and lifecycle tests pass, including publication ordering
and failure safety.

- [ ] **Step 7: Verify and commit Task 2**

Run:

```sh
npx prettier --check \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/pipeline-lifecycle.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
git diff --check
```

Expected: exit 0.

Commit:

```sh
git add \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/pipeline-lifecycle.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
git commit -m "feat(run-once): publish specs for required review"
```

---

### Task 3: Publish plans and enforce publication scope on retries

**Files:**

- Modify: `src/cli/commands/run-once/types.ts:99-106`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.ts:71-87`
- Modify: `src/cli/commands/run-once/pipeline-lifecycle.test.ts:25-36`
- Modify: `src/cli/commands/run-once/stage-advancement.ts:494-680`
- Modify: `src/cli/commands/run-once/pipeline-planning.test.ts:1220-1872`
- Test: `src/cli/commands/run-once/pipeline-planning.test.ts`

**Interfaces:**

- Consumes: Task 1 publisher and Task 2 publication/checkpoint pattern.
- Produces: `AgentIssueRunCheckpoints.planPublished?: boolean`, plan publication
  ordering, retry suppression after a persisted publication checkpoint, and
  explicit coverage that publication is limited to the artifact whose gate
  requires review.

- [ ] **Step 1: Require plan publication—but not spec publication—for a
      plan-only approval gate**

Extend
`runOneIssue writes spec then plan and stops at plan-review when only plan approval is required`.

Materialize both files from their respective Pi calls using `call.cwd`,
`dirname`, `mkdir`, and `writeFile`:

```ts
const specContent = "# Generated spec\n\nPlanning context.\n";
const planContent = "# Generated plan\n\n- [ ] Implement behavior.\n";
```

Build the expected deterministic comments:

```ts
const publishedSpec = formatPublishedArtifactComment({
  kind: "spec",
  path: expectedSpecPath,
  content: specContent,
});
const publishedPlan = formatPublishedArtifactComment({
  kind: "plan",
  path: expectedPlanPath,
  content: planContent,
});
```

After the run, assert:

```ts
const commentBodies = runner.calls
  .filter((call) => call.command === "tea" && call.args[0] === "comment")
  .map(commentBody);
assert.equal(commentBodies.includes(publishedSpec), false);
assert.equal(commentBodies.includes(publishedPlan), true);
const state = JSON.parse(
  await readFile(runStatePath(config.runStateDir, 33), "utf8"),
);
assert.equal(state.checkpoints.specPublished, undefined);
assert.equal(state.checkpoints.planPublished, true);
```

Also compare call indices to prove the deterministic plan comment precedes
`Plan ready` and the `plan-review` label edit.

- [ ] **Step 2: Add plan publication failure coverage**

Add this test with concrete issue `35`:

```ts
test("runOneIssue preserves a committed plan when required publication fails", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: approvalPolicy({ specRequired: false, planRequired: true }),
  });
  const selected = issue(
    35,
    ["agent-ready", "enhancement"],
    "Plan upload failure",
  );
  const specPath =
    "docs/specs/2026-05-09-issue-35-plan-upload-failure-design.md";
  const planPath = "docs/plans/2026-05-09-issue-35-plan-upload-failure.md";
  const planContent = "# Plan upload failure\n\n- [ ] Implement behavior.\n";
  const publishedPlan = formatPublishedArtifactComment({
    kind: "plan",
    path: planPath,
    content: planContent,
  });
  let piCalls = 0;
  const runner = createMockRunner(async (call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "comment" &&
      commentBody(call) === publishedPlan
    ) {
      return { code: 1, stdout: "", stderr: "plan upload failed" };
    }
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      piCalls += 1;
      if (piCalls === 1) {
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "spec-created",
            specPath,
            commit: "spec123",
          }),
          stderr: "",
        };
      }
      assert.ok(call.cwd);
      const absolutePlanPath = join(call.cwd, planPath);
      await mkdir(dirname(absolutePlanPath), { recursive: true });
      await writeFile(absolutePlanPath, planContent, "utf8");
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "plan-created",
          planPath,
          commit: "plan456",
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /plan upload failed/);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit" &&
        call.args.includes("plan-review"),
    ),
    false,
  );
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 35), "utf8"),
  );
  assert.equal(state.planCommit, "plan456");
  assert.equal(state.checkpoints.planCreated, true);
  assert.equal(state.checkpoints.planPublished, undefined);
  assert.equal(state.checkpoints.planReadyCommentPosted, undefined);
});
```

- [ ] **Step 3: Add a two-run checkpoint retry test**

Adapt the existing plan-ready-comment failure setup into a required-plan-review
scenario:

1. The first run creates and materializes a plan.
2. The deterministic plan publication comment succeeds.
3. The later `Plan ready` comment fails.
4. Run state contains `planPublished: true` but no `planReadyCommentPosted`.
5. A second `runOneIssue` invocation uses the saved planning state and worktree.
6. The second runner allows the ready comment and label edit.

Assert the second runner receives no comment body equal to the deterministic
plan artifact. It must resume after the persisted publication checkpoint rather
than reposting.

Use separate `createMockRunner` instances and reload `runStatePath(...)` between
runs so the assertion proves persisted behavior rather than in-memory mutation.

- [ ] **Step 4: Add non-republication assertions for existing artifacts**

Extend these existing tests:

- `runOneIssue stops at spec-review when agent-ready has an existing spec and spec approval is required`
- `runOneIssue stops after finding an existing plan when plan approval is required`
- `runOneIssue claims the issue, comments automation start, writes run state, and exits plan-created for plan-only mode`

For each, collect `tea comment` bodies and assert none equals a deterministic
comment for the existing artifact. The plan-only test also proves no automatic
publication occurs without a required plan gate.

- [ ] **Step 5: Run plan/scope tests to verify RED**

Run:

```sh
node --test \
  --test-name-pattern="plan.*publish|plan-review|existing (spec|plan)|plan-only" \
  src/cli/commands/run-once/pipeline-planning.test.ts
```

Expected: FAIL because no plan publication or `planPublished` checkpoint exists.

- [ ] **Step 6: Add the plan publication checkpoint**

In `types.ts`, add:

```ts
| "planCreated"
| "planPublished"
| "planReadyCommentPosted"
```

Add `planPublished` to `RESUME_ONLY_SIDE_EFFECT_CHECKPOINTS` and expand the
lifecycle test so resumable checkpoints preserve both publication booleans:

```ts
assert.deepEqual(
  effectiveCheckpoints(
    { claimed: true, specPublished: true, planPublished: true },
    true,
  ),
  { claimed: true, specPublished: true, planPublished: true },
);
```

- [ ] **Step 7: Publish a pipeline-created plan before evaluating the review
      stop**

Immediately before `decidePlanApprovalGate`, add the plan equivalent of Task 2:

```ts
if (
  config.approvalPolicy.planApproval.required &&
  planCreated &&
  planPath &&
  !checkpoints.planPublished
) {
  await runStep("publish plan artifact", async () => {
    await publishWorkflowArtifact({
      kind: "plan",
      issueNumber: issue.number,
      repoRoot: planningRepoRoot,
      artifactPath: planPath,
      artifactDir: planningPlansDir,
      publishComment: async (issueNumber, body) => {
        await host.commentIssue(issueNumber, body);
      },
    });
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      title: issue.title,
      status: "planning",
      ...planningWorkspaceState(),
      specPath,
      specCommit,
      planPath,
      planCommit,
      checkpoints: { planPublished: true },
    },
    timestamp,
  );
  checkpoints.planPublished = true;
  await emitSimpleStep(issue.number, "publish plan");
}
```

The creation-provenance check is `planCreated`, not `planCreatedThisRun`, so a
preserved committed plan can publish after an earlier failure. The checkpoint
prevents replay after recorded success. Existing or source-provided plans retain
`created: false` and are not reposted.

- [ ] **Step 8: Run planning and lifecycle tests to verify GREEN**

Run:

```sh
node --test \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
```

Expected: all tests pass, including plan-only publication scope, failure safety,
retry suppression, and existing-artifact non-republication.

- [ ] **Step 9: Verify and commit Task 3**

Run:

```sh
npx prettier --check \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/pipeline-lifecycle.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
git diff --check
```

Expected: exit 0.

Commit:

```sh
git add \
  src/cli/commands/run-once/types.ts \
  src/cli/commands/run-once/pipeline-lifecycle.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/stage-advancement.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
git commit -m "feat(run-once): publish plans for required review"
```

---

### Task 4: Document behavior and run complete verification

**Files:**

- Modify: `site/src/content/docs/using-patchmill/workflow-artifacts.md:18-64`
- Verify: all production and test files changed in Tasks 1-3

**Interfaces:**

- Consumes: completed shared publisher, approval-gated pipeline publication, and
  publication checkpoints.
- Produces: user-facing explanation and final repository-wide evidence.

- [ ] **Step 1: Document automatic approval publication**

Add a section after the manual `set-spec` / `set-plan` recommended workflow:

```markdown
## Automatic publication for required reviews

When `run-once` creates a spec or plan whose approval gate is required, it:

1. commits the artifact in the local issue worktree;
2. publishes the committed file to the issue in the same deterministic format as
   `set-spec` or `set-plan`;
3. posts the concise ready comment;
4. applies the configured review label; and
5. stops for manual approval.

The issue comment is the review surface because the planning branch remains
local until implementation creates or lands a pull request. If publication
fails, Patchmill preserves the committed workspace and does not request review.

Automatic publication is limited to the artifact whose approval gate is
required. Continue using `set-spec` and `set-plan` for human-authored or
pre-existing artifacts.
```

Adjust the surrounding sentence that currently presents manual publication as
the only workflow so it distinguishes human-authored artifacts from artifacts
created by `run-once`.

- [ ] **Step 2: Verify documentation directly**

Run:

```sh
npx prettier --check site/src/content/docs/using-patchmill/workflow-artifacts.md
npx markdownlint-cli2 site/src/content/docs/using-patchmill/workflow-artifacts.md
git diff --check
```

Expected: all commands exit 0. Do not add a test that asserts documentation
text.

- [ ] **Step 3: Commit the documentation**

Run:

```sh
git add site/src/content/docs/using-patchmill/workflow-artifacts.md
git commit -m "docs(workflow): explain automatic approval publication"
```

- [ ] **Step 4: Run focused artifact and planning verification**

Run:

```sh
node --test \
  src/workflow/artifacts/published-artifacts.test.ts \
  src/workflow/artifacts/publish-artifact.test.ts \
  src/cli/commands/set-artifact/main.test.ts \
  src/cli/commands/run-once/pipeline-lifecycle.test.ts \
  src/cli/commands/run-once/pipeline-planning.test.ts
```

Expected: all focused tests pass with zero failures.

- [ ] **Step 5: Run complete repository verification**

Run sequentially:

```sh
npm test
npm run lint
npm run build
git diff --check
git status --short
```

Expected:

- full tests report zero failures;
- lint reports zero errors and warnings;
- TypeScript build exits 0;
- diff check exits 0; and
- status is clean after the task commits.

No Nix build is required because this plan changes no npm dependency or lock
file.
