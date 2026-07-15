# Blocked Implementation Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `patchmill run-once --issue N` continue a clean blocked
implementation workspace instead of restarting at spec or plan creation.

**Architecture:** Treat a saved clean implementation worktree as the artifact
lookup root during resume, while keeping the primary checkout as a compatibility
fallback. Persist deterministic blocker context in run state so resumed
implementation prompts can focus on the prior blocker. Prevent generated
planning target paths from replacing saved artifact state before a creation
prompt succeeds.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing Patchmill
run-once pipeline modules, JSON run state files, Git worktree recovery helpers.

## Global Constraints

- Keep `patchmill run-once --issue N` as the resume entry point.
- Do not continue from dirty saved worktrees.
- Do not weaken existing blocked-run recovery checks for dirty, missing,
  diverged, or already-merged workspaces.
- Do not bypass visual evidence, validation, landing, or PR handoff
  requirements.
- Do not infer durable recovery state from JSONL logs.
- Prefer automated run-once regression tests for behavior changes.
- Keep generated artifact target paths out of durable run-state fields until the
  artifact creation prompt succeeds.

---

## File structure

- `src/cli/commands/run-once/planning-artifacts.ts`
  - New focused resolver for planning artifact policy.
  - Own root ordering, explicit artifact consistency checks, required saved-plan
    rules, and durable-vs-generated path semantics.
- `src/cli/commands/run-once/planning-artifacts.test.ts`
  - Unit-test saved implementation resume artifact authority and fresh-run
    artifact precedence.
- `src/cli/commands/run-once/stage-advancement.ts`
  - Owns spec and plan creation decisions after artifact policy has resolved
    candidate paths.
  - Delegate artifact lookup and safety policy to `planning-artifacts.ts`.
  - Delay run-state writes for generated artifact target paths until Pi reports
    success.
- `src/cli/commands/run-once/pipeline.ts`
  - Owns resume classification, saved worktree recovery, and implementation
    prompt assembly.
  - Build the resume artifact lookup options after saved worktree recovery
    succeeds.
  - Pass prior blocker context into the implementation prompt.
  - Persist blocker commits, validation, and questions when Pi returns
    `blocked`.
- `src/cli/commands/run-once/prompts.ts`
  - Owns implementation prompt text.
  - Extend resume context rendering with prior blocker reason, questions, and
    validation.
- `src/cli/commands/run-once/run-state.ts`
  - Owns durable run-state merge behavior.
  - Add `blockerQuestions` merge and cleanup behavior.
- `src/cli/commands/run-once/types.ts`
  - Add run-state and resume-context fields used by pipeline and prompts.
- `src/cli/commands/run-once/pipeline.test.ts`
  - Add integration regressions for saved-worktree artifact resolution, missing
    saved plan safety, blocker context persistence, and generated-path clobber
    prevention.

---

### Task 1: Extract planning artifact policy and resolve saved worktree artifacts

**Files:**

- Create: `src/cli/commands/run-once/planning-artifacts.ts`
- Create: `src/cli/commands/run-once/planning-artifacts.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`

**Interfaces:**

- Consumes: existing `writeBlockedRecoveryRunState()`,
  `blockedRecoveryRunner()`, `advancePlanningStages()`,
  `ResolvedIssueArtifactSources`, `findIssueSpec()`, `findIssuePlan()`,
  `buildSpecPath()`, and `buildPlanPath()`.
- Produces: `PlanningArtifactPolicy`, `ResolvedPlanningArtifacts`, and
  `resolvePlanningArtifacts()` in `planning-artifacts.ts`.
  `stage-advancement.ts` consumes the resolved artifacts and no longer owns
  resume-specific artifact policy.

- [ ] **Step 1: Extend blocked recovery test setup to place artifacts in the
      saved worktree**

In `src/cli/commands/run-once/pipeline.test.ts`, replace the
`writeBlockedRecoveryRunState()` options type and initial artifact writes with
this code:

```ts
async function writeBlockedRecoveryRunState(
  config: AgentIssueConfig,
  overrides: Parameters<typeof writeRunState>[1] = {
    issueNumber: 45,
    status: "blocked",
  },
  options: {
    createWorktreePath?: boolean;
    writePlanInPrimaryRepo?: boolean;
    writeSpecInPrimaryRepo?: boolean;
    writePlanInWorktree?: boolean;
    writeSpecInWorktree?: boolean;
  } = {},
): Promise<void> {
  const planPath =
    overrides.planPath ??
    "docs/plans/2026-06-20-issue-45-recover-blocked-run.md";
  const specPath =
    overrides.specPath ??
    "docs/specs/2026-06-20-issue-45-recover-blocked-run.md";
  const worktreePath =
    overrides.worktreePath ??
    ".worktrees/patchmill-issue-45-recover-blocked-run";
  const worktreeRoot = join(config.repoRoot, worktreePath);

  if (options.writePlanInPrimaryRepo !== false) {
    await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  }
  if (options.writeSpecInPrimaryRepo === true) {
    await writeFile(join(config.repoRoot, specPath), "# spec\n", "utf8");
  }

  if (options.createWorktreePath !== false) {
    await mkdir(worktreeRoot, { recursive: true });
  }
  if (options.writePlanInWorktree) {
    await mkdir(join(worktreeRoot, "docs", "plans"), { recursive: true });
    await writeFile(join(worktreeRoot, planPath), "# worktree plan\n", "utf8");
  }
  if (options.writeSpecInWorktree) {
    await mkdir(join(worktreeRoot, "docs", "specs"), { recursive: true });
    await writeFile(join(worktreeRoot, specPath), "# worktree spec\n", "utf8");
  }

  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Recover blocked run",
      status: "blocked",
      specPath,
      specCommit: "spec123",
      planPath,
      planCommit: "plan123",
      branch: "agent/issue-45-recover-blocked-run",
      worktreePath,
      commits: ["abc123", "def456"],
      validation: ["formatting passed", "verification environment unavailable"],
      failureCommentKeys: ["blocked:verification"],
      lastError: "Required verification environment is unavailable.",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        specPathResolved: true,
        planPathResolved: true,
        worktreeReady: true,
      },
      ...overrides,
    },
    NOW.toISOString(),
  );
}
```

- [ ] **Step 2: Add the failing saved-worktree integration test**

Add this test after the existing
`runOneIssue resumes clean blocked implementation workspace after external prerequisite is fixed`
test:

```ts
test("runOneIssue resolves blocked resume artifacts from saved worktree", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config, undefined, {
    writePlanInPrimaryRepo: false,
    writeSpecInPrimaryRepo: false,
    writePlanInWorktree: true,
    writeSpecInWorktree: true,
  });

  const worktreeRoot = join(
    config.repoRoot,
    ".worktrees/patchmill-issue-45-recover-blocked-run",
  );
  let implementationPrompt = "";
  const piPromptKinds: string[] = [];
  const runner = blockedRecoveryRunner(config, {
    onPi(prompt) {
      if (/Create a design spec/.test(prompt)) piPromptKinds.push("spec");
      if (/Create an implementation plan/.test(prompt))
        piPromptKinds.push("plan");
      if (/Implement issue/.test(prompt)) piPromptKinds.push("implementation");
      implementationPrompt = prompt;
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/45",
          branch: "agent/issue-45-recover-blocked-run",
          commits: ["abc123", "def456", "789abc"],
          validation: ["verification passed"],
          reviewSummary: "reviewed",
        }),
        stderr: "",
      };
    },
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.deepEqual(piPromptKinds, ["implementation"]);
  const piCall = workflowPiCalls(runner.calls).at(-1);
  assert.equal(piCall?.cwd, worktreeRoot);
  assert.match(implementationPrompt, /Resume context:/);
  assert.match(
    implementationPrompt,
    /Existing commit: def456 add verification/,
  );
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(
    state.specPath,
    "docs/specs/2026-06-20-issue-45-recover-blocked-run.md",
  );
  assert.equal(
    state.planPath,
    "docs/plans/2026-06-20-issue-45-recover-blocked-run.md",
  );
});
```

- [ ] **Step 3: Add resolver unit tests for saved artifact authority**

Create `src/cli/commands/run-once/planning-artifacts.test.ts` with these tests:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolvePlanningArtifacts,
  type PlanningArtifactPolicy,
} from "./planning-artifacts.ts";
import type { IssueSummary } from "./types.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

function issue(number: number): IssueSummary {
  return {
    number,
    title: "Recover blocked run",
    body: "Body",
    labels: ["needs-info"],
    state: "open",
    author: "tester",
    updated: "2026-05-09T11:00:00Z",
    comments: [],
  };
}

async function repoFixture(): Promise<{
  repoRoot: string;
  worktreeRoot: string;
  policy: PlanningArtifactPolicy;
}> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifacts-"));
  const worktreeRoot = join(repoRoot, ".worktrees", "patchmill-issue-45");
  await mkdir(join(worktreeRoot, "docs", "plans"), { recursive: true });
  await mkdir(join(worktreeRoot, "docs", "specs"), { recursive: true });
  await writeFile(
    join(worktreeRoot, "docs/plans/saved-plan.md"),
    "# Saved plan\n",
    "utf8",
  );
  await writeFile(
    join(worktreeRoot, "docs/specs/saved-spec.md"),
    "# Saved spec\n",
    "utf8",
  );
  return {
    repoRoot,
    worktreeRoot,
    policy: {
      kind: "implementation-resume",
      primary: {
        repoRoot: worktreeRoot,
        specsDir: join(worktreeRoot, "docs", "specs"),
        plansDir: join(worktreeRoot, "docs", "plans"),
        source: "resume-worktree",
      },
      fallbacks: [
        {
          repoRoot,
          specsDir: join(repoRoot, "docs", "specs"),
          plansDir: join(repoRoot, "docs", "plans"),
          source: "primary-repo",
        },
      ],
      saved: {
        specPath: "docs/specs/saved-spec.md",
        specCommit: "spec123",
        planPath: "docs/plans/saved-plan.md",
        planCommit: "plan123",
      },
    },
  };
}

test("implementation resume uses saved artifacts before explicit comments", async () => {
  const { policy } = await repoFixture();

  const artifacts = await resolvePlanningArtifacts({
    policy: {
      ...policy,
      explicit: {
        plan: {
          path: "docs/plans/saved-plan.md",
          commit: "plan123",
        },
      },
    },
    issue: issue(45),
    now: NOW,
  });

  assert.equal(artifacts.plan.path, "docs/plans/saved-plan.md");
  assert.equal(artifacts.plan.fromState, true);
});

test("implementation resume rejects mismatched explicit artifact comments", async () => {
  const { policy } = await repoFixture();

  await assert.rejects(
    () =>
      resolvePlanningArtifacts({
        policy: {
          ...policy,
          explicit: {
            plan: {
              path: "docs/plans/unrelated-plan.md",
              commit: "other123",
            },
          },
        },
        issue: issue(45),
        now: NOW,
      }),
    /Explicit plan artifact docs\/plans\/unrelated-plan\.md does not match saved plan docs\/plans\/saved-plan\.md/,
  );
});
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run:

```bash
node --test src/cli/commands/run-once/planning-artifacts.test.ts src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "saved artifacts|saved worktree"
```

Expected: FAIL because `planning-artifacts.ts` does not exist and the pipeline
still resolves artifacts in the main checkout.

- [ ] **Step 5: Create the dedicated planning artifact resolver module**

Create `src/cli/commands/run-once/planning-artifacts.ts`. Include these exported
interfaces:

```ts
import { isAbsolute, join, relative } from "node:path";
import type { ResolvedIssueArtifactSources } from "./artifact-sources.ts";
import { pathExists } from "./paths.ts";
import { buildPlanPath, findIssuePlan } from "./plans.ts";
import { buildSpecPath, findIssueSpec } from "./specs.ts";
import type { IssueSummary } from "./types.ts";

export type PlanningArtifactRoot = {
  repoRoot: string;
  specsDir: string;
  plansDir: string;
  source: "primary-repo" | "resume-worktree";
};

export type ResolvedPlanningArtifact = {
  path?: string;
  commit?: string;
  exists: boolean;
  fromState: boolean;
  created: boolean;
  generated: boolean;
  rootSource?: PlanningArtifactRoot["source"];
};

export type PlanningArtifactPolicy =
  | {
      kind: "fresh";
      primary: PlanningArtifactRoot;
      fallbacks?: PlanningArtifactRoot[];
      explicit?: ResolvedIssueArtifactSources;
      allowGeneratedSpec: boolean;
      allowGeneratedPlan: boolean;
    }
  | {
      kind: "implementation-resume";
      primary: PlanningArtifactRoot;
      fallbacks: PlanningArtifactRoot[];
      saved: {
        specPath?: string;
        specCommit?: string;
        planPath?: string;
        planCommit?: string;
        specCreated?: boolean;
        planCreated?: boolean;
      };
      explicit?: ResolvedIssueArtifactSources;
    };

export type ResolvedPlanningArtifacts = {
  spec: ResolvedPlanningArtifact;
  plan: ResolvedPlanningArtifact;
};
```

Then add helpers that search roots and enforce explicit artifact consistency:

```ts
function repoPath(
  repoRoot: string,
  path: string,
): { absolute: string; relative: string } {
  if (isAbsolute(path)) {
    return { absolute: path, relative: relative(repoRoot, path) };
  }

  return { absolute: join(repoRoot, path), relative: path };
}

function promptBodyPath(
  repoRoot: string,
  absoluteArtifactPath: string,
): string {
  return relative(repoRoot, absoluteArtifactPath);
}

function roots(policy: PlanningArtifactPolicy): PlanningArtifactRoot[] {
  return [policy.primary, ...(policy.fallbacks ?? [])];
}

function explicitMatchesSaved(input: {
  kind: "spec" | "plan";
  explicit?: { path: string; commit?: string };
  savedPath?: string;
  savedCommit?: string;
}): void {
  if (!input.explicit || !input.savedPath) return;
  if (input.explicit.path !== input.savedPath) {
    throw new Error(
      `Explicit ${input.kind} artifact ${input.explicit.path} does not match saved ${input.kind} ${input.savedPath}`,
    );
  }
  if (
    input.explicit.commit &&
    input.savedCommit &&
    input.explicit.commit !== input.savedCommit
  ) {
    throw new Error(
      `Explicit ${input.kind} artifact commit ${input.explicit.commit} does not match saved ${input.kind} commit ${input.savedCommit}`,
    );
  }
}
```

Add resolver functions with this behavior:

```ts
async function findSaved(input: {
  roots: PlanningArtifactRoot[];
  kind: "spec" | "plan";
  savedPath?: string;
  savedCommit?: string;
  savedCreated?: boolean;
}): Promise<ResolvedPlanningArtifact> {
  if (!input.savedPath) {
    return {
      exists: false,
      fromState: false,
      created: false,
      generated: false,
    };
  }

  for (const root of input.roots) {
    const savedPath = repoPath(root.repoRoot, input.savedPath);
    if (await pathExists(savedPath.absolute)) {
      return {
        path: savedPath.relative,
        commit: input.savedCommit,
        exists: true,
        fromState: true,
        created: input.savedCreated === true,
        generated: false,
        rootSource: root.source,
      };
    }
  }

  return {
    path: input.savedPath,
    commit: input.savedCommit,
    exists: false,
    fromState: true,
    created: input.savedCreated === true,
    generated: false,
  };
}

async function findDiscovered(input: {
  roots: PlanningArtifactRoot[];
  issue: IssueSummary;
  kind: "spec" | "plan";
}): Promise<ResolvedPlanningArtifact> {
  for (const root of input.roots) {
    const artifactDir = input.kind === "spec" ? root.specsDir : root.plansDir;
    const found =
      input.kind === "spec"
        ? await findIssueSpec(artifactDir, input.issue.number)
        : await findIssuePlan(artifactDir, input.issue.number);
    if (found) {
      return {
        path: repoPath(root.repoRoot, found).relative,
        exists: true,
        fromState: false,
        created: false,
        generated: false,
        rootSource: root.source,
      };
    }
  }

  return { exists: false, fromState: false, created: false, generated: false };
}

function generated(input: {
  policy: Extract<PlanningArtifactPolicy, { kind: "fresh" }>;
  issue: IssueSummary;
  kind: "spec" | "plan";
  now: Date;
}): ResolvedPlanningArtifact {
  const allowed =
    input.kind === "spec"
      ? input.policy.allowGeneratedSpec
      : input.policy.allowGeneratedPlan;
  if (!allowed) {
    return {
      exists: false,
      fromState: false,
      created: false,
      generated: false,
    };
  }

  const artifactDir =
    input.kind === "spec"
      ? input.policy.primary.specsDir
      : input.policy.primary.plansDir;
  const path =
    input.kind === "spec"
      ? buildSpecPath(
          artifactDir,
          input.issue.number,
          input.issue.title,
          input.now,
        )
      : buildPlanPath(
          artifactDir,
          input.issue.number,
          input.issue.title,
          input.now,
        );
  return {
    path: promptBodyPath(input.policy.primary.repoRoot, path),
    exists: false,
    fromState: false,
    created: false,
    generated: true,
    rootSource: input.policy.primary.source,
  };
}
```

Finally export `resolvePlanningArtifacts()`:

```ts
export async function resolvePlanningArtifacts(input: {
  policy: PlanningArtifactPolicy;
  issue: IssueSummary;
  now: Date;
}): Promise<ResolvedPlanningArtifacts> {
  const policyRoots = roots(input.policy);

  if (input.policy.kind === "implementation-resume") {
    explicitMatchesSaved({
      kind: "spec",
      explicit: input.policy.explicit?.spec,
      savedPath: input.policy.saved.specPath,
      savedCommit: input.policy.saved.specCommit,
    });
    explicitMatchesSaved({
      kind: "plan",
      explicit: input.policy.explicit?.plan,
      savedPath: input.policy.saved.planPath,
      savedCommit: input.policy.saved.planCommit,
    });

    const spec = (await findSaved({
      roots: policyRoots,
      kind: "spec",
      savedPath: input.policy.saved.specPath,
      savedCommit: input.policy.saved.specCommit,
      savedCreated: input.policy.saved.specCreated,
    })) ?? {
      exists: false,
      fromState: false,
      created: false,
      generated: false,
    };
    const plan = await findSaved({
      roots: policyRoots,
      kind: "plan",
      savedPath: input.policy.saved.planPath,
      savedCommit: input.policy.saved.planCommit,
      savedCreated: input.policy.saved.planCreated,
    });

    const resolvedPlan = plan.exists
      ? plan
      : input.policy.saved.planPath
        ? plan
        : await findDiscovered({
            roots: policyRoots,
            issue: input.issue,
            kind: "plan",
          });
    const resolvedSpec = spec.exists
      ? spec
      : input.policy.saved.specPath
        ? spec
        : await findDiscovered({
            roots: policyRoots,
            issue: input.issue,
            kind: "spec",
          });

    if (input.policy.saved.planPath && !resolvedPlan.exists) {
      throw new Error(
        `Saved plan ${input.policy.saved.planPath} was not found in the saved resume workspace or fallback repository`,
      );
    }

    return { spec: resolvedSpec, plan: resolvedPlan };
  }

  const explicitSpec = input.policy.explicit?.spec;
  const explicitPlan = input.policy.explicit?.plan;
  const discoveredPlan = explicitPlan
    ? {
        path: explicitPlan.path,
        commit: explicitPlan.commit,
        exists: true,
        fromState: false,
        created: false,
        generated: false,
      }
    : await findDiscovered({
        roots: policyRoots,
        issue: input.issue,
        kind: "plan",
      });
  const discoveredSpec = explicitSpec
    ? {
        path: explicitSpec.path,
        commit: explicitSpec.commit,
        exists: true,
        fromState: false,
        created: false,
        generated: false,
      }
    : await findDiscovered({
        roots: policyRoots,
        issue: input.issue,
        kind: "spec",
      });

  return {
    spec: discoveredSpec.exists
      ? discoveredSpec
      : generated({
          policy: input.policy,
          issue: input.issue,
          kind: "spec",
          now: input.now,
        }),
    plan: discoveredPlan.exists
      ? discoveredPlan
      : generated({
          policy: input.policy,
          issue: input.issue,
          kind: "plan",
          now: input.now,
        }),
  };
}
```

- [ ] **Step 6: Refactor `stage-advancement.ts` to consume the resolver**

In `src/cli/commands/run-once/stage-advancement.ts`, remove the local
`WorkflowArtifactResolution`, `repoPath()`, `promptBodyPath()`, and
`resolveWorkflowArtifact()` definitions. Import the new resolver types:

```ts
import {
  resolvePlanningArtifacts,
  type PlanningArtifactPolicy,
} from "./planning-artifacts.ts";
```

Add this option to `AdvancePlanningStagesOptions`:

```ts
  artifactPolicy?: PlanningArtifactPolicy;
```

At the start of `advancePlanningStages()`, build the policy and resolve
artifacts:

```ts
const artifactPolicyForRun = artifactPolicy ?? {
  kind: "fresh" as const,
  primary: {
    repoRoot: config.repoRoot,
    specsDir: config.specsDir,
    plansDir: config.plansDir,
    source: "primary-repo" as const,
  },
  explicit: resolvedArtifacts,
  allowGeneratedSpec: true,
  allowGeneratedPlan: true,
};
const planningArtifacts = await resolvePlanningArtifacts({
  policy: artifactPolicyForRun,
  issue,
  now,
});
const preexistingPlan = planningArtifacts.plan;
```

Replace the old spec resolution call with:

```ts
const spec = planningArtifacts.spec;
```

Replace the later plan resolution call with:

```ts
const plan = preexistingPlan.path ? preexistingPlan : planningArtifacts.plan;
```

Keep the existing spec/plan creation branches, but they now consume `spec` and
`plan` from the dedicated resolver.

- [ ] **Step 7: Build the implementation-resume policy in the pipeline**

In `src/cli/commands/run-once/pipeline.ts`, update the import from `node:path`:

```ts
import { isAbsolute, join, relative } from "node:path";
```

Import the policy type:

```ts
import type { PlanningArtifactPolicy } from "./planning-artifacts.ts";
```

Add these helpers near `configuredWorktreeStrategy()`:

```ts
function configuredPathRelativeToRepo(repoRoot: string, path: string): string {
  return isAbsolute(path) ? relative(repoRoot, path) : path;
}

function mirrorConfiguredPathInWorktree(
  repoRoot: string,
  worktreeRoot: string,
  path: string,
): string {
  return join(worktreeRoot, configuredPathRelativeToRepo(repoRoot, path));
}

function resumePlanningArtifactPolicy(input: {
  config: Pick<AgentIssueConfig, "repoRoot" | "specsDir" | "plansDir">;
  worktreePath: string;
  existingState: NonNullable<Awaited<ReturnType<typeof readRunState>>>;
  resolvedArtifacts: ResolvedIssueArtifactSources;
}): PlanningArtifactPolicy {
  const worktreeRoot = join(input.config.repoRoot, input.worktreePath);
  return {
    kind: "implementation-resume",
    primary: {
      repoRoot: worktreeRoot,
      specsDir: mirrorConfiguredPathInWorktree(
        input.config.repoRoot,
        worktreeRoot,
        input.config.specsDir,
      ),
      plansDir: mirrorConfiguredPathInWorktree(
        input.config.repoRoot,
        worktreeRoot,
        input.config.plansDir,
      ),
      source: "resume-worktree",
    },
    fallbacks: [
      {
        repoRoot: input.config.repoRoot,
        specsDir: input.config.specsDir,
        plansDir: input.config.plansDir,
        source: "primary-repo",
      },
    ],
    saved: {
      specPath: input.existingState.specPath,
      specCommit: input.existingState.specCommit,
      planPath: input.existingState.planPath,
      planCommit: input.existingState.planCommit,
      specCreated: input.existingState.checkpoints?.specCreated,
      planCreated: input.existingState.checkpoints?.planCreated,
    },
    explicit: input.resolvedArtifacts,
  };
}
```

Inside `runOneIssue()`, after `ensureIssueWorkspace` is declared and before the
`try` block, add:

```ts
let artifactPolicy: PlanningArtifactPolicy | undefined;
```

Inside the `try` block, before calling `advancePlanningStages()`, add:

```ts
if (resumableState && (existingState?.branch || existingState?.worktreePath)) {
  const resumeWorktree = await ensureIssueWorkspace();
  const savedWorktreePath =
    existingState?.worktreePath ?? resumeWorktree.worktreePath;
  artifactPolicy = resumePlanningArtifactPolicy({
    config,
    worktreePath: savedWorktreePath,
    existingState,
    resolvedArtifacts,
  });
  await progress(
    options,
    "info",
    "resume",
    `reusing saved worktree for artifact lookup: ${savedWorktreePath}`,
    { issueNumber: issue.number },
  );
}
```

Pass the policy into `advancePlanningStages()`:

```ts
      artifactPolicy,
```

- [ ] **Step 8: Run the targeted regression and resolver tests**

Run:

```bash
node --test src/cli/commands/run-once/planning-artifacts.test.ts src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "saved artifacts|saved worktree"
```

Expected: PASS. The saved-worktree integration test should make only one Pi
call: the implementation prompt.

- [ ] **Step 9: Run existing blocked recovery tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "blocked recovery"
```

Expected: PASS. Existing dirty, missing, already-merged, and clean blocked
recovery behavior remains intact.

- [ ] **Step 10: Commit Task 1**

```bash
git add src/cli/commands/run-once/planning-artifacts.ts src/cli/commands/run-once/planning-artifacts.test.ts src/cli/commands/run-once/pipeline.test.ts src/cli/commands/run-once/stage-advancement.ts src/cli/commands/run-once/pipeline.ts
git commit -m "fix(run-once): resolve blocked resume artifacts by policy"
```

---

### Task 2: Preserve fresh artifact-source behavior and missing saved-plan safety

**Files:**

- Modify: `src/cli/commands/run-once/planning-artifacts.test.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify: `src/cli/commands/run-once/planning-artifacts.ts`

**Interfaces:**

- Consumes: `PlanningArtifactPolicy` and `resolvePlanningArtifacts()` from
  Task 1.
- Produces: explicit tests proving fresh runs still prefer validated artifact
  comments, while implementation resumes reject missing saved plans before Pi.

- [ ] **Step 1: Add a fresh-run explicit artifact unit test**

Append this test to `src/cli/commands/run-once/planning-artifacts.test.ts`:

```ts
test("fresh policy accepts explicit artifact comments before discovery", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-artifacts-"));
  const artifacts = await resolvePlanningArtifacts({
    policy: {
      kind: "fresh",
      primary: {
        repoRoot,
        specsDir: join(repoRoot, "docs", "specs"),
        plansDir: join(repoRoot, "docs", "plans"),
        source: "primary-repo",
      },
      explicit: {
        spec: { path: "docs/specs/published-spec.md", commit: "specpub" },
        plan: { path: "docs/plans/published-plan.md", commit: "planpub" },
      },
      allowGeneratedSpec: true,
      allowGeneratedPlan: true,
    },
    issue: issue(65),
    now: NOW,
  });

  assert.equal(artifacts.spec.path, "docs/specs/published-spec.md");
  assert.equal(artifacts.spec.commit, "specpub");
  assert.equal(artifacts.plan.path, "docs/plans/published-plan.md");
  assert.equal(artifacts.plan.commit, "planpub");
});
```

- [ ] **Step 2: Add the missing saved plan integration test**

Add this test near the blocked recovery tests in
`src/cli/commands/run-once/pipeline.test.ts`:

```ts
test("runOneIssue reports missing saved plan before blocked resume mutations", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config, undefined, {
    writePlanInPrimaryRepo: false,
    writeSpecInPrimaryRepo: false,
    writePlanInWorktree: false,
    writeSpecInWorktree: true,
  });
  const runner = blockedRecoveryRunner(config);

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved plan docs\/plans\/2026-06-20-issue-45-recover-blocked-run\.md was not found in the saved resume workspace or fallback repository/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(state.status, "blocked");
  assert.equal(
    state.planPath,
    "docs/plans/2026-06-20-issue-45-recover-blocked-run.md",
  );
  assert.equal(
    state.worktreePath,
    ".worktrees/patchmill-issue-45-recover-blocked-run",
  );
});
```

- [ ] **Step 3: Run the policy tests**

Run:

```bash
node --test src/cli/commands/run-once/planning-artifacts.test.ts src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "explicit artifact|missing saved plan"
```

Expected: PASS. Fresh policy accepts explicit artifact comments; implementation
resume rejects missing saved plans before Pi.

- [ ] **Step 4: Run the existing deterministic artifact integration test**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "deterministic published artifacts"
```

Expected: PASS. Fresh and approval-stage workflows still use validated published
artifact comments before filename discovery.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/cli/commands/run-once/planning-artifacts.test.ts src/cli/commands/run-once/pipeline.test.ts src/cli/commands/run-once/planning-artifacts.ts
git commit -m "test(run-once): cover planning artifact policy boundaries"
```

---

### Task 3: Persist and render prior blocker context

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/run-state.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

**Interfaces:**

- Consumes: `AgentIssueBlockedResult.reason`, `questions`, `commits`, and
  `validation`.
- Produces: `AgentIssueRunState.blockerQuestions` and extended
  `AgentIssueImplementationResumeContext` fields.

- [ ] **Step 1: Add a failing persistence assertion for deterministic blockers**

In the existing test
`runOneIssue marks deterministic blockers as needs-info without restoring agent-ready`,
extend the final run-state assertions with:

```ts
assert.deepEqual(runState.commits, ["789fed"]);
assert.deepEqual(runState.validation, ["tests not run"]);
assert.deepEqual(runState.blockerQuestions, [
  {
    question: "Which API should own the runner output?",
    recommendedAnswer:
      "Keep ownership in the existing triage package to avoid duplicating adapters.",
  },
]);
```

- [ ] **Step 2: Add prompt assertions to the saved-worktree resume test**

In the test added in Task 1, after the `Resume context` assertion, add:

```ts
assert.match(
  implementationPrompt,
  /Prior blocker reason: Required verification environment is unavailable\./,
);
assert.match(implementationPrompt, /Prior validation: formatting passed/);
assert.match(
  implementationPrompt,
  /Prior validation: verification environment unavailable/,
);
```

- [ ] **Step 3: Run the context tests to verify they fail**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "deterministic blockers|saved worktree"
```

Expected: FAIL because blocker questions are not stored and resume prompts do
not include prior blocker details.

- [ ] **Step 4: Extend run-state and resume-context types**

In `src/cli/commands/run-once/types.ts`, add `blockerQuestions` to
`AgentIssueRunState`:

```ts
  blockerQuestions?: AgentIssueBlockerQuestion[];
```

Add the same field to `AgentIssueRunStateUpdate`:

```ts
  blockerQuestions?: AgentIssueBlockerQuestion[];
```

Replace `AgentIssueImplementationResumeContext` with:

```ts
export type AgentIssueImplementationResumeContext = {
  resumed: boolean;
  worktreeCreated: boolean;
  existingCommits: string[];
  priorBlockerReason?: string;
  priorBlockerQuestions?: AgentIssueBlockerQuestion[];
  priorValidation?: string[];
};
```

- [ ] **Step 5: Merge blocker questions in run state**

In `src/cli/commands/run-once/run-state.ts`, add this helper near
`mergeUniqueKeys()`:

```ts
function blockerQuestionsUpdate(
  existing: AgentIssueRunState["blockerQuestions"],
  update: AgentIssueRunStateUpdate["blockerQuestions"],
): AgentIssueRunState["blockerQuestions"] {
  return update ?? existing;
}
```

Inside `mergeRunState()`, after `failureCommentKeys` is computed, add:

```ts
const blockerQuestions = blockerQuestionsUpdate(
  update.resetCheckpoints ? undefined : existing?.blockerQuestions,
  update.blockerQuestions,
);
```

Add `blockerQuestions` to the `next` object:

```ts
    blockerQuestions,
```

Add cleanup after the existing `failureCommentKeys` cleanup block:

```ts
if (blockerQuestions === undefined) {
  delete next.blockerQuestions;
}
```

- [ ] **Step 6: Persist blocker context from `blockIssue()`**

In `src/cli/commands/run-once/pipeline.ts`, update the `writeRunState()` call
inside `blockIssue()` to include:

```ts
      commits: result.commits,
      validation: result.validation,
      blockerQuestions: result.questions,
```

Keep the existing `lastError: result.reason` line.

- [ ] **Step 7: Pass prior blocker details into the implementation prompt**

In `src/cli/commands/run-once/pipeline.ts`, update the `resume` object passed to
`buildImplementationPrompt()`:

```ts
            resume: {
              resumed: resumableState,
              worktreeCreated: worktree.created,
              existingCommits: worktree.existingCommits,
              priorBlockerReason: existingState?.lastError,
              priorBlockerQuestions: existingState?.blockerQuestions,
              priorValidation: existingState?.validation,
            },
```

- [ ] **Step 8: Render blocker context in the resume prompt**

In `src/cli/commands/run-once/prompts.ts`, add this helper near
`formatResumeContext()`:

```ts
function formatResumeQuestion(question: AgentIssueBlockerQuestion): string {
  return typeof question === "string"
    ? question
    : `${question.question}${question.recommendedAnswer ? ` Recommended: ${question.recommendedAnswer}` : ""}`;
}
```

Update the `formatResumeContext()` return body so it includes prior blocker
lines:

```ts
const priorBlocker = resume.priorBlockerReason
  ? [`- Prior blocker reason: ${resume.priorBlockerReason}`]
  : [];
const priorQuestions = (resume.priorBlockerQuestions ?? []).map(
  (question) => `- Prior blocker question: ${formatResumeQuestion(question)}`,
);
const priorValidation = (resume.priorValidation ?? []).map(
  (entry) => `- Prior validation: ${entry}`,
);

return [
  "Resume context:",
  "- Continue from current branch state.",
  `- Worktree ${resume.worktreeCreated ? "was created/recreated during this run" : "was reused from the prior run"}.`,
  existingCommits,
  ...priorBlocker,
  ...priorQuestions,
  ...priorValidation,
  "",
].join("\n");
```

Also add `AgentIssueBlockerQuestion` to the type imports at the top of
`prompts.ts`.

- [ ] **Step 9: Run blocker context tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "deterministic blockers|saved worktree"
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/cli/commands/run-once/types.ts src/cli/commands/run-once/run-state.ts src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/pipeline.test.ts
git commit -m "fix(run-once): carry blocker context into resumes"
```

---

### Task 4: Avoid generated artifact path clobber before creation succeeds

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.test.ts`
- Modify: `src/cli/commands/run-once/stage-advancement.ts`
- Modify: `src/cli/commands/run-once/pipeline.ts`

**Interfaces:**

- Consumes: `WorkflowArtifactResolution.generated` from existing stage code.
- Produces: run-state writes that persist existing or successfully created
  artifact paths, not pre-success generated target paths.

- [ ] **Step 1: Add the generated spec path failure test**

Add this test near the unexpected planning failure tests in
`src/cli/commands/run-once/pipeline.test.ts`:

```ts
test("runOneIssue does not persist generated spec path when spec creation fails", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    64,
    ["agent-ready", "bug"],
    "Fail before generated spec exists",
  );
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create a design spec/);
      return { code: 1, stdout: "", stderr: "spec model unavailable" };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /spec model unavailable/);
  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 64), "utf8"),
  );
  assert.equal(runState.specPath, undefined);
  assert.equal(runState.planPath, undefined);
  assert.equal(runState.branch, undefined);
  assert.equal(runState.worktreePath, undefined);
});
```

- [ ] **Step 2: Update the existing unexpected planning failure expectation**

In the test
`runOneIssue records and comments unexpected planning failures without replacing in-progress`,
change the plan-path assertion to:

```ts
assert.equal(runState.planPath, undefined);
```

Keep the existing `status` and `lastError` assertions.

- [ ] **Step 3: Run planning failure tests to verify they fail**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "planning failure|generated spec path"
```

Expected: FAIL because generated target paths are still persisted before prompt
success.

- [ ] **Step 4: Stop persisting generated spec paths before success**

In `src/cli/commands/run-once/stage-advancement.ts`, change the first spec
run-state write guard from:

```ts
  if (specPath) {
```

to:

```ts
  if (specPath && !spec.generated) {
```

Keep the body of the write unchanged. This means existing saved or discovered
specs are still persisted immediately, while generated target paths are only
persisted after `spec-created` returns.

- [ ] **Step 5: Stop persisting generated plan paths before success**

In the plan resolution section, replace the unconditional plan-path run-state
write with:

```ts
if (!plan.generated) {
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: issue.number,
      status: "planning",
      specPath,
      specCommit,
      planPath,
      checkpoints: {
        planPathResolved: true,
        ...(planCreated ? { planCreated: true } : {}),
      },
    },
    timestamp,
  );
  checkpoints.planPathResolved = true;
  if (planCreated) checkpoints.planCreated = true;
}
```

Leave the later successful `plan-created` write in place. That later write
records `planPath`, `planCommit`, and `planCreated` after Pi succeeds.

- [ ] **Step 6: Confirm unexpected failures only see durable paths**

Do not change `pipeline.ts` for this task. The `specPath` and `planPath` locals
in `pipeline.ts` are assigned only after `advancePlanningStages()` returns
`kind: "continue"`. When generated artifact creation fails inside
`advancePlanningStages()`, the pipeline catch block still receives `undefined`
for both details. The run-state writes changed in Steps 4 and 5 are therefore
the only required implementation changes for generated-path clobber prevention.

- [ ] **Step 7: Run planning failure tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "planning failure|generated spec path"
```

Expected: PASS.

- [ ] **Step 8: Run the resume regression tests**

Run:

```bash
node --test src/cli/commands/run-once/pipeline.test.ts --test-name-pattern "saved worktree|missing saved plan|deterministic blockers"
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/cli/commands/run-once/pipeline.test.ts src/cli/commands/run-once/stage-advancement.ts src/cli/commands/run-once/pipeline.ts
git commit -m "fix(run-once): avoid generated artifact state clobber"
```

---

### Task 5: Full verification and final cleanup

**Files:**

- Modify only files changed by Tasks 1 through 4 if verification exposes issues.

**Interfaces:**

- Consumes: all behavior from prior tasks.
- Produces: a verified branch ready for review or PR handoff.

- [ ] **Step 1: Run the full run-once test suite**

Run:

```bash
npm run test:run-once
```

Expected: PASS. If a test fails, inspect the failing assertion and fix the
smallest affected implementation or expectation before rerunning this command.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Review the final diff**

Run:

```bash
git diff --stat HEAD~4..HEAD
git diff HEAD~4..HEAD -- src/cli/commands/run-once
```

Expected: The diff only changes run-once resume, run-state, prompt, and tests
for the blocked implementation resume behavior.

- [ ] **Step 5: Commit any verification fixes**

If Step 1, 2, or 3 required fixes, commit them:

```bash
git add src/cli/commands/run-once
git commit -m "fix(run-once): stabilize blocked resume verification"
```

If no fixes were required, do not create an empty commit.

- [ ] **Step 6: Prepare implementation summary**

Record these items for handoff:

```md
Summary:

- Blocked implementation resumes resolve saved artifacts from the saved
  worktree.
- Missing saved plans stop before Pi instead of triggering fresh planning.
- Prior blocker context is stored and rendered in resume prompts.
- Generated artifact target paths are not persisted before creation succeeds.

Verification:

- npm run test:run-once
- npm test
- npm run lint
```
