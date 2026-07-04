# Run-Once Approved Artifact Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach `patchmill run-once` to reuse approved spec and plan artifacts
referenced in issue bodies/comments before it creates replacement artifacts.

**Architecture:** Add a focused, inert issue-content artifact resolver beside
the existing filename resolver in `artifacts.ts`, then wire it into
`stage-advancement.ts` after saved-state and generated-filename discovery. Keep
approval-label gates in stage advancement so parsing untrusted issue text never
changes workflow state unless the corresponding configured approved label is
present.

**Tech Stack:** TypeScript, Node built-in test runner, Patchmill run-once
pipeline helpers, repository-relative path normalization.

---

## File Structure

- Modify: `src/cli/commands/run-once/artifacts.ts` — add artifact-kind types,
  issue-content text scanning, Markdown/path extraction, safe
  repository-relative path validation, and deterministic body/comment
  precedence.
- Create: `src/cli/commands/run-once/artifacts.test.ts` — direct tests for
  parser signals, path safety, missing files, directories, URLs, parent escapes,
  and comment/body ordering.
- Modify: `src/cli/commands/run-once/stage-advancement.ts` — pass
  approved-label-gated issue content into workflow artifact resolution, preserve
  precedence, and emit run-state checkpoints with normalized paths.
- Create: `src/cli/commands/run-once/stage-advancement.test.ts` — focused tests
  for saved state, generated-name files, issue-content references, and fallback
  path generation precedence.
- Modify: `src/cli/commands/run-once/pipeline.test.ts` — add end-to-end run-once
  coverage for approved spec/plan content references proceeding to
  implementation without planning Pi calls.
- Modify: `docs/issue-agent-workflows.md` — document approved issue-content
  artifact references and safety constraints.

## Task 1: Add Direct Resolver Tests

**Files:**

- Create: `src/cli/commands/run-once/artifacts.test.ts`

- [ ] **Step 1: Create failing tests for approved issue-content artifact
      resolution**

Write `src/cli/commands/run-once/artifacts.test.ts` with tests that import the
not-yet-implemented `resolveIssueContentArtifact` helper:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveIssueContentArtifact } from "./artifacts.ts";

async function repo() {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifacts-"));
  await mkdir(join(repoRoot, "docs", "specs"), { recursive: true });
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  return repoRoot;
}

test("resolveIssueContentArtifact finds an approved spec path in the issue body", async () => {
  const repoRoot = await repo();
  await writeFile(
    join(repoRoot, "docs/specs/custom-design.md"),
    "# Spec\n",
    "utf8",
  );

  const result = await resolveIssueContentArtifact({
    repoRoot,
    kind: "spec",
    body: "Approved spec: `docs/specs/custom-design.md`",
    comments: [],
  });

  assert.equal(result?.path, "docs/specs/custom-design.md");
  assert.equal(result?.source, "body");
});

test("resolveIssueContentArtifact prefers the most recent valid comment over the body", async () => {
  const repoRoot = await repo();
  await writeFile(
    join(repoRoot, "docs/plans/body-plan.md"),
    "# Body\n",
    "utf8",
  );
  await writeFile(
    join(repoRoot, "docs/plans/recent-plan.md"),
    "# Recent\n",
    "utf8",
  );

  const result = await resolveIssueContentArtifact({
    repoRoot,
    kind: "plan",
    body: "Approved plan: docs/plans/body-plan.md",
    comments: [
      { body: "Approved plan: docs/plans/recent-plan.md" },
      { body: "Looks good." },
    ],
  });

  assert.equal(result?.path, "docs/plans/recent-plan.md");
  assert.equal(result?.source, "comment");
  assert.equal(result?.commentIndex, 0);
});

test("resolveIssueContentArtifact accepts Markdown links and Patchmill existing-ready comments", async () => {
  const repoRoot = await repo();
  await writeFile(
    join(repoRoot, "docs/plans/custom-plan.md"),
    "# Plan\n",
    "utf8",
  );

  assert.equal(
    (
      await resolveIssueContentArtifact({
        repoRoot,
        kind: "plan",
        body: "Approved plan artifact: [plan](docs/plans/custom-plan.md)",
        comments: [],
      })
    )?.path,
    "docs/plans/custom-plan.md",
  );

  assert.equal(
    (
      await resolveIssueContentArtifact({
        repoRoot,
        kind: "plan",
        body: "Existing plan ready: `docs/plans/custom-plan.md`",
        comments: [],
      })
    )?.path,
    "docs/plans/custom-plan.md",
  );
});

test("resolveIssueContentArtifact rejects unsafe, missing, directory, URL, and ambiguous references", async () => {
  const repoRoot = await repo();
  await mkdir(join(repoRoot, "docs/plans/dir.md"), { recursive: true });
  await writeFile(join(repoRoot, "docs/specs/valid.md"), "# Spec\n", "utf8");

  for (const body of [
    "Approved spec: https://example.test/docs/specs/valid.md",
    "Approved spec: ../outside.md",
    `Approved spec: ${join(tmpdir(), "outside.md")}`,
    "Approved spec: docs/specs/missing.md",
    "Approved plan: docs/plans/dir.md",
    "Approved artifact: docs/specs/valid.md",
    "Spec draft: docs/specs/valid.md",
  ]) {
    assert.equal(
      await resolveIssueContentArtifact({
        repoRoot,
        kind: "spec",
        body,
        comments: [],
      }),
      undefined,
      body,
    );
  }
});
```

- [ ] **Step 2: Run the new tests and verify they fail for missing exports**

Run:

```sh
node --test src/cli/commands/run-once/artifacts.test.ts
```

Expected: FAIL with an import error for `resolveIssueContentArtifact`.

- [ ] **Step 3: Commit the failing tests after implementation makes them pass in
      Task 2**

Do not commit failing tests alone. Commit them together with Task 2
implementation:

```sh
git add src/cli/commands/run-once/artifacts.ts src/cli/commands/run-once/artifacts.test.ts
git commit -m "feat: resolve approved artifacts from issue content"
```

## Task 2: Implement Safe Issue-Content Artifact Resolution

**Files:**

- Modify: `src/cli/commands/run-once/artifacts.ts`
- Test: `src/cli/commands/run-once/artifacts.test.ts`

- [ ] **Step 1: Add exported resolver types and helper skeletons**

Add these exports near the existing types in
`src/cli/commands/run-once/artifacts.ts`:

```ts
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type WorkflowArtifactKind = "spec" | "plan";

export type IssueContentArtifactComment = {
  body?: string;
};

export type IssueContentArtifactResolution = {
  path: string;
  source: "body" | "comment";
  commentIndex?: number;
};

export type IssueContentArtifactOptions = {
  repoRoot: string;
  kind: WorkflowArtifactKind;
  body?: string;
  comments?: readonly IssueContentArtifactComment[];
};
```

Keep the existing `readdir`/`join` imports; merge imports rather than
duplicating them.

- [ ] **Step 2: Implement signal and candidate extraction**

Add helpers that only scan text as inert data:

```ts
const PATH_PATTERN =
  /(?:`([^`]+)`|\[[^\]]+\]\(([^)]+)\)|(^|\s)((?:\.?\.?\/)?[A-Za-z0-9._/-]+\.md))/gm;

function hasArtifactSignal(text: string, kind: WorkflowArtifactKind): boolean {
  const escapedKind = kind === "spec" ? "spec" : "plan";
  return new RegExp(
    `(?:approved\\s+${escapedKind}|${escapedKind}\\s+approved|approved\\s+${escapedKind}\\s+artifact|existing\\s+${escapedKind}\\s+ready)`,
    "i",
  ).test(text);
}

function extractPathCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (const match of text.matchAll(PATH_PATTERN)) {
    const value = match[1] ?? match[2] ?? match[4];
    if (value) candidates.push(value.trim());
  }
  return candidates;
}
```

- [ ] **Step 3: Implement repository-safe path validation**

Add validation that rejects URLs, absolute outside paths, parent escapes,
missing files, and directories:

```ts
function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function insideRepo(repoRoot: string, absolutePath: string): boolean {
  const relativePath = relative(repoRoot, absolutePath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

async function validateIssueArtifactPath(
  repoRoot: string,
  candidate: string,
): Promise<string | undefined> {
  if (!candidate || isUrl(candidate)) return undefined;
  if (candidate.includes("\0")) return undefined;

  const normalizedRepoRoot = resolve(repoRoot);
  const absolutePath = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(normalizedRepoRoot, candidate);
  if (!insideRepo(normalizedRepoRoot, absolutePath)) return undefined;

  let info;
  try {
    info = await stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!info.isFile()) return undefined;

  return relative(normalizedRepoRoot, absolutePath).split(sep).join("/");
}
```

- [ ] **Step 4: Implement deterministic body/comment resolution**

Add the exported resolver:

```ts
async function resolveFromText(
  repoRoot: string,
  kind: WorkflowArtifactKind,
  text: string,
): Promise<string | undefined> {
  if (!hasArtifactSignal(text, kind)) return undefined;
  for (const candidate of extractPathCandidates(text)) {
    const validPath = await validateIssueArtifactPath(repoRoot, candidate);
    if (validPath) return validPath;
  }
  return undefined;
}

export async function resolveIssueContentArtifact(
  options: IssueContentArtifactOptions,
): Promise<IssueContentArtifactResolution | undefined> {
  const comments = options.comments ?? [];
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const path = await resolveFromText(
      options.repoRoot,
      options.kind,
      comments[index]?.body ?? "",
    );
    if (path) return { path, source: "comment", commentIndex: index };
  }

  const path = await resolveFromText(
    options.repoRoot,
    options.kind,
    options.body ?? "",
  );
  return path ? { path, source: "body" } : undefined;
}
```

- [ ] **Step 5: Run direct resolver tests**

Run:

```sh
node --test src/cli/commands/run-once/artifacts.test.ts
```

Expected: PASS.

## Task 3: Add Focused Stage-Advancement Tests

**Files:**

- Create: `src/cli/commands/run-once/stage-advancement.test.ts`
- Modify: `src/cli/commands/run-once/stage-advancement.ts`

- [ ] **Step 1: Export `resolveWorkflowArtifact` only for test visibility**

Change the function declaration in `stage-advancement.ts`:

```ts
export async function resolveWorkflowArtifact(options: {
  repoRoot: string;
  issue: IssueSummary;
  artifactKind: WorkflowArtifactKind;
  artifactDir: string;
  approvedLabel: string;
  labels: readonly string[];
  savedPath?: string;
  savedCommit?: string;
  savedCreated?: boolean;
  findArtifact: (artifactDir: string, issueNumber: number) => Promise<string | undefined>;
  buildArtifact?: (artifactDir: string, issueNumber: number, title: string, date: Date) => string;
  now: Date;
}): Promise<WorkflowArtifactResolution> {
```

Import `WorkflowArtifactKind` from `./artifacts.ts` in the same task.

- [ ] **Step 2: Create failing precedence and approval-gate tests**

Create `src/cli/commands/run-once/stage-advancement.test.ts` with tests that
call `resolveWorkflowArtifact` directly. Cover: saved state wins, generated-name
file wins, issue-content reference only works with the approved label, and
fallback generation still happens when references are invalid.

Use this test shape:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkflowArtifact } from "./stage-advancement.ts";
import type { IssueSummary } from "./types.ts";

const NOW = new Date("2026-07-04T09:00:00.000Z");

function issue(body: string, comments: string[] = []): IssueSummary {
  return {
    number: 65,
    title: "Resolve artifacts",
    body,
    labels: ["spec-approved", "plan-approved"],
    state: "open",
    author: "rochecompaan",
    updated: "2026-07-04T09:00:00Z",
    comments: comments.map((body) => ({ author: { login: "ana" }, body })),
  };
}

test("resolveWorkflowArtifact uses issue content after state and directory discovery", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-stage-"));
  const specsDir = join(repoRoot, "docs", "specs");
  await mkdir(specsDir, { recursive: true });
  await writeFile(join(repoRoot, "docs/specs/custom.md"), "# Spec\n", "utf8");

  const result = await resolveWorkflowArtifact({
    repoRoot,
    issue: issue("Approved spec: docs/specs/custom.md"),
    artifactKind: "spec",
    artifactDir: specsDir,
    approvedLabel: "spec-approved",
    labels: ["spec-approved"],
    findArtifact: async () => undefined,
    buildArtifact: () => join(specsDir, "generated.md"),
    now: NOW,
  });

  assert.equal(result.path, "docs/specs/custom.md");
  assert.equal(result.exists, true);
  assert.equal(result.generated, false);
  assert.equal(result.fromState, false);
});
```

- [ ] **Step 3: Run the focused stage tests and verify they fail before wiring**

Run:

```sh
node --test src/cli/commands/run-once/stage-advancement.test.ts
```

Expected: FAIL until `resolveWorkflowArtifact` accepts `artifactKind`,
`approvedLabel`, and `labels` and calls the issue-content resolver.

## Task 4: Wire Issue-Content Resolution into Stage Advancement

**Files:**

- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Test: `src/cli/commands/run-once/stage-advancement.test.ts`

- [ ] **Step 1: Import the resolver and extend resolution metadata**

Update imports and the result type:

```ts
import {
  resolveIssueContentArtifact,
  type WorkflowArtifactKind,
} from "./artifacts.ts";

type WorkflowArtifactResolution = {
  path?: string;
  commit?: string;
  exists: boolean;
  fromState: boolean;
  created: boolean;
  generated: boolean;
  source?: "state" | "directory" | "issue-content" | "generated";
};
```

- [ ] **Step 2: Add approved-label-gated issue-content lookup before fallback
      generation**

Inside `resolveWorkflowArtifact`, after `findArtifact` and before
`buildArtifact`, add:

```ts
if (options.labels.includes(options.approvedLabel)) {
  const issueContentArtifact = await resolveIssueContentArtifact({
    repoRoot: options.repoRoot,
    kind: options.artifactKind,
    body: options.issue.body,
    comments: options.issue.comments,
  });
  if (issueContentArtifact) {
    return {
      path: issueContentArtifact.path,
      exists: true,
      fromState: false,
      created: false,
      generated: false,
      source: "issue-content",
    };
  }
}
```

Also set `source: "state"`, `source: "directory"`, and `source: "generated"` in
the existing return branches.

- [ ] **Step 3: Pass kind, labels, and configured approved labels from
      `advancePlanningStages`**

Update all three resolver calls:

```ts
artifactKind: "plan",
approvedLabel: config.approvalPolicy.planApproval.approvedLabel,
labels,
```

for plan lookups, and:

```ts
artifactKind: "spec",
approvedLabel: config.approvalPolicy.specApproval.approvedLabel,
labels,
```

for spec lookups.

- [ ] **Step 4: Preserve independent spec and plan resolution**

Verify the spec resolver call still uses:

```ts
buildArtifact: preexistingPlan.exists ? undefined : buildSpecPath,
```

Do not infer `specPath` from a plan content reference. The existing pre-plan
shortcut may still skip spec creation only when a plan has been independently
resolved.

- [ ] **Step 5: Run focused tests**

Run:

```sh
node --test src/cli/commands/run-once/artifacts.test.ts src/cli/commands/run-once/stage-advancement.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit resolver wiring**

Run:

```sh
git add src/cli/commands/run-once/artifacts.ts src/cli/commands/run-once/artifacts.test.ts src/cli/commands/run-once/stage-advancement.ts src/cli/commands/run-once/stage-advancement.test.ts
git commit -m "feat: resolve approved workflow artifacts from issue content"
```

## Task 5: Add End-to-End Run-Once Pipeline Coverage

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Add a pipeline test for approved issue-content spec and plan
      references**

Append a test near existing spec/plan approval tests:

```ts
test("runOneIssue proceeds to implementation with approved artifacts referenced in issue content", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const specPath = "docs/specs/custom-approved-spec.md";
  const planPath = "docs/plans/custom-approved-plan.md";
  await writeFile(join(config.repoRoot, specPath), "# Spec\n", "utf8");
  await writeFile(join(config.repoRoot, planPath), "# Plan\n", "utf8");

  const selected = issue(
    65,
    ["spec-approved", "plan-approved", "enhancement"],
    "Custom artifact names",
  );
  selected.body = `Approved spec: \`${specPath}\``;
  selected.comments = [
    {
      author: { login: "ana" },
      body: `Approved plan artifact: [plan](${planPath})`,
    },
  ];

  const piPrompts: string[] = [];
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
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    )
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      piPrompts.push(prompt);
      assert.doesNotMatch(prompt, /Create a design spec/);
      assert.doesNotMatch(prompt, /Create an implementation plan/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/65",
          branch: "agent/issue-65-implementation",
          commits: ["123abc"],
          validation: ["npm test"],
          reviewSummary: "reviewed",
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.specPath, specPath);
  assert.equal(result.planPath, planPath);
  assert.equal(piPrompts.length, 1);
});
```

- [ ] **Step 2: Add fallback coverage for invalid issue-content references**

Add a smaller test asserting that an approved issue with
`Approved plan: https://example.test/plan.md` still invokes the plan-creation
prompt and returns `plan-created` under the existing mock pattern.

- [ ] **Step 3: Run targeted pipeline tests**

Run:

```sh
node --test src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit pipeline coverage**

Run:

```sh
git add src/cli/commands/run-once/pipeline.test.ts
git commit -m "test: cover issue-content workflow artifact reuse"
```

## Task 6: Document Approved Issue-Content Artifact References

**Files:**

- Modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Update the run-once planning workflow documentation**

Add this paragraph after the plan-approval paragraph:

```md
When the configured approved label is already present, `run-once` also scans the
issue body and comments as untrusted artifact source data before creating a new
spec or plan. References such as `Approved spec: docs/specs/custom.md`,
`Spec approved: \`docs/specs/custom.md\``, `Approved plan artifact:
[plan](docs/plans/custom.md)`, and Patchmill's `Existing plan ready:
\`docs/plans/custom.md\`` are eligible only when the referenced file exists
inside the repository. URLs, shell snippets, directories, missing files,
absolute paths outside the repository, and parent-directory escapes are ignored;
if no valid approved artifact is resolved, the existing generated-path fallback
and Pi creation behavior remains unchanged.
```

- [ ] **Step 2: Run documentation-adjacent targeted tests**

Run:

```sh
node --test src/cli/commands/run-once/artifacts.test.ts src/cli/commands/run-once/stage-advancement.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit documentation**

Run:

```sh
git add docs/issue-agent-workflows.md
git commit -m "docs: explain approved artifact discovery"
```

## Task 7: Final Validation and Regression Check

**Files:**

- Validate: `src/cli/commands/run-once/artifacts.test.ts`
- Validate: `src/cli/commands/run-once/stage-advancement.test.ts`
- Validate: `src/cli/commands/run-once/pipeline.test.ts`
- Validate: full repository test suite

- [ ] **Step 1: Run issue-specific targeted tests from the approved spec**

Run:

```sh
node --test src/cli/commands/run-once/artifacts.test.ts src/cli/commands/run-once/stage-advancement.test.ts src/cli/commands/run-once/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run:

```sh
npm test
```

Expected: PASS.

- [ ] **Step 3: Decide whether Nix verification is required**

If `package.json`, `package-lock.json`, or `npm-shrinkwrap.json` changed, run:

```sh
nix build
```

Expected: PASS. If no npm dependency metadata changed, record:
`Nix build not required; no npm dependency metadata changed.`

- [ ] **Step 4: Commit any final test fixes**

If validation required code/test fixes, commit them:

```sh
git add src/cli/commands/run-once docs/issue-agent-workflows.md
git commit -m "fix: stabilize approved artifact discovery"
```

If no fixes were needed, do not create an empty commit.
