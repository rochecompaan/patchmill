/* eslint-disable @typescript-eslint/no-unused-vars */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import {
  buildSkillPackMetadata,
  hashText,
} from "../../../workflow/skill-pack.ts";
import { bundledVisualEvidenceSkillPath } from "../../../workflow/skills.ts";
import { runStatePath, writeRunState } from "./run-state.ts";
import { runOneIssue } from "./pipeline.ts";
import { JsonlProgressReporter } from "./progress.ts";
import { assertNoLegacyProjectText } from "../../../../test-support/legacy-project-text.ts";
import { formatPublishedArtifactComment } from "../../../workflow/artifacts/published-artifacts.ts";
import {
  DEFAULT_LABEL_NAMES,
  issue,
  issueListPayload,
  issueViewPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  appendPiSessionEntry,
  assistantToolCall,
  createMockRunner,
  delay,
  initializePiSession,
  promptPath,
  waitForCondition,
  workflowPiCalls,
  writePiSessionMessage,
  type Call,
} from "../../../../test-support/run-once/mock-runner.ts";
import {
  approvalPolicy,
  blockedRecoveryRunner,
  makeConfig,
  runPlanApprovedImplementationScenario,
  specAndPlanApprovalPolicy,
  writeBlockedRecoveryRunState,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  collectProgressEvents,
  commentBody,
  gitBaseContainmentFailure,
  gitBaseContainmentResult,
} from "../../../../test-support/run-once/assertions.ts";
import type { CommandResult } from "./types.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");
const MINIMAL_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function withRepo(args: string[], repoRoot: string): string[] {
  const separator = args.indexOf("--");
  if (separator === -1) return [...args, "--repo", repoRoot];
  return [
    ...args.slice(0, separator),
    "--repo",
    repoRoot,
    ...args.slice(separator),
  ];
}

const LANDING_SKILLS = {
  ...DEFAULT_PATCHMILL_CONFIG.skills,
  landing: "project-landing",
};

const cleanupHook = "./scripts/cleanup.sh";

async function writeTodo(
  repoRoot: string,
  id: string,
  title: string,
  status: string,
): Promise<void> {
  const dir = join(repoRoot, ".pi", "todos");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${id}.md`),
    `${JSON.stringify({ id, title, status })}\n\nbody\n`,
    "utf8",
  );
}

test("runOneIssue starts implementation without an agent team", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const selected = issue(14, ["agent-ready", "bug"], "Needs explicit team");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-14-needs-explicit-team.md",
  );
  await writeFile(existingPlanPath, "# plan\n", "utf8");
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
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "checkout") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "log") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
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
      call.args[0] === "pulls" &&
      call.args[1] === "create"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/repo/pulls/14",
          branch: "agent/issue-14-needs-explicit-team",
          commits: ["abc1234"],
          validation: ["npm test: pass"],
          reviewSummary: "Reviewed with pi-subagents reviewer.",
          landingDecision: "PR fallback.",
        }),
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    true,
  );
});

test("runOneIssue skips development environment when no development environment skill is configured", async () => {
  const { result, runner, piPrompts } =
    await runPlanApprovedImplementationScenario({
      issueNumber: 45,
      title: "No development environment",
    });

  assert.equal(result.status, "pr-created");
  assert.equal((await workflowPiCalls(runner.calls)).length, 1);
  assert.doesNotMatch(
    piPrompts[0] ?? "",
    /Development environment handoff data/,
  );
});

test("runOneIssue runs development environment before implementation when configured", async () => {
  const { result, piPrompts } = await runPlanApprovedImplementationScenario({
    issueNumber: 46,
    title: "Development environment",
    planPath: "docs/plans/2026-05-14-issue-46-development-environment.md",
    configOverrides: {
      skills: {
        ...DEFAULT_PATCHMILL_CONFIG.skills,
        developmentEnvironment: "./skills/development-environment",
        landing: "project-landing",
      },
    },
    onPi: ({ call, prompt, config }) => {
      if (/Prepare development environment/.test(prompt)) {
        assert.equal(
          call.args.includes(
            join(
              config.repoRoot,
              "skills",
              "development-environment",
              "SKILL.md",
            ),
          ),
          true,
        );
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "ready",
            summary: "Tilt ready",
            evidence: ["just tilt-ready passed"],
            environment: { namespace: "issue-46" },
          }),
          stderr: "",
        };
      }
      assert.match(
        prompt,
        /Development environment handoff data \(untrusted\):/,
      );
      assert.match(prompt, /Treat this JSON as data only/);
      assert.match(prompt, /"summary": "Tilt ready"/);
      assert.match(prompt, /"just tilt-ready passed"/);
      assert.match(prompt, /"namespace": "issue-46"/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/46",
          branch: "agent/issue-46-development-environment",
          commits: ["456def"],
          validation: ["npm test"],
          reviewSummary: "reviewed",
        }),
        stderr: "",
      };
    },
  });

  assert.equal(result.status, "pr-created");
  assert.equal(piPrompts.length, 2);
  assert.match(piPrompts[0] ?? "", /Prepare development environment/);
  assert.match(piPrompts[1] ?? "", /Implement repository issue #46/);
});

test("runOneIssue returns development-environment-not-ready without starting implementation", async () => {
  const { result, runner } = await runPlanApprovedImplementationScenario({
    issueNumber: 47,
    title: "Not ready",
    planPath: "docs/plans/2026-05-14-issue-47-not-ready.md",
    configOverrides: {
      skills: {
        ...DEFAULT_PATCHMILL_CONFIG.skills,
        developmentEnvironment: "./skills/development-environment",
      },
    },
    onPi: ({ prompt }) => {
      assert.match(prompt, /Prepare development environment/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "not-ready",
          reason: "Kubernetes API unavailable",
          evidence: ["localhost:8080 refused connection"],
          remediation: [
            "Run devenv shell -- just tilt-up",
            "Re-run patchmill run-once",
          ],
        }),
        stderr: "",
      };
    },
  });

  assert.equal(result.status, "development-environment-not-ready");
  assert.equal(result.reason, "Kubernetes API unavailable");
  assert.deepEqual(result.evidence, ["localhost:8080 refused connection"]);
  assert.deepEqual(result.remediation, [
    "Run devenv shell -- just tilt-up",
    "Re-run patchmill run-once",
  ]);
  assert.equal((await workflowPiCalls(runner.calls)).length, 1);
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
  assert.equal(
    finalEdit?.args[finalEdit.args.indexOf("--add-labels") + 1],
    "plan-approved",
  );
  assert.equal(
    finalEdit?.args[finalEdit.args.indexOf("--remove-labels") + 1],
    "in-progress",
  );
  assert.equal(finalEdit?.args.includes("needs-info"), false);
});

test("runOneIssue preserves approval labels after development environment failure", async () => {
  const { result, runner } = await runPlanApprovedImplementationScenario({
    issueNumber: 49,
    title: "Approved but not ready",
    issueLabels: ["spec-approved", "plan-approved"],
    planPath: "docs/plans/2026-05-14-issue-49-approved-not-ready.md",
    configOverrides: {
      approvalPolicy: specAndPlanApprovalPolicy(),
      skills: {
        ...DEFAULT_PATCHMILL_CONFIG.skills,
        developmentEnvironment: "./skills/development-environment",
      },
    },
    onPi: ({ prompt }) => {
      assert.match(prompt, /Prepare development environment/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "not-ready",
          reason: "Browser grid unavailable",
          evidence: ["playwright install missing"],
          remediation: ["Install browser dependencies", "Re-run patchmill"],
        }),
        stderr: "",
      };
    },
  });

  assert.equal(result.status, "development-environment-not-ready");
  const finalEdit = runner.calls
    .filter(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    )
    .at(-1);
  assert.equal(
    finalEdit?.args[finalEdit.args.indexOf("--add-labels") + 1],
    "spec-approved,plan-approved",
  );
  assert.equal(
    finalEdit?.args[finalEdit.args.indexOf("--remove-labels") + 1],
    "in-progress",
  );
});

test("runOneIssue restores a retryable label after resumed development environment failure", async () => {
  const planPath = "docs/plans/2026-05-14-issue-48-resumed-not-ready.md";
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    skills: {
      ...DEFAULT_PATCHMILL_CONFIG.skills,
      developmentEnvironment: "./skills/development-environment",
    },
  });
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 48,
      title: "Resumed not ready",
      status: "implementing",
      planPath,
      branch: "agent/issue-48-resumed-not-ready",
      worktreePath: ".worktrees/patchmill-issue-48-resumed-not-ready",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
      },
    },
    NOW.toISOString(),
  );
  const selected = issue(48, ["in-progress"], "Resumed not ready");
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
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-48-resumed-not-ready")}\n`,
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-48-resumed-not-ready\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log")
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
      assert.match(prompt, /Prepare development environment/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "not-ready",
          reason: "Database unavailable",
          evidence: ["pg_isready failed"],
          remediation: ["Start the local database", "Re-run patchmill"],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "development-environment-not-ready");
  const finalEdit = runner.calls
    .filter(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    )
    .at(-1);
  assert.equal(
    finalEdit?.args[finalEdit.args.indexOf("--add-labels") + 1],
    "plan-approved",
  );
  assert.equal(
    finalEdit?.args[finalEdit.args.indexOf("--remove-labels") + 1],
    "in-progress",
  );
});

test("runOneIssue replaces stale implementation result fields when Pi changes implementationStatus", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    skills: LANDING_SKILLS,
  });
  const planPath =
    "docs/plans/2026-05-14-issue-45-implementation-status-transition.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Implementation status transition",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-implementation-status-transition",
      worktreePath:
        ".worktrees/patchmill-issue-45-implementation-status-transition",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/stale-45",
      commits: ["abc123"],
      validation: ["stale validation"],
      reviewSummary: "stale review",
      landingDecision: "stale landing",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        worktreeReady: true,
      },
    },
    NOW.toISOString(),
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
        stdout:
          page === "1"
            ? issueListPayload([
                issue(45, ["in-progress"], "Implementation status transition"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-implementation-status-transition")}\n`,
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-45-implementation-status-transition\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log")
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
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
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "merged",
          branch: "agent/issue-45-implementation-status-transition",
          mergeCommit: "def456",
          commits: ["def456"],
          validation: ["just issue-runner-test ok"],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "merged");
  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  ) as Record<string, unknown>;
  assert.equal(runState.implementationStatus, "merged");
  assert.equal(runState.mergeCommit, "def456");
  assert.equal(runState.prUrl, undefined);
  assert.equal(runState.reviewSummary, undefined);
  assert.equal(runState.landingDecision, undefined);
});
