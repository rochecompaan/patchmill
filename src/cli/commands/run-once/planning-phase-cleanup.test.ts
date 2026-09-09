import assert from "node:assert/strict";
import test from "node:test";
import type { PullRequestOpenPlanningPhase } from "../../../workflow/planning-state-types.ts";
import { finishPlanningPhaseCleanup } from "./planning-phase-cleanup.ts";

const oid = "a".repeat(40);
const repository = {
  provider: "github-gh" as const,
  host: "github.com",
  owner: "acme",
  repository: "patchmill",
};

function readyPhase(): PullRequestOpenPlanningPhase {
  return {
    kind: "spec",
    status: "pull-request-open",
    base: {
      remote: "origin",
      baseBranch: "main",
      baseOid: oid,
      artifactCandidates: { spec: [], plan: [] },
    },
    workspace: {
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phase: "spec",
      identity: { branch: "planning/spec", worktreePath: "/workspace" },
      remote: "origin",
      baseBranch: "main",
      baseOid: oid,
      headOid: oid,
      cleanup: { state: "ready" },
    },
    artifacts: [
      {
        kind: "spec",
        path: "docs/specs/issue-188.md",
        source: "workspace",
        commitOid: oid,
      },
    ],
    publication: {
      targetRepository: repository,
      headRepository: repository,
      baseBranch: "main",
      headBranch: "planning/spec",
      headOid: oid,
    },
    pullRequest: {
      reference: { targetRepository: repository, number: 188 },
      url: "https://github.com/acme/patchmill/pull/188",
    },
  };
}

test("retries an uncheckpointed worktree removal from ready and durably removes the branch", async () => {
  const events: string[] = [];
  const commands: string[][] = [];
  let worktreePresent = true;
  let branchPresent = true;
  let durable = readyPhase();
  let failCheckpoint = true;
  const run = async () =>
    finishPlanningPhaseCleanup({
      phase: durable,
      remoteHead: async () => events.push("remote-head"),
      workspaces: {
        async removeWorktree() {
          events.push(
            `remove-worktree:${worktreePresent ? "present" : "absent"}`,
          );
          if (worktreePresent)
            commands.push(["worktree", "remove", "--", "/workspace"]);
          worktreePresent = false;
          return {
            state: "branch-only",
            identity: durable.workspace.identity,
            headOid: oid,
          };
        },
        async removeBranch() {
          events.push(`remove-branch:${branchPresent ? "present" : "absent"}`);
          if (branchPresent)
            commands.push([
              "update-ref",
              "-d",
              "refs/heads/planning/spec",
              oid,
            ]);
          branchPresent = false;
          return { state: "missing", identity: durable.workspace.identity };
        },
      } as never,
      checkpoint: async (next) => {
        events.push(`checkpoint:${next.workspace.cleanup.state}`);
        if (failCheckpoint) {
          failCheckpoint = false;
          throw new Error("checkpoint failed");
        }
        durable = next;
      },
    });

  await assert.rejects(run, /checkpoint failed/);
  assert.equal(durable.workspace.cleanup.state, "ready");
  assert.equal(branchPresent, true);
  await run();
  assert.equal(durable.workspace.cleanup.state, "removed");
  assert.deepEqual(events, [
    "remote-head",
    "remove-worktree:present",
    "checkpoint:worktree-removed",
    "remote-head",
    "remove-worktree:absent",
    "checkpoint:worktree-removed",
    "remove-branch:present",
    "checkpoint:removed",
  ]);
  assert.deepEqual(commands, [
    ["worktree", "remove", "--", "/workspace"],
    ["update-ref", "-d", "refs/heads/planning/spec", oid],
  ]);
  assert.ok(commands.every((command) => !command.includes("--force")));
});

test("retries an uncheckpointed branch removal from worktree-removed without force", async () => {
  const events: string[] = [];
  const commands: string[][] = [];
  let branchPresent = true;
  let durable: PullRequestOpenPlanningPhase = {
    ...readyPhase(),
    workspace: {
      ...readyPhase().workspace,
      cleanup: { state: "worktree-removed", pushedHeadOid: oid },
    },
  };
  let failCheckpoint = true;
  const run = async () =>
    finishPlanningPhaseCleanup({
      phase: durable,
      remoteHead: async () => events.push("unexpected-remote-head"),
      workspaces: {
        async removeWorktree() {
          events.push("unexpected-worktree");
          throw new Error("unexpected worktree removal");
        },
        async removeBranch() {
          events.push(`remove-branch:${branchPresent ? "present" : "absent"}`);
          if (branchPresent)
            commands.push([
              "update-ref",
              "-d",
              "refs/heads/planning/spec",
              oid,
            ]);
          branchPresent = false;
          return { state: "missing", identity: durable.workspace.identity };
        },
      } as never,
      checkpoint: async (next) => {
        events.push(`checkpoint:${next.workspace.cleanup.state}`);
        if (failCheckpoint) {
          failCheckpoint = false;
          throw new Error("checkpoint failed");
        }
        durable = next;
      },
    });

  await assert.rejects(run, /checkpoint failed/);
  assert.equal(durable.workspace.cleanup.state, "worktree-removed");
  await run();
  assert.equal(durable.workspace.cleanup.state, "removed");
  assert.deepEqual(events, [
    "remove-branch:present",
    "checkpoint:removed",
    "remove-branch:absent",
    "checkpoint:removed",
  ]);
  assert.deepEqual(commands, [
    ["update-ref", "-d", "refs/heads/planning/spec", oid],
  ]);
  assert.ok(commands.every((command) => !command.includes("--force")));
});

test("preserves ready cleanup state when an existing workspace is dirty or has a changed head", async () => {
  for (const reason of ["dirty-worktree", "head-oid-mismatch"] as const) {
    const durable = readyPhase();
    const events: string[] = [];
    await assert.rejects(
      () =>
        finishPlanningPhaseCleanup({
          phase: durable,
          remoteHead: async () => events.push("remote-head"),
          workspaces: {
            async removeWorktree() {
              events.push(`conflict:${reason}`);
              throw new Error(reason);
            },
          } as never,
          checkpoint: async () => events.push("checkpoint"),
        }),
      new RegExp(reason),
    );
    assert.equal(durable.workspace.cleanup.state, "ready");
    assert.deepEqual(events, ["remote-head", `conflict:${reason}`]);
  }
});
