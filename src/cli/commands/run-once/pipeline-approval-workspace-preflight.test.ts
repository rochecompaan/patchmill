import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { runOneIssue } from "./pipeline.ts";
import { formatPublishedArtifactComment } from "../../../workflow/artifacts/published-artifacts.ts";
import { writeRunState } from "./run-state.ts";
import {
  issue,
  issueListPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  createMockRunner,
  workflowPiCalls,
} from "../../../../test-support/run-once/mock-runner.ts";
import {
  makeConfig,
  specAndPlanApprovalPolicy,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

test("runOneIssue rejects an unregistered stale approved resume worktree before mutation", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const planPath = "docs/plans/2026-05-14-issue-45-stale-worktree.md";
  const worktreePath = ".worktrees/patchmill-issue-45-stale-worktree";
  await mkdir(join(config.repoRoot, worktreePath, "docs", "plans"), {
    recursive: true,
  });
  await writeFile(join(config.repoRoot, worktreePath, planPath), "# plan\n");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Stale worktree",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-stale-worktree",
      worktreePath,
    },
    NOW.toISOString(),
  );
  const selected = issue(
    45,
    ["in-progress", "plan-approved"],
    "Stale worktree",
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
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
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
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /plan-approved.*no plan artifact could be resolved/u,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        ((call.args[0] === "issues" && call.args[1] === "edit") ||
          call.args[0] === "comment"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "add",
    ),
    false,
  );
});

test("runOneIssue rejects an approved resume worktree on the wrong branch before mutation", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const planPath = "docs/plans/2026-05-14-issue-45-wrong-branch.md";
  const worktreePath = ".worktrees/patchmill-issue-45-wrong-branch";
  await mkdir(join(config.repoRoot, worktreePath, "docs", "plans"), {
    recursive: true,
  });
  await writeFile(join(config.repoRoot, worktreePath, planPath), "# plan\n");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Wrong branch",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-wrong-branch",
      worktreePath,
    },
    NOW.toISOString(),
  );
  const selected = issue(45, ["in-progress", "plan-approved"], "Wrong branch");
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
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, worktreePath)}\n`,
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return { code: 0, stdout: "agent/other-issue\n", stderr: "" };
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
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Existing worktree .* is on agent\/other-issue, expected agent\/issue-45-wrong-branch/u,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        ((call.args[0] === "issues" && call.args[1] === "edit") ||
          call.args[0] === "comment"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "add",
    ),
    false,
  );
});

test("runOneIssue resumes an approved branch-only saved plan", async () => {
  const issueNumber = 68;
  const title = "Branch-only saved plan";
  const planPath = "docs/plans/2026-05-14-issue-68-branch-only-saved-plan.md";
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
    issueNumber,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const branch = "agent/issue-68-branch-only-saved-plan";
  const worktreePath = ".worktrees/patchmill-issue-68-branch-only-saved-plan";
  await writeRunState(
    config.runStateDir,
    {
      issueNumber,
      title,
      status: "implementing",
      planPath,
      branch,
      worktreePath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
    },
    NOW.toISOString(),
  );
  const selected = issue(issueNumber, ["in-progress", "plan-approved"], title);
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
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "cat-file") {
      return {
        code: 0,
        stdout: call.args[1] === "-t" ? "blob\n" : "",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "show") {
      return { code: 0, stdout: "# plan\n", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add"
    ) {
      await mkdir(join(config.repoRoot, worktreePath, "docs", "plans"), {
        recursive: true,
      });
      await writeFile(
        join(config.repoRoot, worktreePath, planPath),
        "# plan\n",
      );
      return { code: 0, stdout: "", stderr: "" };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[2] === "branch"
    ) {
      return { code: 0, stdout: `${branch}\n`, stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "log") {
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
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/68",
          branch,
          commits: ["abc123"],
          validation: ["focused test passed"],
        }),
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.equal((await workflowPiCalls(runner.calls)).length, 1);
  const worktreeAdd = runner.calls.findIndex(
    (call) =>
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "add",
  );
  const firstPi = runner.calls.findIndex((call) => call.command === "pi");
  assert.ok(worktreeAdd >= 0);
  assert.ok(worktreeAdd < firstPi);
});

test("runOneIssue rejects a missing branch saved plan before mutation despite a matching published source", async () => {
  const issueNumber = 70;
  const title = "Missing branch saved plan";
  const planPath =
    "docs/plans/2026-05-14-issue-70-missing-branch-saved-plan.md";
  const branch = "agent/issue-70-missing-branch-saved-plan";
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
    issueNumber,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  await writeRunState(
    config.runStateDir,
    {
      issueNumber,
      title,
      status: "implementing",
      branch,
      planPath,
      worktreePath: ".worktrees/patchmill-issue-70-missing-branch-saved-plan",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
      },
    },
    NOW.toISOString(),
  );
  const selected = issue(issueNumber, ["in-progress", "plan-approved"], title);
  selected.comments = [
    {
      author: { login: "patchmill-bot" },
      body: formatPublishedArtifactComment({
        kind: "plan",
        path: planPath,
        content: "# Matching published plan\n",
      }),
    },
  ];
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
    if (call.command === "tea" && call.args[0] === "logins") {
      return {
        code: 0,
        stdout: JSON.stringify([
          { name: "default", user: "patchmill-bot", default: true },
        ]),
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "show-ref") {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "git" && call.args[0] === "cat-file") {
      return { code: 1, stdout: "", stderr: "missing" };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Saved plan .* does not exist on issue branch/u,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        ((call.args[0] === "issues" && call.args[1] === "edit") ||
          call.args[0] === "comment"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "add",
    ),
    false,
  );
});

test("runOneIssue rejects an issue branch already checked out elsewhere before mutation", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 69,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const title = "Branch checked out elsewhere";
  const branch = "agent/issue-69-branch-checked-out-elsewhere";
  const selected = issue(69, ["plan-approved"], title);
  const otherWorktree = join(config.repoRoot, ".worktrees", "other-issue");
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
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${otherWorktree}\nbranch refs/heads/${branch}\n\n`,
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /already checked out at .*other-issue/u,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        ((call.args[0] === "issues" && call.args[1] === "edit") ||
          call.args[0] === "comment"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "add",
    ),
    false,
  );
});

test("runOneIssue rejects duplicate expected branch worktree registrations before mutation", async () => {
  const issueNumber = 71;
  const title = "Duplicate branch worktrees";
  const branch = "agent/issue-71-duplicate-branch-worktrees";
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const expectedPath = join(
    config.repoRoot,
    ".worktrees/patchmill-issue-71-duplicate-branch-worktrees",
  );
  const otherPath = join(config.repoRoot, ".worktrees/duplicate-checkout");
  const selected = issue(issueNumber, ["plan-approved"], title);
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
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${expectedPath}\nbranch refs/heads/${branch}\n\nworktree ${otherPath}\nbranch refs/heads/${branch}\n\n`,
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status") {
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /already checked out at .*duplicate-checkout/u,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        ((call.args[0] === "issues" && call.args[1] === "edit") ||
          call.args[0] === "comment"),
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "add",
    ),
    false,
  );
});
