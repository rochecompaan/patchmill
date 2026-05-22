import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isResumableRunState,
  readRunState,
  runStatePath,
  writeRunState,
} from "./run-state.ts";

test("writeRunState creates issue run-state files", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  const state = await writeRunState(runStateDir, {
    issueNumber: 42,
    title: "Add once runner helpers",
    status: "claimed",
    branch: "agent/issue-42-add-once-runner-helpers",
    worktreePath: ".worktrees/agent-issue-42-add-once-runner-helpers",
    planPath: "docs/plans/2026-05-09-issue-42-add-once-runner-helpers.md",
    planCommit: "abc123",
  }, "2026-05-09T12:00:00.000Z");

  assert.equal(runStatePath(runStateDir, 42), join(runStateDir, "issue-42.json"));
  assert.equal(state.status, "claimed");
  assert.equal(state.createdAt, "2026-05-09T12:00:00.000Z");
  assert.equal(state.updatedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(state.claimedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(state.planCommit, "abc123");

  const saved = JSON.parse(await readFile(runStatePath(runStateDir, 42), "utf8"));
  assert.equal(saved.issueNumber, 42);
  assert.equal(saved.status, "claimed");
});

test("writeRunState preserves issue details, timestamps, and last error across status updates", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-updates-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  await writeRunState(runStateDir, {
    issueNumber: 42,
    title: "Add once runner helpers",
    status: "claimed",
    branch: "agent/issue-42-add-once-runner-helpers",
    worktreePath: ".worktrees/agent-issue-42-add-once-runner-helpers",
  }, "2026-05-09T12:00:00.000Z");

  await writeRunState(runStateDir, {
    issueNumber: 42,
    status: "planning",
    planPath: "docs/plans/2026-05-09-issue-42-add-once-runner-helpers.md",
    planCommit: "abc123",
  }, "2026-05-09T12:05:00.000Z");

  await writeRunState(runStateDir, {
    issueNumber: 42,
    status: "implementing",
  }, "2026-05-09T12:10:00.000Z");

  await writeRunState(runStateDir, {
    issueNumber: 42,
    status: "blocked",
    lastError: "Waiting for API clarification",
  }, "2026-05-09T12:15:00.000Z");

  const finished = await writeRunState(runStateDir, {
    issueNumber: 42,
    status: "finished",
  }, "2026-05-09T12:20:00.000Z");

  assert.equal(finished.issueNumber, 42);
  assert.equal(finished.title, "Add once runner helpers");
  assert.equal(finished.branch, "agent/issue-42-add-once-runner-helpers");
  assert.equal(finished.worktreePath, ".worktrees/agent-issue-42-add-once-runner-helpers");
  assert.equal(finished.planPath, "docs/plans/2026-05-09-issue-42-add-once-runner-helpers.md");
  assert.equal(finished.planCommit, "abc123");
  assert.equal(finished.createdAt, "2026-05-09T12:00:00.000Z");
  assert.equal(finished.claimedAt, "2026-05-09T12:00:00.000Z");
  assert.equal(finished.planningAt, "2026-05-09T12:05:00.000Z");
  assert.equal(finished.implementingAt, "2026-05-09T12:10:00.000Z");
  assert.equal(finished.blockedAt, "2026-05-09T12:15:00.000Z");
  assert.equal(finished.finishedAt, "2026-05-09T12:20:00.000Z");
  assert.equal(finished.updatedAt, "2026-05-09T12:20:00.000Z");
  assert.equal(finished.lastError, "Waiting for API clarification");

  const reread = await readRunState(runStateDir, 42);
  assert.deepEqual(reread, finished);
});

test("writeRunState merges checkpoint updates", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-checkpoints-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  await writeRunState(
    runStateDir,
    {
      issueNumber: 45,
      title: "Resume issue",
      status: "claimed",
      checkpoints: { claimed: true, startedCommentPosted: true },
    },
    "2026-05-14T07:00:00.000Z",
  );
  const state = await writeRunState(
    runStateDir,
    {
      issueNumber: 45,
      status: "planning",
      planPath: "docs/plans/2026-05-14-issue-45-resume.md",
      checkpoints: { planPathResolved: true },
    },
    "2026-05-14T07:05:00.000Z",
  );

  assert.deepEqual(state.checkpoints, {
    claimed: true,
    startedCommentPosted: true,
    planPathResolved: true,
  });
  assert.equal(state.status, "planning");
  assert.equal(state.planPath, "docs/plans/2026-05-14-issue-45-resume.md");
});

test("writeRunState keeps completed checkpoints monotonic", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-monotonic-checkpoints-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  await writeRunState(
    runStateDir,
    {
      issueNumber: 46,
      title: "Resume issue",
      status: "claimed",
      checkpoints: { claimed: true, startedCommentPosted: true },
    },
    "2026-05-14T07:00:00.000Z",
  );
  const state = await writeRunState(
    runStateDir,
    {
      issueNumber: 46,
      status: "planning",
      checkpoints: { startedCommentPosted: false as true },
    },
    "2026-05-14T07:05:00.000Z",
  );

  assert.deepEqual(state.checkpoints, {
    claimed: true,
    startedCommentPosted: true,
  });
});

test("writeRunState merges failure comment keys uniquely", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-failure-comment-keys-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  await writeRunState(
    runStateDir,
    {
      issueNumber: 52,
      title: "Unexpected failure dedupe",
      status: "planning",
      failureCommentKeys: ["unexpected-failure:planning"],
    },
    "2026-05-14T07:00:00.000Z",
  );

  const state = await writeRunState(
    runStateDir,
    {
      issueNumber: 52,
      status: "planning",
      failureCommentKeys: ["unexpected-failure:planning", "unexpected-failure:implementing"],
    },
    "2026-05-14T07:05:00.000Z",
  );

  assert.deepEqual(state.failureCommentKeys, [
    "unexpected-failure:planning",
    "unexpected-failure:implementing",
  ]);
});

test("writeRunState can reset stale checkpoints while clearing stale worktree and implementation fields", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-reset-checkpoints-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  await writeRunState(
    runStateDir,
    {
      issueNumber: 46,
      title: "Finished issue",
      status: "finished",
      planPath: "docs/plans/2026-05-14-issue-46-finished.md",
      branch: "agent/issue-46-finished",
      worktreePath: ".worktrees/agent-issue-46-finished",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/46",
      checkpoints: {
        claimed: true,
        startedCommentPosted: true,
        readyLabelRestored: true,
        planReadyCommentPosted: true,
        planCreated: true,
      },
    },
    "2026-05-14T07:00:00.000Z",
  );
  const state = await writeRunState(
    runStateDir,
    {
      issueNumber: 46,
      status: "claimed",
      checkpoints: { claimed: true },
      resetCheckpoints: true,
    },
    "2026-05-14T07:05:00.000Z",
  );

  assert.equal(state.planPath, "docs/plans/2026-05-14-issue-46-finished.md");
  assert.equal(state.branch, undefined);
  assert.equal(state.worktreePath, undefined);
  assert.equal(state.implementationStatus, undefined);
  assert.equal(state.prUrl, undefined);
  assert.deepEqual(state.checkpoints, {
    claimed: true,
  });
});

test("writeRunState clears stale handoff comment state when resetting checkpoints", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-reset-handoff-comment-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  await writeRunState(
    runStateDir,
    {
      issueNumber: 47,
      title: "Resume issue",
      status: "implementing",
      handoffCommentPosted: true,
      checkpoints: { handoffCommentPosted: true },
    },
    "2026-05-14T07:00:00.000Z",
  );

  const resetState = await writeRunState(
    runStateDir,
    {
      issueNumber: 47,
      status: "claimed",
      checkpoints: { claimed: true },
      resetCheckpoints: true,
    },
    "2026-05-14T07:05:00.000Z",
  );

  assert.equal(resetState.handoffCommentPosted, undefined);
  assert.deepEqual(resetState.checkpoints, {
    claimed: true,
  });
});

test("writeRunState synchronizes handoff comment checkpoint and top-level flag", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-handoff-comment-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  const topLevelState = await writeRunState(
    runStateDir,
    {
      issueNumber: 47,
      title: "Resume issue",
      status: "implementing",
      handoffCommentPosted: true,
    },
    "2026-05-14T07:00:00.000Z",
  );

  assert.equal(topLevelState.handoffCommentPosted, true);
  assert.equal(topLevelState.checkpoints?.handoffCommentPosted, true);

  const checkpointState = await writeRunState(
    runStateDir,
    {
      issueNumber: 48,
      title: "Resume issue",
      status: "implementing",
      checkpoints: { handoffCommentPosted: true },
    },
    "2026-05-14T07:05:00.000Z",
  );

  assert.equal(checkpointState.handoffCommentPosted, true);
  assert.equal(checkpointState.checkpoints?.handoffCommentPosted, true);
});

test("writeRunState persists implementation result fields needed for resume", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-implementation-result-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  const state = await writeRunState(
    runStateDir,
    {
      issueNumber: 49,
      title: "Resume implementation",
      status: "implementing",
      branch: "agent/issue-49-resume-implementation",
      implementationStatus: "merged",
      mergeCommit: "abc999",
      commits: ["abc123"],
      validation: ["just agent-issue-test ok"],
      reviewSummary: "reviewed",
      landingDecision: "direct squash-landed: localized change",
      checkpoints: { implementationCompleted: true },
    },
    "2026-05-14T07:10:00.000Z",
  );

  assert.equal(state.implementationStatus, "merged");
  assert.equal(state.mergeCommit, "abc999");
  assert.deepEqual(state.commits, ["abc123"]);
  assert.deepEqual(state.validation, ["just agent-issue-test ok"]);
  assert.equal(state.reviewSummary, "reviewed");
  assert.equal(state.landingDecision, "direct squash-landed: localized change");
  assert.equal(state.checkpoints?.implementationCompleted, true);
});

test("writeRunState treats implementation result state atomically across status transitions", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-implementation-atomic-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  const prState = await writeRunState(
    runStateDir,
    {
      issueNumber: 50,
      title: "Atomic implementation state",
      status: "implementing",
      branch: "agent/issue-50-atomic-implementation-state",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/50",
      mergeCommit: "stale-merge",
      commits: ["abc123"],
      validation: ["just agent-issue-test ok"],
      checkpoints: { implementationCompleted: true },
    },
    "2026-05-14T07:15:00.000Z",
  );

  assert.equal(prState.prUrl, "https://forgejo/pr/50");
  assert.equal(prState.mergeCommit, undefined);

  const mergedState = await writeRunState(
    runStateDir,
    {
      issueNumber: 50,
      status: "implementing",
      implementationStatus: "merged",
      mergeCommit: "def456",
    },
    "2026-05-14T07:20:00.000Z",
  );

  assert.equal(mergedState.implementationStatus, "merged");
  assert.equal(mergedState.mergeCommit, "def456");
  assert.equal(mergedState.prUrl, undefined);
});

test("writeRunState clears stale optional implementation fields when replacing implementation results", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-run-state-implementation-replacement-"));
  const runStateDir = join(repoRoot, ".pi", "agent-issue", "runs");

  await writeRunState(
    runStateDir,
    {
      issueNumber: 51,
      title: "Implementation replacement",
      status: "implementing",
      branch: "agent/issue-51-implementation-replacement",
      implementationStatus: "pr-created",
      prUrl: "https://forgejo/pr/51",
      commits: ["abc123"],
      validation: ["stale validation"],
      reviewSummary: "stale review",
      landingDecision: "stale landing",
      checkpoints: { implementationCompleted: true },
    },
    "2026-05-14T07:25:00.000Z",
  );

  const mergedState = await writeRunState(
    runStateDir,
    {
      issueNumber: 51,
      status: "implementing",
      implementationStatus: "merged",
      mergeCommit: "def456",
      commits: ["def456"],
      validation: ["just agent-issue-test ok"],
    },
    "2026-05-14T07:30:00.000Z",
  );

  assert.equal(mergedState.implementationStatus, "merged");
  assert.equal(mergedState.mergeCommit, "def456");
  assert.equal(mergedState.prUrl, undefined);
  assert.equal(mergedState.reviewSummary, undefined);
  assert.equal(mergedState.landingDecision, undefined);
});

test("isResumableRunState accepts active automation phases only", () => {
  const base = {
    issueNumber: 45,
    title: "Resume issue",
    createdAt: "2026-05-14T07:00:00.000Z",
    updatedAt: "2026-05-14T07:00:00.000Z",
  };

  assert.equal(isResumableRunState({ ...base, status: "claimed" }), true);
  assert.equal(isResumableRunState({ ...base, status: "planning" }), true);
  assert.equal(isResumableRunState({ ...base, status: "implementing" }), true);
  assert.equal(isResumableRunState({ ...base, status: "blocked" }), false);
  assert.equal(isResumableRunState({ ...base, status: "finished" }), false);
});
