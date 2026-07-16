import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DEFAULT_PATCHMILL_CONFIG } from "../../../config/defaults.ts";
import { runOneIssue } from "./pipeline.ts";
import { readRunState, writeRunState } from "./run-state.ts";
import {
  blockedRecoveryRunner,
  makeConfig,
  runPlanApprovedImplementationScenario,
  writeBlockedRecoveryRunState,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";
import { createMockRunner } from "../../../../test-support/run-once/mock-runner.ts";
import {
  issue,
  issueListPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

test("runOneIssue facade returns no-issue when no eligible issue exists", async () => {
  const config = await makeConfig();
  const runner = createMockRunner((call) => {
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout:
          page === "1" ? issueListPayload([issue(2, ["needs-info"])]) : "[]",
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.deepEqual(result, { status: "no-issue" });
});

test("runOneIssue facade returns dry-run selection", async () => {
  const selected = issue(7, ["agent-ready"], "Dry run issue");
  const config = await makeConfig({ dryRun: true });
  const runner = createMockRunner((call) => {
    if (call.command === "tea" && call.args[0] === "issues") {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([selected]) : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "merge-base")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(result.issue.number, 7);
});

test("runOneIssue facade returns plan-created in plan-only mode", async () => {
  const { result } = await runPlanApprovedImplementationScenario({
    issueNumber: 8,
    title: "Plan only issue",
    configOverrides: { planOnly: true },
  });

  assert.match(result.status, /^plan-(created|found)$/);
  assert.equal(result.issue.number, 8);
});

test("runOneIssue creates missing planning artifacts from the issue worktree in plan-only mode", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(12, ["agent-ready"], "Add once runner pipeline");
  const expectedBranch = "agent/issue-12-add-once-runner-pipeline";
  const expectedWorktreePath =
    ".worktrees/patchmill-issue-12-add-once-runner-pipeline";
  const expectedWorktreeRoot = join(config.repoRoot, expectedWorktreePath);
  const piCwds: Array<string | undefined> = [];

  const runner = createMockRunner((call) => {
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
    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 1, stdout: "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      assert.deepEqual(call.args, [
        "worktree",
        "add",
        "-b",
        expectedBranch,
        expectedWorktreePath,
        "HEAD",
      ]);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "labels" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "issues") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      piCwds.push(call.cwd);
      assert.equal(call.cwd, expectedWorktreeRoot);
      return { code: 0, stdout: "{}", stderr: "" };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.deepEqual(piCwds, [expectedWorktreeRoot, expectedWorktreeRoot]);
  const runState = await readRunState(config.runStateDir, 12);
  assert.equal(runState?.branch, expectedBranch);
  assert.equal(runState?.worktreePath, expectedWorktreePath);
});

test("runOneIssue resolves saved planning artifacts from the issue worktree on resume", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-worktree-only-plan.md";
  const worktreePath = ".worktrees/patchmill-issue-45-worktree-only-plan";
  const worktreeRoot = join(config.repoRoot, worktreePath);
  await mkdir(join(worktreeRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    join(worktreeRoot, planPath),
    "# worktree-only plan\n",
    "utf8",
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Worktree only plan",
      status: "planning",
      branch: "agent/issue-45-worktree-only-plan",
      worktreePath,
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planCreated: true,
      },
    },
    NOW.toISOString(),
  );

  const runner = createMockRunner((call) => {
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
                issue(45, ["in-progress", "bug"], "Worktree only plan"),
              ])
            : "[]",
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
      return { code: 0, stdout: `worktree ${worktreeRoot}\n`, stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-45-worktree-only-plan\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "issues") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      throw new Error("saved worktree plan should not be regenerated");
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, planPath);
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    false,
  );
});

test("runOneIssue facade returns pr-created after implementation", async () => {
  const { result } = await runPlanApprovedImplementationScenario({
    issueNumber: 9,
    title: "PR issue",
  });

  assert.equal(result.status, "pr-created");
  assert.equal(result.prUrl, "https://forgejo.example/pr/9");
});

test("runOneIssue facade returns merged for direct landing", async () => {
  const { result } = await runPlanApprovedImplementationScenario({
    issueNumber: 10,
    title: "Merged issue",
    configOverrides: {
      skills: {
        ...DEFAULT_PATCHMILL_CONFIG.skills,
        landing: "project-landing",
      },
    },
    onPi: () => ({
      code: 0,
      stdout: JSON.stringify({
        status: "merged",
        branch: "agent/issue-10-merged-issue",
        mergeCommit: "abc123",
        commits: ["def456"],
        validation: ["npm test"],
        reviewSummary: "reviewed",
        landingDecision: "direct squash-landed: policy-approved change",
      }),
      stderr: "",
    }),
  });

  assert.equal(result.status, "merged");
  assert.equal(result.mergeCommit, "abc123");
});

test("runOneIssue facade returns blocked implementation result", async () => {
  const { result } = await runPlanApprovedImplementationScenario({
    issueNumber: 11,
    title: "Blocked issue",
    onPi: () => ({
      code: 0,
      stdout: JSON.stringify({
        status: "blocked",
        reason: "need credentials",
        questions: [
          {
            question: "Which credential should be used?",
            recommendedAnswer: "Provide a test credential.",
          },
        ],
        commits: [],
        validation: ["not run"],
      }),
      stderr: "",
    }),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "need credentials");
});

test("runOneIssue facade records unexpected implementation failure", async () => {
  const { result } = await runPlanApprovedImplementationScenario({
    issueNumber: 12,
    title: "Unexpected issue",
    onPi: () => ({
      code: 1,
      stdout: "",
      stderr: "implementation exploded",
    }),
  });

  assert.equal(result.status, "blocked");
  assert.match(
    result.reason,
    /implementation exploded|supported final JSON status/,
  );
});

test("runOneIssue facade resumes saved blocked implementation state", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await mkdir(
    join(config.repoRoot, ".worktrees/patchmill-issue-45-recover-blocked-run"),
    {
      recursive: true,
    },
  );
  await writeFile(
    join(
      config.repoRoot,
      ".worktrees/patchmill-issue-45-recover-blocked-run/.gitkeep",
    ),
    "",
    "utf8",
  );
  await writeBlockedRecoveryRunState(config, undefined, {
    createWorktreePath: true,
    writePlanInWorktree: true,
  });
  const runner = blockedRecoveryRunner(config);

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created");
  assert.equal(result.issue.number, 45);
});
