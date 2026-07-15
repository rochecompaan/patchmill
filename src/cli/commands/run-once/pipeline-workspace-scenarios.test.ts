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

test("runOneIssue reuses existing implementation worktree on resume", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
  });
  const planPath = "docs/plans/2026-05-14-issue-45-resume-worktree.md";
  await writeFile(join(config.repoRoot, planPath), "# plan\n", "utf8");
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      title: "Resume worktree",
      status: "implementing",
      planPath,
      branch: "agent/issue-45-resume-worktree",
      worktreePath: ".worktrees/patchmill-issue-45-resume-worktree",
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
            ? issueListPayload([issue(45, ["in-progress"], "Resume worktree")])
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
        stdout: `worktree ${join(config.repoRoot, ".worktrees/patchmill-issue-45-resume-worktree")}\n`,
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
        stdout: "agent/issue-45-resume-worktree\n",
        stderr: "",
      };
    }
    if (call.command === "git" && call.args[0] === "log") {
      return { code: 0, stdout: "abc123 partial work\n", stderr: "" };
    }
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
      assert.match(prompt, /Resume context:/);
      assert.match(prompt, /abc123 partial work/);
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/45",
          branch: "agent/issue-45-resume-worktree",
          commits: ["abc123"],
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

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.equal(
    runner.calls.some(
      (call) => call.command === "git" && call.args.includes("-b"),
    ),
    false,
  );
  assert.ok(runner.calls.find((call) => call.command === "pi"));
});

test("runOneIssue resumes clean blocked implementation workspace after external prerequisite is fixed", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config);
  let implementationPrompt = "";
  const runner = blockedRecoveryRunner(config, {
    onPi(prompt) {
      implementationPrompt = prompt;
      return {
        code: 0,
        stdout: JSON.stringify({
          status: "pr-created",
          prUrl: "https://forgejo/pr/45",
          branch: "agent/issue-45-recover-blocked-run",
          commits: ["789abc"],
          validation: ["verification passed"],
          reviewSummary: "reviewed",
        }),
        stderr: "",
      };
    },
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.match(implementationPrompt, /Resume context:/);
  assert.match(implementationPrompt, /def456 add verification/);
  assert.match(implementationPrompt, /Continue from current branch state/);
  assert.match(implementationPrompt, /was reused from the prior run/);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        call.args[0] === "worktree" &&
        call.args[1] === "add",
    ),
    false,
  );
  const finalLabelCall = runner.calls.find(
    (call) =>
      call.command === "tea" &&
      call.args[0] === "issues" &&
      call.args[1] === "edit" &&
      call.args.includes("--add-labels") &&
      call.args.includes("agent-done"),
  );
  assert.ok(finalLabelCall, "expected final done label update");
  assert.equal(
    finalLabelCall.args.includes("--remove-labels"),
    true,
    "expected final label update to remove stale labels",
  );
  assert.match(
    finalLabelCall.args[finalLabelCall.args.indexOf("--remove-labels") + 1] ??
      "",
    /needs-info/,
  );
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(state.status, "finished");
  assert.equal(state.branch, "agent/issue-45-recover-blocked-run");
  assert.equal(
    state.worktreePath,
    ".worktrees/patchmill-issue-45-recover-blocked-run",
  );
  assert.equal(
    state.specPath,
    "docs/specs/2026-06-20-issue-45-recover-blocked-run.md",
  );
  assert.equal(state.specCommit, "spec123");
  assert.equal(state.planCommit, "plan123");
  assert.equal(state.lastError, undefined);
  assert.deepEqual(state.failureCommentKeys, ["blocked:verification"]);
});

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
      if (/Implement (?:repository )?issue/.test(prompt))
        piPromptKinds.push("implementation");
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
  assert.match(
    implementationPrompt,
    /Prior blocker reason: Required verification environment is unavailable\./,
  );
  assert.match(implementationPrompt, /Prior validation: formatting passed/);
  assert.match(
    implementationPrompt,
    /Prior validation: verification environment unavailable/,
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

test("runOneIssue continues blocked resume when saved spec is missing but saved plan exists", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config, undefined, {
    writePlanInPrimaryRepo: false,
    writeSpecInPrimaryRepo: false,
    writePlanInWorktree: true,
    writeSpecInWorktree: false,
  });
  const piPromptKinds: string[] = [];
  const runner = blockedRecoveryRunner(config, {
    onPi(prompt) {
      if (/Create a design spec/.test(prompt)) piPromptKinds.push("spec");
      if (/Create an implementation plan/.test(prompt))
        piPromptKinds.push("plan");
      if (/Implement issue/.test(prompt)) piPromptKinds.push("implementation");
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
  assert.deepEqual(piPromptKinds, []);
  assert.equal(workflowPiCalls(runner.calls).length, 1);
});

test("runOneIssue preserves blocked recovery state when spec review interrupts resume", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  await writeBlockedRecoveryRunState(config);
  await writeFile(
    join(
      config.repoRoot,
      "docs/specs/2026-06-20-issue-45-recover-blocked-run.md",
    ),
    "# spec\n",
    "utf8",
  );
  const runner = blockedRecoveryRunner(config);

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "spec-found", JSON.stringify(result));
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(state.status, "blocked");
  assert.equal(state.branch, "agent/issue-45-recover-blocked-run");
  assert.equal(
    state.worktreePath,
    ".worktrees/patchmill-issue-45-recover-blocked-run",
  );
});

test("runOneIssue recovers blocked state overwritten by spec review stop", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
    approvalPolicy: specAndPlanApprovalPolicy(),
  });
  await writeBlockedRecoveryRunState(config);
  await writeRunState(
    config.runStateDir,
    {
      issueNumber: 45,
      status: "finished",
    },
    NOW.toISOString(),
  );
  const runner = blockedRecoveryRunner(config, {
    selectedLabels: ["spec-review", "spec-approved", "plan-approved"],
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    true,
  );
});

test("runOneIssue treats configured ignored dirty paths as clean blocked recovery", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config);
  const runner = blockedRecoveryRunner(config, {
    dirtyStatus: "?? .patchmill/runs/issue-45.json\n",
  });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    true,
  );
});

test("runOneIssue reports dirty blocked recovery before mutations", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config);
  const runner = blockedRecoveryRunner(config, {
    dirtyStatus: " M src/index.ts\n",
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Commit, stash, or clean local modifications/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
  assert.equal(
    runner.calls.some(
      (call) => call.command === "tea" && call.args[0] !== "issues",
    ),
    false,
  );
  const state = JSON.parse(
    await readFile(runStatePath(config.runStateDir, 45), "utf8"),
  );
  assert.equal(state.status, "blocked");
  assert.equal(state.branch, "agent/issue-45-recover-blocked-run");
});

test("runOneIssue reports already merged blocked recovery before mutations", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config);
  const runner = blockedRecoveryRunner(config, { merged: true, log: "" });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Confirm the work is landed/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
});

test("runOneIssue resumes clean behind blocked recovery", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config);
  const runner = blockedRecoveryRunner(config, { revList: "3\t2\n" });

  const result = await runOneIssue(runner, config, { now: NOW });

  assert.equal(result.status, "pr-created", JSON.stringify(result));
  assert.equal(
    runner.calls.some((call) => call.command === "pi"),
    true,
  );
});

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
  assert.equal(workflowPiCalls(runner.calls).length, 0);
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

test("runOneIssue rejects mismatched blocked resume artifact comments before materializing", async () => {
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
  const runner = blockedRecoveryRunner(config, {
    selectedComments: [
      {
        authorLogin: "patchmill-bot",
        body: formatPublishedArtifactComment({
          kind: "plan",
          path: "docs/plans/unrelated-plan.md",
          content: "# Unrelated plan\n",
        }),
      },
    ],
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Explicit plan artifact docs\/plans\/unrelated-plan\.md does not match saved plan docs\/plans\/2026-06-20-issue-45-recover-blocked-run\.md/,
  );
  assert.equal(workflowPiCalls(runner.calls).length, 0);
  assert.equal(
    runner.calls.some(
      (call) =>
        call.command === "git" &&
        (call.args[0] === "add" || call.args[0] === "commit"),
    ),
    false,
  );
});

test("runOneIssue reports missing worktree with existing branch blocked recovery before mutations", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config, undefined, {
    createWorktreePath: false,
  });
  const runner = blockedRecoveryRunner(config, { worktreeRegistered: false });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /git worktree add \.worktrees\/patchmill-issue-45-recover-blocked-run agent\/issue-45-recover-blocked-run/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
});

test("runOneIssue reports missing branch and worktree blocked recovery before mutations", async () => {
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    issueNumber: 45,
  });
  await writeBlockedRecoveryRunState(config, undefined, {
    createWorktreePath: false,
  });
  const runner = blockedRecoveryRunner(config, {
    branchExists: false,
    worktreeRegistered: false,
  });

  await assert.rejects(
    () => runOneIssue(runner, config, { now: NOW }),
    /Archive or remove stale run state/,
  );
  assert.equal((await workflowPiCalls(runner.calls)).length, 0);
});
