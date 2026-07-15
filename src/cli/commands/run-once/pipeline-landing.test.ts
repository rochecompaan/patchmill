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

test("runOneIssue blocks completed handoff when issue task todos remain open", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(
    23,
    ["agent-ready", "bug"],
    "Reject stale todo progress",
  );
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-23-reject-stale-todo-progress.md",
  );
  const worktreePath =
    ".worktrees/patchmill-issue-23-reject-stale-todo-progress";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(worktreeRoot, { recursive: true });
  await writeFile(existingPlanPath, "# plan\n", "utf8");
  await writeTodo(
    worktreeRoot,
    "task-1",
    "issue-23-task-01-server-duplicate-guard",
    "open",
  );
  await writeTodo(
    worktreeRoot,
    "task-2",
    "issue-23-task-02-mobile-confirmation",
    "done",
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
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-23-reject-stale-todo-progress\n",
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
        stdout:
          '{"status":"pr-created","prUrl":"https://forgejo.example/pr/23","branch":"agent/issue-23-reject-stale-todo-progress","commits":["abc123"],"validation":["git diff --check ok"],"reviewSummary":"reviewed"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /Issue task todos remain open/);
  assert.match(result.reason, /issue-23-task-01-server-duplicate-guard/);
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 23), "utf8"),
  );
  assert.equal(state.status, "implementing");
  assert.match(state.lastError, /Issue task todos remain open/);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "npm" &&
        call.args[0] === "run" &&
        call.args[1] === "cleanup:example",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args.includes("agent-done"),
    ),
    false,
  );
});

test("runOneIssue accepts direct squash-landed implementation results when skills.landing is configured", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    skills: LANDING_SKILLS,
  });
  const selected = issue(22, ["agent-ready", "bug"], "Fix direct landing");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-22-fix-direct-landing.md",
  );
  await writeFile(
    existingPlanPath,
    "# plan\n\n### Task 1: Blocker Task\n",
    "utf8",
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

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"merged","branch":"agent/issue-22-fix-direct-landing","mergeCommit":"abc999","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "merged");
  assert.equal(result.mergeCommit, "abc999");
  assert.equal(result.branch, "agent/issue-22-fix-direct-landing");
  assert.equal(
    result.planPath,
    "docs/plans/2026-05-01-issue-22-fix-direct-landing.md",
  );
  assert.equal(
    result.worktreePath,
    ".worktrees/patchmill-issue-22-fix-direct-landing",
  );
  assert.deepEqual(result.validation, ["just issue-runner-test ok"]);
  assert.equal(result.reviewSummary, "reviewed");
  assert.equal(
    result.landingDecision,
    "direct squash-landed: simple localized bug fix",
  );
  assert.ok(events.some((event) => event.message === "Merged to main: abc999"));

  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 2);
  assert.deepEqual(
    editCalls[1]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "22",
        "--remove-labels",
        "in-progress",
        "--add-labels",
        "agent-done",
      ],
      config.repoRoot,
    ),
  );

  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[1]), /Merged to `main`: abc999/);
  assert.match(
    commentBody(comments[1]),
    /direct squash-landed: simple localized bug fix/,
  );
  assert.match(commentBody(comments[1]), /just issue-runner-test ok/);
});

test("runOneIssue rejects Pi merged results when skills.landing is not configured", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const selected = issue(22, ["agent-ready", "bug"], "Fix direct landing");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-22-fix-direct-landing.md",
  );
  await writeFile(
    existingPlanPath,
    "# plan\n\n### Task 1: Blocker Task\n",
    "utf8",
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

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"merged","branch":"agent/issue-22-fix-direct-landing","mergeCommit":"abc999","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Pi returned merged but direct landing requires git\.allowDirectLand=true and configured skills\.landing/,
  );
});

test("runOneIssue rejects Pi merged results when direct landing is disabled", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    allowDirectLand: false,
  });
  const selected = issue(22, ["agent-ready", "bug"], "Fix direct landing");
  const existingPlanPath = join(
    config.plansDir,
    "2026-05-01-issue-22-fix-direct-landing.md",
  );
  await writeFile(
    existingPlanPath,
    "# plan\n\n### Task 1: Blocker Task\n",
    "utf8",
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

    if (
      call.command === "git" &&
      (call.args[0] === "status" || call.args[0] === "worktree")
    ) {
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      return {
        code: 0,
        stdout:
          '{"status":"merged","branch":"agent/issue-22-fix-direct-landing","mergeCommit":"abc999","commits":["def456"],"validation":["just issue-runner-test ok"],"reviewSummary":"reviewed","landingDecision":"direct squash-landed: simple localized bug fix"}',
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Pi returned merged while git\.allowDirectLand is false/,
  );
});
