# Optional Implementation-Ready Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Patchmill `skills.implementationReady` stage that can
prepare and verify a project-specific local runtime before implementation
starts.

**Architecture:** Treat implementation readiness as a generic Pi skill stage
owned by Patchmill orchestration, not as hardcoded environment commands. Config
loading accepts the optional skill key; run-once invokes a dedicated readiness
prompt after worktree creation and before implementation; successful readiness
evidence is handed into the implementation prompt, while `not-ready` stops
locally without posting issue questions.

**Tech Stack:** TypeScript, Node test runner, Patchmill run-once pipeline, Pi
prompt execution, Patchmill skill resolution, markdown documentation.

---

## File structure

- Modify `src/workflow/skills.ts`: add optional `implementationReady` to the
  skills config and skill-key list.
- Modify `src/workflow/skills.test.ts`: prove defaults remain unchanged and
  merge/clone behavior preserves the optional skill.
- Modify `src/cli/commands/run-once/args.test.ts`: prove CLI config loading
  passes `implementationReady` through to run-once.
- Modify `src/cli/commands/doctor/checks.test.ts`: prove doctor verifies
  path-like `implementationReady` skills through the existing skill checker.
- Modify `src/cli/commands/run-once/types.ts`: add readiness result types and a
  new `implementation-not-ready` pipeline result.
- Modify `src/cli/commands/run-once/pi.ts`: add readiness JSON parsing, an
  optional custom parser hook for `runPiPrompt()`, and a new
  `pi-implementation-ready` stage.
- Modify `src/cli/commands/run-once/pi.test.ts`: cover ready/not-ready parsing,
  malformed readiness JSON, and custom parser use.
- Modify `src/cli/commands/run-once/prompt-workflow.ts`: render the configured
  implementation-ready skill line.
- Modify `src/cli/commands/run-once/prompts.ts`: add
  `buildImplementationReadinessPrompt()` and readiness handoff text in
  `buildImplementationPrompt()`.
- Modify `src/cli/commands/run-once/prompts.test.ts`: cover the readiness prompt
  contract and the implementation handoff section.
- Modify `src/cli/commands/run-once/pipeline.ts`: invoke readiness when
  configured, stop on `not-ready`, and pass success evidence into
  implementation.
- Modify `src/cli/commands/run-once/pipeline.test.ts`: cover omitted-skill
  behavior, ready behavior, and not-ready behavior.
- Modify `docs/configuration.md`, `docs/skills.md`, and
  `docs/issue-agent-workflows.md`: document the optional stage and result
  contract.

## Task 1: Accept optional `skills.implementationReady` in configuration

**Files:**

- Modify: `src/workflow/skills.ts`
- Modify: `src/workflow/skills.test.ts`
- Modify: `src/cli/commands/run-once/args.test.ts`
- Modify: `src/cli/commands/doctor/checks.test.ts`

- [ ] **Step 1: Add failing skills config tests**

  In `src/workflow/skills.test.ts`, extend the imports and add this test after
  the existing `mergeSkillsConfig` tests:

  ```ts
  test("mergeSkillsConfig preserves optional implementationReady skill", () => {
    const merged = mergeSkillsConfig(DEFAULT_PATCHMILL_SKILLS, {
      implementationReady: ".patchmill/skills/implementation-ready",
    });

    assert.equal(
      merged.implementationReady,
      ".patchmill/skills/implementation-ready",
    );
    assert.equal(DEFAULT_PATCHMILL_SKILLS.implementationReady, undefined);
  });
  ```

- [ ] **Step 2: Add failing run-once config loading assertion**

  In `src/cli/commands/run-once/args.test.ts`, update the existing test named
  `loadCliConfig passes configured skills and project policy through to run-once prompts`
  so its JSON config includes the new key:

  ```ts
      skills: {
        implementationReady: "sentinel-ready",
        implementation: "sentinel-implementation",
        visualEvidence: "sentinel-screenshots",
        landing: "sentinel-landing",
      },
  ```

  Add this assertion with the other skill assertions:

  ```ts
  assert.equal(config.skills.implementationReady, "sentinel-ready");
  ```

- [ ] **Step 3: Add failing doctor coverage for path-like readiness skills**

  In `src/cli/commands/doctor/checks.test.ts`, add this test near the existing
  configured path-like skill tests:

  ```ts
  test("runDoctorChecks verifies configured implementationReady skill paths", async () => {
    const repoRoot = await tempRepo();
    await writeConfig(repoRoot, {
      host: { provider: "forgejo-tea", login: "triage-agent" },
      skills: {
        implementationReady: "./skills/implementation-ready",
      },
    });
    await writeSkillFile(
      join(repoRoot, "skills"),
      "implementation-ready",
      `---
  name: implementation-ready
  description: Prepare the local implementation environment
  ---
  
  # Implementation Ready
  `,
    );
    await mkdir(join(repoRoot, "docs"), { recursive: true });
    await mkdir(join(repoRoot, ".patchmill"), { recursive: true });
    const runner = runnerFrom(successMocks());

    const results = await runDoctorChecks(runner, {
      repoRoot,
      teaRepoRootForTests: "/repo",
    });
    const skills = results.find((result) => result.name === "skills");

    assert.equal(skills?.status, "pass");
    assert.match(
      skills?.message ?? "",
      /implementationReady: `\.\/skills\/implementation-ready` \(path verified\)/,
    );
  });
  ```

- [ ] **Step 4: Run focused failing tests**

  Run:

  ```bash
  npm test -- src/workflow/skills.test.ts src/cli/commands/run-once/args.test.ts src/cli/commands/doctor/checks.test.ts
  ```

  Expected: failures mention `implementationReady` not existing on
  `PatchmillSkillsConfig` or not being accepted as a supported skill stage.

- [ ] **Step 5: Implement the config key**

  In `src/workflow/skills.ts`, change `PatchmillSkillsConfig` and
  `PATCHMILL_SKILL_KEYS` to include `implementationReady` without adding it to
  defaults:

  ```ts
  export type PatchmillSkillsConfig = {
    triage: string;
    planning: string;
    implementation: string;
    implementationReady?: string;
    toolchain?: string;
    review?: string;
    visualEvidence?: string;
    landing?: string;
  };

  export const PATCHMILL_SKILL_KEYS = [
    "triage",
    "planning",
    "implementation",
    "implementationReady",
    "toolchain",
    "review",
    "visualEvidence",
    "landing",
  ] as const;
  ```

- [ ] **Step 6: Run focused tests again**

  Run:

  ```bash
  npm test -- src/workflow/skills.test.ts src/cli/commands/run-once/args.test.ts src/cli/commands/doctor/checks.test.ts
  ```

  Expected: all three files pass.

- [ ] **Step 7: Commit Task 1**

  ```bash
  git add src/workflow/skills.ts src/workflow/skills.test.ts src/cli/commands/run-once/args.test.ts src/cli/commands/doctor/checks.test.ts
  git commit -m "feat(config): accept implementation-ready skill"
  ```

## Task 2: Add readiness result types and Pi parsing support

**Files:**

- Modify: `src/cli/commands/run-once/types.ts`
- Modify: `src/cli/commands/run-once/pi.ts`
- Modify: `src/cli/commands/run-once/pi.test.ts`

- [ ] **Step 1: Add failing parser tests**

  In `src/cli/commands/run-once/pi.test.ts`, change the import from `./pi.ts` to
  include `parseImplementationReadinessResult`:

  ```ts
  import {
    parseImplementationReadinessResult,
    parsePiResult,
    runPiPrompt,
  } from "./pi.ts";
  ```

  Add these tests after the existing unsupported-status parser test:

  ```ts
  test("parseImplementationReadinessResult parses ready output", () => {
    assert.deepEqual(
      parseImplementationReadinessResult(
        'ready\n{"status":"ready","summary":"Tilt ready","evidence":["just tilt-ready passed"],"environment":{"namespace":"issue-84","tiltPort":"10384","ignored":12}}',
      ),
      {
        status: "ready",
        summary: "Tilt ready",
        evidence: ["just tilt-ready passed"],
        environment: { namespace: "issue-84", tiltPort: "10384" },
      },
    );
  });

  test("parseImplementationReadinessResult parses not-ready output", () => {
    assert.deepEqual(
      parseImplementationReadinessResult(
        'blocked\n{"status":"not-ready","reason":"Kubernetes API unavailable","evidence":["localhost:8080 refused connection"],"remediation":["Run devenv shell -- just tilt-up","Re-run patchmill run-once"]}',
      ),
      {
        status: "not-ready",
        reason: "Kubernetes API unavailable",
        evidence: ["localhost:8080 refused connection"],
        remediation: [
          "Run devenv shell -- just tilt-up",
          "Re-run patchmill run-once",
        ],
      },
    );
  });

  test("parseImplementationReadinessResult rejects unsupported readiness statuses", () => {
    assert.throws(
      () => parseImplementationReadinessResult('{"status":"blocked"}'),
      /supported implementation readiness JSON status/,
    );
  });
  ```

- [ ] **Step 2: Add failing `runPiPrompt` custom parser test**

  In `src/cli/commands/run-once/pi.test.ts`, add this test near the existing
  `runPiPrompt` tests:

  ```ts
  test("runPiPrompt can parse implementation readiness results", async () => {
    const runner = createMockRunner(() => ({
      code: 0,
      stdout:
        '{"status":"ready","summary":"ready","evidence":["check passed"]}',
      stderr: "",
    }));

    const result = await runPiPrompt(
      runner,
      "/repo/worktree",
      "readiness prompt",
      {
        stage: "pi-implementation-ready",
        parseResult: parseImplementationReadinessResult,
      },
    );

    assert.deepEqual(result, {
      status: "ready",
      summary: "ready",
      evidence: ["check passed"],
    });
  });
  ```

- [ ] **Step 3: Run focused failing tests**

  Run:

  ```bash
  npm test -- src/cli/commands/run-once/pi.test.ts
  ```

  Expected: failures mention missing `parseImplementationReadinessResult`,
  unsupported `pi-implementation-ready` stage, or missing `parseResult` option.

- [ ] **Step 4: Add readiness result types**

  In `src/cli/commands/run-once/types.ts`, insert these types after
  `AgentIssueApprovalRequiredResult`:

  ```ts
  export type AgentIssueImplementationReadyResult = {
    status: "ready";
    summary: string;
    evidence: string[];
    environment?: Record<string, string>;
  };

  export type AgentIssueImplementationNotReadyResult = {
    status: "not-ready";
    reason: string;
    evidence: string[];
    remediation: string[];
  };

  export type AgentIssueImplementationReadinessResult =
    | AgentIssueImplementationReadyResult
    | AgentIssueImplementationNotReadyResult;
  ```

  Extend `AgentIssuePipelineResult` with this branch before the existing
  PR/merge branch:

  ```ts
      | ({
          status: "implementation-not-ready";
          issue: IssueSummary;
          specPath?: string;
          planPath: string;
          branch?: string;
          worktreePath?: string;
          reason: string;
          evidence: string[];
          remediation: string[];
        })
  ```

- [ ] **Step 5: Refactor final JSON extraction in `pi.ts`**

  In `src/cli/commands/run-once/pi.ts`, update the type import to include
  readiness types:

  ```ts
  import type {
    AgentIssueBlockerQuestion,
    AgentIssueImplementationReadinessResult,
    AgentIssuePiResult,
    AgentIssueVisualEvidence,
    CommandResult,
    CommandRunner,
    ProgressReporter,
  } from "./types.ts";
  ```

  Add this helper above `parsePiResult()`:

  ````ts
  function finalJsonCandidates(stdout: string): Record<string, unknown>[] {
    const trimmed = stdout.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
    const body = fenced ? fenced[1] : trimmed;
    const end = body.lastIndexOf("}");
    if (end < 0)
      throw new Error("Pi output did not include a final JSON object");

    const candidates: Record<string, unknown>[] = [];
    for (
      let start = body.lastIndexOf("{", end);
      start >= 0;
      start = start === 0 ? -1 : body.lastIndexOf("{", start - 1)
    ) {
      try {
        const parsed = JSON.parse(body.slice(start, end + 1)) as Record<
          string,
          unknown
        >;
        candidates.push(parsed);
      } catch {
        continue;
      }
    }

    return candidates;
  }
  ````

  Replace the current body setup and `for` loop in `parsePiResult()` with:

  ```ts
  export function parsePiResult(stdout: string): AgentIssuePiResult {
    for (const parsed of finalJsonCandidates(stdout)) {
      if (parsed.status === "blocked") {
        return {
          status: "blocked",
          reason:
            typeof parsed.reason === "string"
              ? parsed.reason
              : "Unknown blocker",
          questions: questions(parsed.questions),
          commits: stringArray(parsed.commits),
          validation: stringArray(parsed.validation),
        };
      }

      if (
        parsed.status === "spec-created" &&
        typeof parsed.specPath === "string"
      ) {
        return {
          status: "spec-created",
          specPath: parsed.specPath,
          commit: typeof parsed.commit === "string" ? parsed.commit : undefined,
        };
      }

      if (
        parsed.status === "plan-created" &&
        typeof parsed.planPath === "string"
      ) {
        return {
          status: "plan-created",
          planPath: parsed.planPath,
          commit: typeof parsed.commit === "string" ? parsed.commit : undefined,
        };
      }

      if (
        parsed.status === "pr-created" &&
        typeof parsed.prUrl === "string" &&
        typeof parsed.branch === "string"
      ) {
        return {
          status: "pr-created",
          prUrl: parsed.prUrl,
          branch: parsed.branch,
          commits: stringArray(parsed.commits),
          validation: stringArray(parsed.validation),
          reviewSummary:
            typeof parsed.reviewSummary === "string"
              ? parsed.reviewSummary
              : undefined,
          landingDecision:
            typeof parsed.landingDecision === "string"
              ? parsed.landingDecision
              : undefined,
          visualEvidence: visualEvidence(parsed.visualEvidence),
        };
      }

      if (
        parsed.status === "merged" &&
        typeof parsed.branch === "string" &&
        typeof parsed.mergeCommit === "string"
      ) {
        return {
          status: "merged",
          branch: parsed.branch,
          mergeCommit: parsed.mergeCommit,
          commits: stringArray(parsed.commits),
          validation: stringArray(parsed.validation),
          reviewSummary:
            typeof parsed.reviewSummary === "string"
              ? parsed.reviewSummary
              : undefined,
          landingDecision:
            typeof parsed.landingDecision === "string"
              ? parsed.landingDecision
              : undefined,
        };
      }
    }

    throw new Error("Pi output did not include a supported final JSON status");
  }
  ```

- [ ] **Step 6: Implement readiness parsing and generic prompt parsing**

  In `src/cli/commands/run-once/pi.ts`, add this helper below
  `visualEvidence()`:

  ```ts
  function stringRecord(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    const entries = Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  ```

  Add this parser after `parsePiResult()`:

  ```ts
  export function parseImplementationReadinessResult(
    stdout: string,
  ): AgentIssueImplementationReadinessResult {
    for (const parsed of finalJsonCandidates(stdout)) {
      if (parsed.status === "ready") {
        return {
          status: "ready",
          summary:
            typeof parsed.summary === "string" ? parsed.summary : "Ready",
          evidence: stringArray(parsed.evidence),
          environment: stringRecord(parsed.environment),
        };
      }

      if (parsed.status === "not-ready") {
        return {
          status: "not-ready",
          reason:
            typeof parsed.reason === "string"
              ? parsed.reason
              : "Implementation environment is not ready",
          evidence: stringArray(parsed.evidence),
          remediation: stringArray(parsed.remediation),
        };
      }
    }

    throw new Error(
      "Pi output did not include a supported implementation readiness JSON status",
    );
  }
  ```

  Change `RunPiPromptOptions` and `stageStatus()` to support the new stage and
  parser:

  ```ts
  export type RunPiPromptStage =
    | "pi-plan"
    | "pi-implementation-ready"
    | "pi-implementation";

  export type RunPiPromptOptions<Result = AgentIssuePiResult> = {
    progress?: ProgressReporter;
    stage: RunPiPromptStage;
    parseResult?: (stdout: string) => Result;
    skillPaths?: string[];
    heartbeatMs?: number;
    streamOutput?: (chunk: string) => void;
    issueNumber?: number;
    repoRoot?: string;
    taskProgress?: () =>
      | PiTaskProgress
      | undefined
      | Promise<PiTaskProgress | undefined>;
    onTaskProgress?: (progress: PiTaskProgress) => void | Promise<void>;
    tokenUsage?: () => string | undefined;
    tokenUsageState?: { total: number };
    observeSession?: boolean;
    onObservation?: (observation: PiSessionObservation) => void | Promise<void>;
    verbosePiOutput?: boolean;
    taskContract?: PatchmillPiTaskContract;
    piAgentDir?: string;
  };

  function stageStatus(stage: RunPiPromptStage): string {
    if (stage === "pi-plan") return "planning";
    if (stage === "pi-implementation-ready") return "implementation readiness";
    return "implementing";
  }
  ```

  Change the function signature and final return in `runPiPrompt()`:

  ```ts
  export async function runPiPrompt<Result = AgentIssuePiResult>(
    runner: CommandRunner,
    cwd: string,
    prompt: string,
    options?: RunPiPromptOptions<Result>,
  ): Promise<Result> {
  ```

  ```ts
  const parseResult = options?.parseResult ?? parsePiResult;
  return parseResult(stdout) as Result;
  ```

- [ ] **Step 7: Run focused tests again**

  Run:

  ```bash
  npm test -- src/cli/commands/run-once/pi.test.ts
  ```

  Expected: all `pi.test.ts` tests pass.

- [ ] **Step 8: Commit Task 2**

  ```bash
  git add src/cli/commands/run-once/types.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/pi.test.ts
  git commit -m "feat(run-once): parse implementation readiness results"
  ```

## Task 3: Add readiness prompts and implementation prompt handoff

**Files:**

- Modify: `src/cli/commands/run-once/prompt-workflow.ts`
- Modify: `src/cli/commands/run-once/prompts.ts`
- Modify: `src/cli/commands/run-once/prompts.test.ts`

- [ ] **Step 1: Add failing prompt tests**

  In `src/cli/commands/run-once/prompts.test.ts`, update the import from
  `./prompts.ts`:

  ```ts
  import {
    buildImplementationPrompt,
    buildImplementationReadinessPrompt,
    buildPlanCreationPrompt,
    buildSpecCreationPrompt,
  } from "./prompts.ts";
  ```

  Add this test near the implementation prompt tests:

  ```ts
  test("buildImplementationReadinessPrompt renders the optional readiness skill contract", () => {
    const prompt = buildImplementationReadinessPrompt({
      issue,
      planPath,
      branch: "agent/issue-42-add-once-runner-helpers",
      worktreePath: ".worktrees/patchmill-issue-42-add-once-runner-helpers",
      projectPolicy: examplePolicy,
      skills: {
        ...DEFAULT_PATCHMILL_SKILLS,
        implementationReady: ".patchmill/skills/implementation-ready",
      },
    });

    assert.match(
      prompt,
      /Prepare implementation readiness for ExampleApp issue #42/,
    );
    assert.match(
      prompt,
      /Plan path: docs\/plans\/2026-05-09-issue-42-add-once-runner-helpers\.md/,
    );
    assert.match(prompt, /Branch: agent\/issue-42-add-once-runner-helpers/);
    assert.match(
      prompt,
      /Worktree: \.worktrees\/patchmill-issue-42-add-once-runner-helpers/,
    );
    assert.match(
      prompt,
      /Use the configured implementation-ready skill: `\.patchmill\/skills\/implementation-ready`\./,
    );
    assert.match(prompt, /Do not implement product changes/);
    assert.match(prompt, /"status": "ready"/);
    assert.match(prompt, /"status": "not-ready"/);
    assert.doesNotMatch(prompt, /"questions"/);
  });

  test("buildImplementationPrompt includes readiness handoff when provided", () => {
    const prompt = buildImplementationPrompt({
      issue,
      planPath,
      branch: "agent/issue-42-add-once-runner-helpers",
      worktreePath: ".worktrees/patchmill-issue-42-add-once-runner-helpers",
      git: { baseBranch: "main", remote: "origin", allowDirectLand: false },
      projectPolicy: examplePolicy,
      readiness: {
        completedAt: "2026-06-14T06:00:00.000Z",
        status: "ready",
        summary: "Tilt/k3d environment is ready",
        evidence: ["devenv shell -- just tilt-ready passed"],
        environment: { namespace: "issue-42", tiltPort: "1042" },
      },
    });

    assert.match(prompt, /Implementation readiness:/);
    assert.match(prompt, /completed at 2026-06-14T06:00:00\.000Z/);
    assert.match(prompt, /Summary: Tilt\/k3d environment is ready/);
    assert.match(prompt, /devenv shell -- just tilt-ready passed/);
    assert.match(prompt, /namespace: issue-42/);
    assert.match(prompt, /tiltPort: 1042/);
    assert.match(prompt, /not permission to skip later validation commands/);
  });
  ```

- [ ] **Step 2: Run focused failing prompt tests**

  Run:

  ```bash
  npm test -- src/cli/commands/run-once/prompts.test.ts
  ```

  Expected: failures mention missing `buildImplementationReadinessPrompt` or
  missing `readiness` input support.

- [ ] **Step 3: Render the readiness skill line**

  In `src/cli/commands/run-once/prompt-workflow.ts`, add this function after
  `renderImplementationSkillSteps()`:

  ```ts
  export function renderImplementationReadySkillStep(
    skills: PatchmillSkillsConfig,
  ): string {
    return renderConfiguredSkillLine(
      "Use the configured implementation-ready skill",
      skills.implementationReady,
    );
  }
  ```

- [ ] **Step 4: Add prompt input types and readiness formatting**

  In `src/cli/commands/run-once/prompts.ts`, update the imports from
  `./prompt-workflow.ts`:

  ```ts
  import {
    renderImplementationReadySkillStep,
    renderImplementationSkillSteps,
    renderLandingSkillStep,
    renderPlanningSkillStep,
    renderVisualEvidenceSkillStep,
  } from "./prompt-workflow.ts";
  ```

  Update the type import from `./types.ts`:

  ```ts
  import type {
    AgentIssueImplementationReadyResult,
    AgentIssueImplementationResumeContext,
    IssueSummary,
  } from "./types.ts";
  ```

  Add these types after `ImplementationPromptInput`:

  ```ts
  export type ImplementationReadinessPromptInput = {
    issue: IssueSummary;
    planPath: string;
    branch: string;
    worktreePath: string;
    projectPolicy: PatchmillProjectPolicy;
    skills?: PatchmillSkillsConfig;
  };

  export type ImplementationReadinessHandoff =
    AgentIssueImplementationReadyResult & {
      completedAt: string;
    };
  ```

  Add `readiness?: ImplementationReadinessHandoff;` to
  `ImplementationPromptInput`.

  Add this formatter near `formatResumeContext()`:

  ```ts
  function formatImplementationReadiness(
    readiness?: ImplementationReadinessHandoff,
  ): string {
    if (!readiness) return "";

    const evidence =
      readiness.evidence.length > 0
        ? readiness.evidence.map((entry) => `  - ${entry}`).join("\n")
        : "  - (no evidence reported)";
    const environmentEntries = Object.entries(readiness.environment ?? {});
    const environment =
      environmentEntries.length > 0
        ? [
            "- Environment:",
            ...environmentEntries.map(([key, value]) => `  - ${key}: ${value}`),
          ].join("\n")
        : "- Environment: (none reported)";

    return [
      "Implementation readiness:",
      `- The configured implementation-ready skill completed at ${readiness.completedAt}.`,
      `- Summary: ${readiness.summary}`,
      "- Evidence:",
      evidence,
      environment,
      "- This readiness evidence allows implementation to start; it is not permission to skip later validation commands.",
      "",
    ].join("\n");
  }
  ```

- [ ] **Step 5: Add the readiness prompt builder**

  In `src/cli/commands/run-once/prompts.ts`, add this exported function before
  `buildImplementationPrompt()`:

  ```ts
  export function buildImplementationReadinessPrompt(
    input: ImplementationReadinessPromptInput,
  ): string {
    const { issue, planPath, branch, worktreePath, projectPolicy } = input;
    const skills = input.skills ?? DEFAULT_PATCHMILL_SKILLS;
    const workflow = numberedWorkflow([
      renderImplementationContextInstruction(projectPolicy, planPath),
      renderImplementationReadySkillStep(skills),
      "Prepare and verify only the local implementation environment required before implementation can begin.",
      "Do not implement product changes, dispatch implementation workers, run review loops, land code, push branches, or open pull requests.",
      "Leave tracked product files unchanged unless the configured implementation-ready skill explicitly documents a safe repository-owned readiness change.",
      "Return the readiness result contract as the final response.",
    ]);

    return `Prepare implementation readiness for ${formatIssueTarget(projectPolicy)} #${issue.number}: ${issue.title}
  
  Issue data:
  - Number: #${issue.number}
  - Title: ${issue.title}
  - Labels: ${formatLabels(issue.labels)}
  - Plan path: ${planPath}
  - Branch: ${branch}
  - Worktree: ${worktreePath}
  - Author: ${issue.author ?? "unknown"}
  - Updated: ${issue.updated ?? "unknown"}
  
  ${untrustedIssueContentBoundary()}
  
  Issue body:
  ${issueBody(issue.body)}
  
  Relevant issue comments:
  ${formatComments(issue.comments)}
  
  Required workflow:
  ${workflow}
  
  Ready final response:
  Return this exact JSON object after the implementation environment is ready:
  {
    "status": "ready",
    "summary": "short readiness summary",
    "evidence": ["command or check and result summary"],
    "environment": {
      "detailName": "optional non-secret detail useful to implementation"
    }
  }
  
  Not-ready final response:
  Return this exact JSON object when the local implementation environment cannot be made ready:
  {
    "status": "not-ready",
    "reason": "short operator-facing reason",
    "evidence": ["failed command or check and result summary"],
    "remediation": ["operator action to repair the environment", "rerun patchmill run-once"]
  }
  `;
  }
  ```

  After inserting, remove the two leading spaces from each line inside the
  template literal body if Prettier does not normalize them. The rendered prompt
  must start its lines at column 1 like the other prompt builders.

- [ ] **Step 6: Add readiness handoff to implementation prompt**

  In `buildImplementationPrompt()`, destructure `readiness` from the input:

  ```ts
  const {
    issue,
    planPath,
    branch,
    worktreePath,
    git,
    projectPolicy,
    resume,
    readiness,
  } = input;
  ```

  Insert the readiness section after resume context and before `Issue body:`:

  ```ts
  ${formatResumeContext(resume)}${formatImplementationReadiness(readiness)}Issue body:
  ```

- [ ] **Step 7: Run focused tests again**

  Run:

  ```bash
  npm test -- src/cli/commands/run-once/prompts.test.ts
  ```

  Expected: all prompt tests pass.

- [ ] **Step 8: Commit Task 3**

  ```bash
  git add src/cli/commands/run-once/prompt-workflow.ts src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/prompts.test.ts
  git commit -m "feat(run-once): add implementation readiness prompts"
  ```

## Task 4: Wire readiness into the run-once pipeline

**Files:**

- Modify: `src/cli/commands/run-once/pipeline.ts`
- Modify: `src/cli/commands/run-once/pipeline.test.ts`

- [ ] **Step 1: Add failing test for omitted readiness skill**

  In `src/cli/commands/run-once/pipeline.test.ts`, add this test near the
  existing implementation-flow tests:

  ```ts
  test("runOneIssue skips implementation readiness when no readiness skill is configured", async () => {
    const planPath = "docs/plans/2026-05-14-issue-45-no-readiness.md";
    const config = await makeConfig({ dryRun: false, execute: true });
    await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
    const selected = issue(45, ["plan-approved"], "No readiness");
    let implementationPrompt = "";
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
        implementationPrompt = await readFile(promptPath(call.args), "utf8");
        return {
          code: 0,
          stdout:
            '{"status":"pr-created","prUrl":"https://forgejo.example/pr/45","branch":"agent/issue-45-no-readiness","commits":["123abc"],"validation":["npm test"],"reviewSummary":"reviewed"}',
          stderr: "",
        };
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    });

    const result = await runOneIssue(runner, config, { now: NOW });

    assert.equal(result.status, "pr-created");
    assert.equal(
      runner.calls.filter((call) => call.command === "pi").length,
      1,
    );
    assert.doesNotMatch(implementationPrompt, /Implementation readiness:/);
  });
  ```

- [ ] **Step 2: Add failing test for successful readiness**

  In the same test file, add this test after the omitted-skill test:

  ```ts
  test("runOneIssue runs implementation readiness before implementation when configured", async () => {
    const planPath = "docs/plans/2026-05-14-issue-46-readiness.md";
    const config = await makeConfig({
      dryRun: false,
      execute: true,
      skills: {
        ...DEFAULT_PATCHMILL_CONFIG.skills,
        implementationReady: "./skills/implementation-ready",
        landing: "project-landing",
      },
    });
    await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
    const selected = issue(46, ["plan-approved"], "Readiness");
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
        if (/Prepare implementation readiness/.test(prompt)) {
          assert.equal(
            call.args.includes(
              join(
                config.repoRoot,
                "skills",
                "implementation-ready",
                "SKILL.md",
              ),
            ),
            true,
          );
          return {
            code: 0,
            stdout:
              '{"status":"ready","summary":"Tilt ready","evidence":["just tilt-ready passed"],"environment":{"namespace":"issue-46"}}',
            stderr: "",
          };
        }
        assert.match(prompt, /Implementation readiness:/);
        assert.match(prompt, /Summary: Tilt ready/);
        assert.match(prompt, /just tilt-ready passed/);
        assert.match(prompt, /namespace: issue-46/);
        return {
          code: 0,
          stdout:
            '{"status":"pr-created","prUrl":"https://forgejo.example/pr/46","branch":"agent/issue-46-readiness","commits":["456def"],"validation":["npm test"],"reviewSummary":"reviewed"}',
          stderr: "",
        };
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    });

    const result = await runOneIssue(runner, config, { now: NOW });

    assert.equal(result.status, "pr-created");
    assert.equal(piPrompts.length, 2);
    assert.match(piPrompts[0] ?? "", /Prepare implementation readiness/);
    assert.match(piPrompts[1] ?? "", /Implement repository issue #46/);
  });
  ```

- [ ] **Step 3: Add failing test for not-ready stopping before implementation**

  Add this test after the successful readiness test:

  ```ts
  test("runOneIssue returns implementation-not-ready without starting implementation", async () => {
    const planPath = "docs/plans/2026-05-14-issue-47-not-ready.md";
    const config = await makeConfig({
      dryRun: false,
      execute: true,
      skills: {
        ...DEFAULT_PATCHMILL_CONFIG.skills,
        implementationReady: "./skills/implementation-ready",
      },
    });
    await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
    const selected = issue(47, ["plan-approved"], "Not ready");
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
        call.args[0] === "issues" &&
        call.args[1] === "edit"
      )
        return { code: 0, stdout: "", stderr: "" };
      if (call.command === "tea" && call.args[0] === "comment")
        return { code: 0, stdout: "", stderr: "" };
      if (call.command === "pi") {
        const prompt = await readFile(promptPath(call.args), "utf8");
        assert.match(prompt, /Prepare implementation readiness/);
        return {
          code: 0,
          stdout:
            '{"status":"not-ready","reason":"Kubernetes API unavailable","evidence":["localhost:8080 refused connection"],"remediation":["Run devenv shell -- just tilt-up","Re-run patchmill run-once"]}',
          stderr: "",
        };
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    });

    const result = await runOneIssue(runner, config, { now: NOW });

    assert.equal(result.status, "implementation-not-ready");
    assert.equal(result.reason, "Kubernetes API unavailable");
    assert.deepEqual(result.evidence, ["localhost:8080 refused connection"]);
    assert.deepEqual(result.remediation, [
      "Run devenv shell -- just tilt-up",
      "Re-run patchmill run-once",
    ]);
    assert.equal(
      runner.calls.filter((call) => call.command === "pi").length,
      1,
    );
    assert.equal(
      runner.calls.some(
        (call) =>
          call.command === "tea" &&
          call.args[0] === "comment" &&
          /needs more information/.test(commentBody(call)),
      ),
      false,
    );
    const finalEdit = runner.calls
      .filter(
        (call) =>
          call.command === "tea" &&
          call.args[0] === "issues" &&
          call.args[1] === "edit",
      )
      .at(-1);
    assert.ok(finalEdit?.args.includes("plan-approved"));
    assert.equal(finalEdit?.args.includes("in-progress"), false);
  });
  ```

- [ ] **Step 4: Run focused failing pipeline tests**

  Run:

  ```bash
  npm test -- src/cli/commands/run-once/pipeline.test.ts
  ```

  Expected: the new readiness tests fail because the pipeline does not invoke
  readiness and does not know `implementation-not-ready`.

- [ ] **Step 5: Import readiness helpers in the pipeline**

  In `src/cli/commands/run-once/pipeline.ts`, change the Pi import:

  ```ts
  import { parseImplementationReadinessResult, runPiPrompt } from "./pi.ts";
  ```

  Change the prompt import:

  ```ts
  import {
    buildImplementationPrompt,
    buildImplementationReadinessPrompt,
  } from "./prompts.ts";
  ```

  Extend the type import:

  ```ts
    AgentIssueImplementationReadyResult,
    AgentIssueImplementationReadinessResult,
  ```

  Add a local handoff type near the other type helpers:

  ```ts
  type AgentIssueImplementationReadinessHandoff =
    AgentIssueImplementationReadyResult & {
      completedAt: string;
    };
  ```

- [ ] **Step 6: Add retryable labels and not-ready result helper**

  In `src/cli/commands/run-once/pipeline.ts`, add these helpers near
  `blockIssue()`:

  ```ts
  function retryableLabelsAfterReadinessFailure(
    issue: IssueSummary,
    labels: string[],
    config: AgentIssueConfig,
  ): string[] {
    const { ready, inProgress } = lifecycleLabels(config);
    const withoutInProgress = nextLabels(labels, [inProgress], []);
    const workflowState = resolveWorkflowState(issue.labels, {
      readyLabel: ready,
      policy: config.approvalPolicy,
    });
    const restore =
      workflowState.kind === "agent-ready"
        ? [ready]
        : workflowState.kind === "spec-approved"
          ? [config.approvalPolicy.specApproval.approvedLabel]
          : workflowState.kind === "plan-approved"
            ? [config.approvalPolicy.planApproval.approvedLabel]
            : [];

    return nextLabels(withoutInProgress, [], restore);
  }

  async function implementationNotReady(
    host: IssueHostProvider,
    config: AgentIssueConfig,
    issue: IssueSummary,
    labels: string[],
    result: Extract<
      AgentIssueImplementationReadinessResult,
      { status: "not-ready" }
    >,
    details: {
      specPath?: string;
      specCommit?: string;
      planPath: string;
      planCommit?: string;
      branch?: string;
      worktreePath?: string;
    },
    timestamp: string,
    options: RunOneIssueOptions,
  ): Promise<AgentIssuePipelineResult> {
    await progress(
      options,
      "error",
      "implementation-ready",
      `implementation environment not ready: ${result.reason}`,
      { issueNumber: issue.number, data: result },
    );
    const retryableLabels = retryableLabelsAfterReadinessFailure(
      issue,
      labels,
      config,
    );
    if (retryableLabels.join("\0") !== labels.join("\0")) {
      await host.applyLabels(
        planLabelChange(issue.number, labels, retryableLabels),
      );
    }
    await writeRunState(
      config.runStateDir,
      {
        issueNumber: issue.number,
        title: issue.title,
        status: "finished",
        resetCheckpoints: true,
        specPath: details.specPath,
        specCommit: details.specCommit,
        planPath: details.planPath,
        planCommit: details.planCommit,
        lastError: result.reason,
      },
      timestamp,
    );
    await emitSimpleStep(
      options,
      issue.number,
      "final result implementation-not-ready",
    );

    return withLogPath(
      {
        status: "implementation-not-ready",
        issue,
        specPath: details.specPath,
        planPath: details.planPath,
        branch: details.branch,
        worktreePath: details.worktreePath,
        reason: result.reason,
        evidence: result.evidence,
        remediation: result.remediation,
      },
      options,
    );
  }
  ```

- [ ] **Step 7: Run readiness after worktree creation and before
      implementation**

  In `runOneIssue()`, after the worktree state is written and before
  `if (!implemented)`, add:

  ```ts
  let readiness: AgentIssueImplementationReadinessHandoff | undefined;
  if (!implemented && config.skills.implementationReady) {
    const readinessResult = await runStep(
      "implementation readiness",
      async (): Promise<AgentIssueImplementationReadinessResult> => {
        await progress(
          options,
          "info",
          "implementation-ready",
          "running implementation readiness with pi",
          { issueNumber: issue.number },
        );
        return await runPiPrompt(
          runner,
          join(config.repoRoot, worktreePath),
          buildImplementationReadinessPrompt({
            issue: { ...issue, labels },
            planPath,
            branch,
            worktreePath,
            projectPolicy: config.projectPolicy,
            skills: config.skills,
          }),
          {
            progress: options.progress,
            stage: "pi-implementation-ready",
            parseResult: parseImplementationReadinessResult,
            skillPaths: skillInvocationPaths(
              [config.skills.toolchain, config.skills.implementationReady],
              config.repoRoot,
            ),
            streamOutput: options.streamPiOutput,
            issueNumber: issue.number,
            repoRoot: join(config.repoRoot, worktreePath),
            heartbeatMs: options.heartbeatMs,
            tokenUsageState,
            observeSession: true,
            verbosePiOutput: options.verbosePiOutput,
            onObservation: observePi("pi-implementation-ready"),
            taskContract: config.projectPolicy.pi.taskContract,
            piAgentDir,
          },
        );
      },
    );

    if (readinessResult.status === "not-ready") {
      return implementationNotReady(
        host,
        config,
        issue,
        labels,
        readinessResult,
        { specPath, specCommit, planPath, planCommit, branch, worktreePath },
        timestamp,
        options,
      );
    }

    readiness = { ...readinessResult, completedAt: timestamp };
  }
  ```

  Change `observePi` typing so it accepts the new stage:

  ```ts
  const observePi =
    (stage: "pi-plan" | "pi-implementation-ready" | "pi-implementation") =>
  ```

- [ ] **Step 8: Pass readiness into the implementation prompt**

  In the existing `buildImplementationPrompt()` call, add the new property:

  ```ts
            readiness,
  ```

  The call should include `readiness` beside `resume`:

  ```ts
            resume: {
              resumed: resumableState,
              worktreeCreated: worktree.created,
              existingCommits: worktree.existingCommits,
            },
            readiness,
  ```

- [ ] **Step 9: Run focused pipeline tests again**

  Run:

  ```bash
  npm test -- src/cli/commands/run-once/pipeline.test.ts
  ```

  Expected: all pipeline tests pass.

- [ ] **Step 10: Commit Task 4**

  ```bash
  git add src/cli/commands/run-once/pipeline.ts src/cli/commands/run-once/pipeline.test.ts
  git commit -m "feat(run-once): gate implementation with readiness skill"
  ```

## Task 5: Document optional implementation readiness

**Files:**

- Modify: `docs/configuration.md`
- Modify: `docs/skills.md`
- Modify: `docs/issue-agent-workflows.md`

- [ ] **Step 1: Update configuration documentation**

  In `docs/configuration.md`, add `implementationReady` to the skills examples
  and optional skill-key list. Use this exact paragraph in the Skills section
  after the required-skill paragraph:

  ```md
  `implementationReady` is optional. When configured, `patchmill run-once` runs
  that skill from the issue worktree after the plan is available and before the
  implementation skill starts. The skill should prepare and verify local runtime
  prerequisites, then return either `ready` or `not-ready`. When the key is
  omitted, implementation starts exactly as it did before this feature.
  ```

  Add this example below the default skills JSON:

  ```json
  {
    "skills": {
      "implementationReady": ".patchmill/skills/bootstrapping-tilt-worktrees",
      "implementation": ".patchmill/skills/subagent-dev-with-codex-and-thermo-reviews"
    }
  }
  ```

- [ ] **Step 2: Update skills documentation**

  In `docs/skills.md`, add this bullet to the supported key list:

  ```md
  - `implementationReady`: optional skill used after worktree preparation and
    before implementation to prepare and verify local runtime prerequisites. A
    `not-ready` result stops the run locally without posting issue `needs-info`
    questions.
  ```

  Add this subsection after `## Project-local default skills` or immediately
  before it:

  ```md
  ## Implementation readiness

  Use `skills.implementationReady` when a repository needs mutable local
  services before implementation can safely start. Examples include
  Kubernetes/Tilt, Docker Compose, seeded databases, browser automation
  infrastructure, or a per-worktree development namespace.

  The readiness skill owns project-specific setup and repair logic. Patchmill
  only enforces the stage boundary: if the skill returns `ready`, Patchmill
  passes its summary and evidence into the implementation prompt; if it returns
  `not-ready`, Patchmill stops before implementation and prints operator-facing
  remediation.
  ```

- [ ] **Step 3: Update workflow documentation**

  In `docs/issue-agent-workflows.md`, update the implementation prompt section
  so the stage order says readiness runs before implementation when configured.
  Add this subsection before `### Implementation Pi prompt`:

  ```md
  ### Optional implementation-readiness Pi prompt

  If `skills.implementationReady` is configured, `run-once` runs a separate Pi
  prompt from the issue worktree before implementation. The prompt uses the
  configured readiness skill and accepts only `ready` or `not-ready` final JSON.

  `ready` records a summary, evidence, and optional non-secret environment
  details for the later implementation prompt. `not-ready` stops the run before
  implementation, removes the in-progress claim, leaves the issue retryable, and
  returns operator remediation in the final command output. Readiness failures
  do not use issue-style `questions` because they describe local environment
  repair, not product requirements.
  ```

- [ ] **Step 4: Run documentation verification**

  Run:

  ```bash
  npm run lint:md
  ```

  Expected: markdown lint passes.

- [ ] **Step 5: Commit Task 5**

  ```bash
  git add docs/configuration.md docs/skills.md docs/issue-agent-workflows.md
  git commit -m "docs: document implementation readiness skill"
  ```

## Task 6: Final verification and cleanup

**Files:**

- Verify all modified files.

- [ ] **Step 1: Run formatting check**

  ```bash
  npm run format:check
  ```

  Expected: Prettier reports all files are formatted.

- [ ] **Step 2: Run TypeScript lint**

  ```bash
  npm run lint:ts
  ```

  Expected: ESLint reports no warnings or errors.

- [ ] **Step 3: Run run-once test suite**

  ```bash
  npm run test:run-once
  ```

  Expected: all run-once tests pass.

- [ ] **Step 4: Run full test suite**

  ```bash
  npm test
  ```

  Expected: all repository tests pass.

- [ ] **Step 5: Run full lint**

  ```bash
  npm run lint
  ```

  Expected: format, TypeScript lint, and markdown lint all pass.

- [ ] **Step 6: Inspect final diff**

  ```bash
  git status --short
  git diff --stat HEAD
  git diff -- src/workflow/skills.ts src/cli/commands/run-once/pi.ts src/cli/commands/run-once/prompts.ts src/cli/commands/run-once/pipeline.ts
  ```

  Expected: only intended feature files are modified, with no generated
  artifacts or local state files staged.

- [ ] **Step 7: Commit final cleanup if needed**

  If Tasks 1 through 5 already committed all changes and Step 6 shows a clean
  working tree, skip this commit. If verification fixes changed files, commit
  them:

  ```bash
  git add src docs
  git commit -m "chore: finalize implementation readiness skill"
  ```

## Self-review

- Spec coverage: Tasks 1 through 5 cover optional configuration, generic
  readiness prompt, ready/not-ready result parsing, run-once stage ordering,
  successful handoff evidence, not-ready local stop behavior, doctor validation,
  and documentation. Task 6 covers verification.
- Placeholder scan: The plan contains no placeholder markers or unspecified
  implementation steps. Every code-changing step includes concrete code or exact
  text to insert.
- Type consistency: The plan uses `AgentIssueImplementationReadyResult`,
  `AgentIssueImplementationNotReadyResult`, and
  `AgentIssueImplementationReadinessResult` consistently across `types.ts`,
  `pi.ts`, `prompts.ts`, and `pipeline.ts`.
