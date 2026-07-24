import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runStatePath, writeRunState } from "./run-state.ts";
import { runOneIssue } from "./pipeline.ts";
import { formatPublishedArtifactComment } from "../../../workflow/artifacts/published-artifacts.ts";
import {
  issue,
  issueListPayload,
  labelListPayload,
} from "../../../../test-support/run-once/issue-fixtures.ts";
import {
  createMockRunner,
  promptPath,
  workflowPiCalls,
} from "../../../../test-support/run-once/mock-runner.ts";
import {
  approvalPolicy,
  makeConfig,
  specAndPlanApprovalPolicy,
} from "../../../../test-support/run-once/pipeline-fixtures.ts";
import {
  collectProgressEvents,
  commentBody,
} from "../../../../test-support/run-once/assertions.ts";

const NOW = new Date("2026-05-09T12:00:00.000Z");

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

test("runOneIssue does not duplicate claim or plan-only comments on resume", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  await writeFile(
    join(config.plansDir, "2026-05-14-issue-45-resume-plan-only.md"),
    "# plan\n",
    "utf8",
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume plan only",
      status: "planning",
      planPath: "docs/plans/2026-05-14-issue-45-resume-plan-only.md",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planPathResolved: true,
        readyLabelRestored: true,
        planReadyCommentPosted: true,
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
            ? issueListPayload([issue(45, ["in-progress"], "Resume plan only")])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
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
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.issue.number, 45);
  assert.equal(
    runner.calls.filter(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ).length,
    0,
  );
  assert.equal(
    runner.calls.filter(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    ).length,
    0,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(runState.status, "finished");
  assert.deepEqual(runState.checkpoints, {
    claimed: true,
    startedCommentPosted: true,
    planPathResolved: true,
    readyLabelRestored: true,
    planReadyCommentPosted: true,
  });
});

test("runOneIssue reuses a saved created plan as plan-created in plan-only mode", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-saved-created-plan.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Saved created plan",
      status: "planning",
      planPath,
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        planCreated: true,
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
                issue(45, ["in-progress", "bug"], "Saved created plan"),
              ])
            : "[]",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "status")
      return { code: 0, stdout: "", stderr: "" };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  if (result.status !== "plan-created") {
    throw new Error(JSON.stringify(result, null, 2));
  }
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 1);
  assert.match(commentBody(comments[0]), /Plan ready/);
  assert.doesNotMatch(commentBody(comments[0]), /Existing plan ready/);
});

test("runOneIssue uses deterministic published artifacts before filename discovery", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const specPath = "docs/specs/human-provided-design.md";
  const planPath = "docs/plans/human-provided-plan.md";
  await writeFile(
    join(
      config.repoRoot,
      "docs",
      "plans",
      "2026-05-09-issue-65-resolve-provided-artifacts.md",
    ),
    "# Discovered Plan\n",
    "utf8",
  );

  const selected = {
    ...issue(
      65,
      ["plan-approved", "enhancement"],
      "Resolve provided artifacts",
    ),
    comments: [
      {
        authorLogin: "patchmill-bot",
        body: formatPublishedArtifactComment({
          kind: "spec",
          path: specPath,
          content: "# Human Spec\n\nUse the published design.",
        }),
      },
      {
        authorLogin: "patchmill-bot",
        body: formatPublishedArtifactComment({
          kind: "plan",
          path: planPath,
          content: "# Human Plan\n\n- [ ] Build from the published plan",
        }),
      },
    ],
  };
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
    if (call.command === "git" && call.args[0] === "add")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "diff")
      return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "commit")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "rev-parse")
      return { code: 0, stdout: "artifact123\n", stderr: "" };
    if (call.command === "git" && call.args[0] === "show-ref")
      return { code: 1, stdout: "", stderr: "" };
    if (call.command === "git" && call.args[0] === "worktree")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "logins")
      return {
        code: 0,
        stdout: JSON.stringify([
          { name: "default", user: "patchmill-bot", default: true },
        ]),
        stderr: "",
      };
    if (call.command === "tea" && call.args[0] === "labels")
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    if (
      call.command === "tea" &&
      (call.args[0] === "issues" || call.args[0] === "comment")
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.doesNotMatch(prompt, /Extract spec and plan artifact sources/);
      assert.match(prompt, new RegExp(`Plan path: ${planPath}`));
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo.example/pr/65",
          branch: "agent/issue-65-resolve-provided-artifacts",
          commits: ["abc123"],
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

  const { events, progress } = collectProgressEvents();
  const result = await runOneIssue(runner, config, { now: NOW, progress });

  assert.equal(result.status, "pr-created");
  assert.equal(result.specPath, specPath);
  assert.equal(result.planPath, planPath);
  assert.ok(
    events.some(
      (event) =>
        event.step?.type === "step-start" &&
        event.step.label === "extract issue artifact sources",
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.step?.type === "step-complete" &&
        event.step.label === "extract issue artifact sources",
    ),
  );
  const expectedWorktreeRoot = join(
    config.repoRoot,
    ".worktrees",
    "patchmill-issue-65-resolve-provided-artifacts",
  );
  assert.equal(
    await readFile(join(expectedWorktreeRoot, specPath), "utf8"),
    "# Human Spec\n\nUse the published design.\n",
  );
  assert.equal(
    await readFile(join(expectedWorktreeRoot, planPath), "utf8"),
    "# Human Plan\n\n- [ ] Build from the published plan\n",
  );
});

test("runOneIssue fails before claim when deterministic artifact checksum mismatches", async () => {
  const config = await makeConfig({ dryRun: false, execute: true });
  const brokenComment = formatPublishedArtifactComment({
    kind: "spec",
    path: "docs/specs/broken.md",
    content: "# Original Spec\n\nUse this content.",
  }).replace("Use this content.", "Use edited content.");
  const selected = {
    ...issue(65, ["agent-ready", "enhancement"], "Broken published artifact"),
    comments: [{ authorLogin: "patchmill-bot", body: brokenComment }],
  };
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
    if (call.command === "tea" && call.args[0] === "logins")
      return {
        code: 0,
        stdout: JSON.stringify([
          { name: "default", user: "patchmill-bot", default: true },
        ]),
        stderr: "",
      };
    throw new Error(
      `unexpected command before deterministic artifact failure: ${call.command} ${call.args.join(" ")}`,
    );
  });

  await assert.rejects(
    runOneIssue(runner, config, { now: NOW }),
    /checksum mismatch/,
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    ),
    false,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] === "comment",
    ),
    false,
  );
});

test("runOneIssue dry-run does not read deterministic artifact sources", async () => {
  const config = await makeConfig({ dryRun: true, execute: false });
  const selected = issue(
    65,
    ["agent-ready", "enhancement"],
    "Resolve provided artifacts",
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
    if (call.command === "git" && call.args[0] === "rev-parse")
      return { code: 0, stdout: "abc123\n", stderr: "" };
    if (call.command === "git" && call.args[0] === "log")
      return { code: 0, stdout: "", stderr: "" };
    throw new Error(
      `unexpected dry-run command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "dry-run");
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    false,
  );
});

test("runOneIssue writes spec and stops at spec-review when spec approval is required", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(31, ["agent-ready", "enhancement"], "Needs spec");
  const expectedSpecPath =
    "docs/specs/2026-05-09-issue-31-needs-spec-design.md";
  const specContent = "# Needs spec\n\nApproved behavior.\n";
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create a design spec/);
      assert.ok(call.cwd);
      const absoluteSpecPath = join(call.cwd, expectedSpecPath);
      await mkdir(dirname(absoluteSpecPath), { recursive: true });
      await writeFile(absoluteSpecPath, specContent, "utf8");
      return {
        code: 0,
        stdout: `spec done\n{"status":"spec-created","specPath":"${expectedSpecPath}","commit":"abc123"}`,
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "spec-created");
  assert.equal(result.specPath, expectedSpecPath);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  const finalEdit = editCalls.at(-1);
  assert.ok(finalEdit);
  assert.equal(
    finalEdit.args[finalEdit.args.indexOf("--add-labels") + 1],
    "spec-review",
  );
  assert.equal(finalEdit.args.includes("agent-ready"), false);
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
});

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

test("runOneIssue stops at spec-review when agent-ready has an existing spec and spec approval is required", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(34, ["agent-ready", "enhancement"], "Existing spec");
  const specPath = "docs/specs/2026-05-09-issue-34-existing-spec-design.md";
  await writeFile(join(config.repoRoot, specPath), "# Spec\n", "utf8");
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
      throw new Error("Pi should not run when an existing spec needs review");
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "spec-found");
  assert.equal(result.specPath, specPath);
  const finalEdit = runner.calls
    .filter(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    )
    .at(-1);
  assert.ok(finalEdit);
  assert.equal(
    finalEdit.args[finalEdit.args.indexOf("--add-labels") + 1],
    "spec-review",
  );
});

test("runOneIssue stops at spec-review for plan-approved issues without spec approval", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(
    36,
    ["plan-approved", "enhancement"],
    "Plan-only approval",
  );
  const specPath =
    "docs/specs/2026-05-09-issue-36-plan-only-approval-design.md";
  await writeFile(join(config.repoRoot, specPath), "# Spec\n", "utf8");
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
      throw new Error("Pi should not run when existing spec lacks approval");
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "spec-found");
  assert.equal(result.specPath, specPath);
  const finalEdit = runner.calls
    .filter(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    )
    .at(-1);
  assert.ok(finalEdit);
  assert.equal(
    finalEdit.args[finalEdit.args.indexOf("--add-labels") + 1],
    "spec-review",
  );
  assert.equal(finalEdit.args.includes("plan-approved"), false);
});

test("runOneIssue fails fast when saved spec path access fails unexpectedly", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(37, ["agent-ready", "enhancement"], "Unreadable spec");
  await writeFile(
    join(config.repoRoot, "docs", "not-a-dir"),
    "not a dir",
    "utf8",
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 37,
      title: "Unreadable spec",
      status: "planning",
      specPath: "docs/not-a-dir/spec.md",
      checkpoints: { specPathResolved: true },
    },
    NOW.toISOString(),
  );
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
        stdout:
          page === "1"
            ? issueListPayload([
                { ...selected, labels: ["in-progress", "enhancement"] },
              ])
            : "[]",
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
      piCalls += 1;
      return {
        code: 0,
        stdout:
          '{"status":"spec-created","specPath":"docs/specs/recreated.md","commit":"abc123"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /ENOTDIR|not a directory/);
  assert.equal(piCalls, 0);
});

test("runOneIssue fails fast when saved plan path access fails unexpectedly", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(38, ["agent-ready", "enhancement"], "Unreadable plan");
  await writeFile(
    join(config.repoRoot, "docs", "not-a-dir"),
    "not a dir",
    "utf8",
  );
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 38,
      title: "Unreadable plan",
      status: "planning",
      planPath: "docs/not-a-dir/plan.md",
      checkpoints: { planPathResolved: true },
    },
    NOW.toISOString(),
  );
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
        stdout:
          page === "1"
            ? issueListPayload([
                { ...selected, labels: ["in-progress", "enhancement"] },
              ])
            : "[]",
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
      piCalls += 1;
      return {
        code: 0,
        stdout:
          '{"status":"plan-created","planPath":"docs/plans/recreated.md","commit":"abc123"}',
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /ENOTDIR|not a directory/);
  assert.equal(piCalls, 0);
});

test("runOneIssue treats a newly-created replacement spec as needing fresh approval", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(
    35,
    ["spec-approved", "plan-approved", "enhancement"],
    "Missing approved spec",
  );
  const expectedSpecPath =
    "docs/specs/2026-05-09-issue-35-missing-approved-spec-design.md";
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
      assert.ok(call.cwd);
      const absoluteSpecPath = join(call.cwd, expectedSpecPath);
      await mkdir(dirname(absoluteSpecPath), { recursive: true });
      await writeFile(absoluteSpecPath, "# Missing approved spec\n", "utf8");
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

  assert.equal(result.status, "spec-created");
  assert.equal(result.specPath, expectedSpecPath);
  const finalEdit = runner.calls
    .filter(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    )
    .at(-1);
  assert.ok(finalEdit);
  assert.equal(
    finalEdit.args[finalEdit.args.indexOf("--add-labels") + 1],
    "spec-review",
  );
  assert.equal(finalEdit.args.includes("spec-approved"), false);
  assert.equal(finalEdit.args.includes("plan-approved"), false);
});

test("runOneIssue writes plan from spec-approved and cleans spec labels at plan-review", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(
    32,
    ["spec-review", "spec-approved", "enhancement"],
    "Needs plan",
  );
  const specPath = "docs/specs/2026-05-09-issue-32-needs-plan-design.md";
  await writeFile(join(config.repoRoot, specPath), "# Spec\n", "utf8");
  const expectedPlanPath = "docs/plans/2026-05-09-issue-32-needs-plan.md";
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
      assert.match(prompt, /Create an implementation plan/);
      assert.match(
        prompt,
        new RegExp(specPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      assert.ok(call.cwd);
      const absolutePlanPath = join(call.cwd, expectedPlanPath);
      await mkdir(dirname(absolutePlanPath), { recursive: true });
      await writeFile(absolutePlanPath, "# Generated plan\n", "utf8");
      return {
        code: 0,
        stdout: `plan done\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"def456"}`,
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, expectedPlanPath);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  const finalEdit = editCalls.at(-1);
  assert.ok(finalEdit);
  assert.equal(
    finalEdit.args[finalEdit.args.indexOf("--add-labels") + 1],
    "plan-review",
  );
  assert.equal(finalEdit.args.includes("spec-review"), false);
  assert.equal(finalEdit.args.includes("spec-approved"), false);
});

test("runOneIssue resumes approved spec review with saved planning worktree", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  const selected = issue(
    52,
    ["spec-review", "spec-approved", "enhancement"],
    "Approved spec worktree",
  );
  const worktreePath = ".worktrees/patchmill-issue-52-approved-spec-worktree";
  const specPath =
    "docs/specs/2026-05-09-issue-52-approved-spec-worktree-design.md";
  const planPath = "docs/plans/2026-05-09-issue-52-approved-spec-worktree.md";
  await mkdir(join(config.repoRoot, worktreePath, "docs", "specs"), {
    recursive: true,
  });
  await writeFile(join(config.repoRoot, worktreePath, specPath), "# Spec\n");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 52,
      title: "Approved spec worktree",
      status: "finished",
      branch: "agent/issue-52-approved-spec-worktree",
      worktreePath,
      specPath,
      specCommit: "abc123",
      checkpoints: {
        specPathResolved: true,
        specCreated: true,
        specPublished: true,
        specReadyCommentPosted: true,
        readyLabelRestored: true,
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
      call.args[1] === worktreePath &&
      call.args[2] === "branch" &&
      call.args[3] === "--show-current"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-52-approved-spec-worktree\n",
        stderr: "",
      };
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
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create an implementation plan/);
      assert.match(
        prompt,
        new RegExp(specPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      assert.ok(call.cwd);
      const absolutePlanPath = join(call.cwd, planPath);
      await mkdir(dirname(absolutePlanPath), { recursive: true });
      await writeFile(absolutePlanPath, "# Generated plan\n", "utf8");
      return {
        code: 0,
        stdout: `plan done\n{"status":"plan-created","planPath":"${planPath}","commit":"def456"}`,
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, planPath);
  assert.equal(workflowPiCalls(runner.calls).length, 1);
  assert.equal(
    workflowPiCalls(runner.calls)[0]?.cwd,
    join(config.repoRoot, worktreePath),
  );
});

test("runOneIssue re-adds in-progress when approved plan resumes from saved planning worktree", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: approvalPolicy({ planRequired: true }),
  });
  const selected = issue(
    53,
    ["plan-review", "plan-approved", "enhancement"],
    "Approved plan worktree",
  );
  const worktreePath = ".worktrees/patchmill-issue-53-approved-plan-worktree";
  const planPath = "docs/plans/2026-05-09-issue-53-approved-plan-worktree.md";
  await mkdir(join(config.repoRoot, worktreePath, "docs", "plans"), {
    recursive: true,
  });
  await writeFile(join(config.repoRoot, worktreePath, planPath), "# Plan\n");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 53,
      title: "Approved plan worktree",
      status: "finished",
      branch: "agent/issue-53-approved-plan-worktree",
      worktreePath,
      planPath,
      planCommit: "def456",
      checkpoints: {
        claimed: true,
        planPathResolved: true,
        planCreated: true,
        planPublished: true,
        planReadyCommentPosted: true,
        readyLabelRestored: true,
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
      call.args[1] === worktreePath &&
      call.args[2] === "branch" &&
      call.args[3] === "--show-current"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-53-approved-plan-worktree\n",
        stderr: "",
      };
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
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Implement/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "blocked",
          reason: "implementation needs human input",
          questions: [],
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
  assert.equal(
    workflowPiCalls(runner.calls)[0]?.cwd,
    join(config.repoRoot, worktreePath),
  );
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit" &&
        call.args[call.args.indexOf("--add-labels") + 1] === "in-progress",
    ),
    true,
  );
});

test("runOneIssue writes spec then plan and stops at plan-review when only plan approval is required", async () => {
  const config = await makeConfig({
    execute: true,
    dryRun: false,
    approvalPolicy: approvalPolicy({ specRequired: false, planRequired: true }),
  });
  const selected = issue(
    33,
    ["agent-ready", "enhancement"],
    "Needs spec and plan",
  );
  const expectedSpecPath =
    "docs/specs/2026-05-09-issue-33-needs-spec-and-plan-design.md";
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-33-needs-spec-and-plan.md";
  const specContent = "# Generated spec\n\nPlanning context.\n";
  const planContent = "# Generated plan\n\n- [ ] Implement behavior.\n";
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
      (call.args[0] === "issues" || call.args[0] === "comment")
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (call.command === "pi") {
      piCalls += 1;
      if (piCalls === 1) {
        assert.ok(call.cwd);
        const absoluteSpecPath = join(call.cwd, expectedSpecPath);
        await mkdir(dirname(absoluteSpecPath), { recursive: true });
        await writeFile(absoluteSpecPath, specContent, "utf8");
        return {
          code: 0,
          stdout: `{"status":"spec-created","specPath":"${expectedSpecPath}","commit":"abc123"}`,
          stderr: "",
        };
      }
      assert.ok(call.cwd);
      const absolutePlanPath = join(call.cwd, expectedPlanPath);
      await mkdir(dirname(absolutePlanPath), { recursive: true });
      await writeFile(absolutePlanPath, planContent, "utf8");
      return {
        code: 0,
        stdout: `{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"def456"}`,
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.specPath, expectedSpecPath);
  assert.equal(result.planPath, expectedPlanPath);
  assert.equal(piCalls, 2);
  const commentBodies = runner.calls
    .filter((call) => call.command === "tea" && call.args[0] === "comment")
    .map(commentBody);
  assert.equal(commentBodies.includes(publishedSpec), false);
  assert.equal(commentBodies.includes(publishedPlan), true);
  const publishedIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "comment" &&
      commentBody(call) === publishedPlan,
  );
  const readyIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "comment" &&
      /Plan ready/.test(commentBody(call)),
  );
  const reviewLabelIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit" &&
      call.args.includes("plan-review"),
  );
  assert.ok(publishedIndex >= 0);
  assert.ok(publishedIndex < readyIndex);
  assert.ok(readyIndex < reviewLabelIndex);
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 33), "utf8"),
  );
  assert.equal(state.checkpoints.specPublished, undefined);
  assert.equal(state.checkpoints.planPublished, true);
});

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

test("runOneIssue stops after finding an existing plan when plan approval is required", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    approvalPolicy: approvalPolicy({ planRequired: true }),
  });
  const planPath = "docs/plans/2026-05-14-issue-47-approval-existing-plan.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  const selected = issue(47, ["agent-ready", "bug"], "Approval existing plan");
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
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-found");
  assert.equal(result.planPath, planPath);
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    false,
  );
  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[1]), /Existing plan ready/);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  const restoreCall = editCalls.at(-1);
  assert.ok(restoreCall);
  assert.equal(
    restoreCall.args[restoreCall.args.indexOf("--add-labels") + 1],
    "plan-review",
  );
});

test("runOneIssue stops after creating a plan when plan approval is required", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    approvalPolicy: approvalPolicy({ planRequired: true }),
  });
  const selected = issue(48, ["agent-ready", "bug"], "Approval created plan");
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-48-approval-created-plan.md";
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
      assert.match(prompt, /Create an implementation plan/);
      assert.ok(call.cwd);
      const absolutePlanPath = join(call.cwd, expectedPlanPath);
      await mkdir(dirname(absolutePlanPath), { recursive: true });
      await writeFile(absolutePlanPath, "# Generated plan\n", "utf8");
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, expectedPlanPath);
  assert.equal((await workflowPiCalls(runner.calls)).length, 2);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    true,
  );
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "show-ref",
    ),
    true,
  );
});

test("runOneIssue ignores stale plan approval when a new plan is created", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    approvalPolicy: approvalPolicy({ planRequired: true }),
  });
  const selected = issue(
    50,
    ["agent-ready", "plan-approved", "bug"],
    "Stale plan approval",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-50-stale-plan-approval.md";
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
      assert.match(prompt, /Create an implementation plan/);
      assert.ok(call.cwd);
      const absolutePlanPath = join(call.cwd, expectedPlanPath);
      await mkdir(dirname(absolutePlanPath), { recursive: true });
      await writeFile(absolutePlanPath, "# Generated plan\n", "utf8");
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }
    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, expectedPlanPath);
  assert.equal((await workflowPiCalls(runner.calls)).length, 2);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args[0] === "worktree",
    ),
    true,
  );
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  const restoreCall = editCalls.at(-1);
  assert.ok(restoreCall);
  assert.equal(
    restoreCall.args[restoreCall.args.indexOf("--add-labels") + 1],
    "plan-review",
  );
  assert.equal(
    restoreCall.args[restoreCall.args.indexOf("--remove-labels") + 1],
    "plan-approved,in-progress",
  );
});

test("runOneIssue proceeds when plan approval label is present and clears plan-review", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    approvalPolicy: approvalPolicy({ planRequired: true }),
  });
  const planPath = "docs/plans/2026-05-14-issue-49-approved-plan.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  const selected = issue(
    49,
    [
      "agent-ready",
      "spec-review",
      "spec-approved",
      "plan-review",
      "plan-approved",
      "bug",
    ],
    "Approved plan",
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
      return {
        code: 0,
        stdout: labelListPayload([
          "agent-ready",
          "in-progress",
          "agent-done",
          "spec-review",
          "spec-approved",
          "plan-review",
          "plan-approved",
        ]),
        stderr: "",
      };
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    )
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "tea" && call.args[0] === "comment")
      return { code: 0, stdout: "", stderr: "" };
    if (call.command === "pi") {
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/49",
          branch: "agent/issue-49-approved-plan",
          commits: ["abc123"],
          validation: [
            "node --test src/cli/commands/run-once/pipeline.test.ts",
          ],
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
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  const finalEdit = editCalls.at(-1);
  assert.ok(finalEdit);
  assert.equal(finalEdit.args.includes("spec-review"), false);
  assert.equal(finalEdit.args.includes("spec-approved"), false);
  assert.equal(finalEdit.args.includes("plan-review"), false);
  assert.equal(finalEdit.args.includes("plan-approved"), false);
});

test("runOneIssue claims the issue, comments automation start, writes run state, and exits plan-created for plan-only mode", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
  });
  const selected = issue(
    12,
    ["agent-ready", "bug", "priority:high"],
    "Add once runner pipeline",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-12-add-once-runner-pipeline.md";
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
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      assert.equal(call.cwd, config.repoRoot);
      const prompt = await readFile(promptPath(call.args), "utf8");
      assert.match(prompt, /Create an implementation plan/);
      assert.match(
        prompt,
        new RegExp(expectedPlanPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "plan-created");
  assert.equal(result.planPath, expectedPlanPath);
  const editCalls = runner.calls.filter(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit",
  );
  assert.equal(editCalls.length, 2);
  assert.deepEqual(
    editCalls[0]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "12",
        "--remove-labels",
        "agent-ready",
        "--add-labels",
        "in-progress",
      ],
      config.repoRoot,
    ),
  );
  assert.deepEqual(
    editCalls[1]?.args,
    withRepo(
      [
        "issues",
        "edit",
        "12",
        "--remove-labels",
        "in-progress",
        "--add-labels",
        "agent-ready",
      ],
      config.repoRoot,
    ),
  );
  const addedLabels = editCalls.flatMap((call) => {
    const index = call.args.indexOf("--add-labels");
    return index >= 0 ? [call.args[index + 1]] : [];
  });
  assert.equal(addedLabels.includes("agent-ready"), true);

  const comments = runner.calls.filter(
    (call) => call.command === "tea" && call.args[0] === "comment",
  );
  assert.equal(comments.length, 2);
  assert.match(commentBody(comments[0]), /Automation started/);
  assert.match(commentBody(comments[1]), /Plan ready/);

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 12), "utf8"),
  );
  assert.equal(runState.status, "finished");
  assert.equal(runState.planPath, expectedPlanPath);
  assert.equal(runState.planCommit, "abc123");
  assert.deepEqual(runState.checkpoints, {
    claimed: true,
    startedCommentPosted: true,
    specPathResolved: true,
    specCreated: true,
    planPathResolved: true,
    planCreated: true,
    readyLabelRestored: true,
    planReadyCommentPosted: true,
  });
  assert.equal(runState.claimedAt, NOW.toISOString());
  assert.equal(runState.planningAt, NOW.toISOString());
  assert.equal(runState.finishedAt, NOW.toISOString());
});

test("runOneIssue plan-only keeps planning resumable when the plan-ready comment fails", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    planOnly: true,
    approvalPolicy: approvalPolicy({ planRequired: true }),
  });
  const selected = issue(
    13,
    ["agent-ready", "bug"],
    "Recover plan-only comment failure",
  );
  const expectedPlanPath =
    "docs/plans/2026-05-09-issue-13-recover-plan-only-comment-failure.md";
  const planContent = "# Retry plan\n\n- [ ] Recover publication.\n";
  const publishedPlan = formatPublishedArtifactComment({
    kind: "plan",
    path: expectedPlanPath,
    content: planContent,
  });
  let commentCalls = 0;
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
      call.args[0] === "issues" &&
      call.args[1] === "edit"
    ) {
      return { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "tea" && call.args[0] === "comment") {
      commentCalls += 1;
      return commentCalls === 3
        ? { code: 1, stdout: "", stderr: "comment exploded" }
        : { code: 0, stdout: "", stderr: "" };
    }

    if (call.command === "pi") {
      assert.ok(call.cwd);
      const absolutePlanPath = join(call.cwd, expectedPlanPath);
      await mkdir(dirname(absolutePlanPath), { recursive: true });
      await writeFile(absolutePlanPath, planContent, "utf8");
      return {
        code: 0,
        stdout: `planning...\n{"status":"plan-created","planPath":"${expectedPlanPath}","commit":"abc123"}`,
        stderr: "",
      };
    }

    throw new Error(
      `unexpected command: ${call.command} ${call.args.join(" ")}`,
    );
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /tea comment failed for #13: comment exploded/);
  const failedCommentIndex = runner.calls.findIndex(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "comment" &&
      /Plan ready/.test(commentBody(call)),
  );
  assert.ok(failedCommentIndex >= 0);
  assert.equal(
    runner.calls.filter(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "issues" &&
        call.args[1] === "edit",
    ).length,
    1,
  );

  const runState = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 13), "utf8"),
  );
  assert.equal(runState.status, "planning");
  assert.equal(runState.planCommit, "abc123");
  assert.equal(runState.checkpoints.planPublished, true);
  assert.equal(runState.checkpoints.readyLabelRestored, undefined);
  assert.equal(runState.checkpoints.planReadyCommentPosted, undefined);

  const retrySelected = { ...selected, labels: ["in-progress", "bug"] };
  const retryWorktreePath =
    ".worktrees/patchmill-issue-13-recover-plan-only-comment-failure";
  const retryRunner = createMockRunner(async (call) => {
    if (
      call.command === "git" &&
      call.args[0] === "worktree" &&
      call.args[1] === "list"
    ) {
      return {
        code: 0,
        stdout: `worktree ${join(config.repoRoot, retryWorktreePath)}\n`,
        stderr: "",
      };
    }
    if (
      call.command === "git" &&
      call.args[0] === "-C" &&
      call.args[1] === retryWorktreePath &&
      call.args[2] === "branch"
    ) {
      return {
        code: 0,
        stdout: "agent/issue-13-recover-plan-only-comment-failure\n",
        stderr: "",
      };
    }
    if (
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "list"
    ) {
      const page = call.args[call.args.indexOf("--page") + 1];
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([retrySelected]) : "[]",
        stderr: "",
      };
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
      throw new Error("Pi should not rerun after a persisted plan");
    }
    throw new Error(
      `unexpected retry command: ${call.command} ${call.args.join(" ")}`,
    );
  });
  const retry = await runOneIssue(retryRunner, config, { now: NOW });
  assert.equal(
    retry.status,
    "plan-created",
    retry.status === "blocked" ? retry.reason : undefined,
  );
  assert.equal(
    retryRunner.calls.some(
      (call) =>
        call.command === "tea" &&
        call.args[0] === "comment" &&
        commentBody(call) === publishedPlan,
    ),
    false,
  );
});
