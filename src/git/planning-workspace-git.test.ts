import assert from "node:assert/strict";
import test from "node:test";
import type { CommandRunner } from "../process/command.ts";
import { PlanningWorkspaceGit } from "./planning-workspace-git.ts";
const oid = "a".repeat(40);
const identity = { branch: "topic", worktreePath: ".worktrees/topic" };
const base = {
  remote: "origin",
  baseBranch: "main",
  baseOid: oid,
  artifactCandidates: { spec: [], plan: [] },
};
test("prepares at exact pinned OID and resumes saved ownership without mutation", async () => {
  let added = false;
  const calls: string[][] = [];
  const runner: CommandRunner = {
    run: async (_command, args) => {
      calls.push(args);
      if (args[0] === "worktree" && args[1] === "list")
        return {
          code: 0,
          stdout: added
            ? `worktree /repo/.worktrees/topic\0HEAD ${oid}\0branch refs/heads/topic\0\0`
            : "",
          stderr: "",
        };
      if (args[0] === "show-ref")
        return { code: added ? 0 : 1, stdout: "", stderr: "" };
      if (args[0] === "worktree" && args[1] === "add") {
        added = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (args.includes("status")) return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    },
  };
  const git = new PlanningWorkspaceGit({
    runner,
    repoRoot: "/repo",
    worktreeRoot: "/repo/.worktrees",
  });
  const prepared = await git.prepare({
    runId: "123e4567-e89b-42d3-a456-426614174000",
    phase: "spec",
    identity,
    base,
  });
  assert.equal(prepared.workspace.headOid, oid);
  const before = calls.length;
  assert.deepEqual(
    await git.resume({
      runId: prepared.workspace.runId,
      phase: "spec",
      identity,
      base,
      saved: prepared.workspace,
    }),
    prepared.snapshot,
  );
  assert.ok(
    calls
      .slice(before)
      .every(
        (args) =>
          args[0] !== "fetch" && !(args[0] === "worktree" && args[1] === "add"),
      ),
  );
});
test("cleanup rejects dirty owned worktrees before destructive command", async () => {
  const runner: CommandRunner = {
    run: async (_command, args) => {
      if (args[0] === "worktree" && args[1] === "list")
        return {
          code: 0,
          stdout: `worktree /repo/.worktrees/topic\0HEAD ${oid}\0branch refs/heads/topic\0\0`,
          stderr: "",
        };
      if (args[0] === "show-ref") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse")
        return { code: 0, stdout: `${oid}\n`, stderr: "" };
      if (args.includes("status"))
        return { code: 0, stdout: " M changed\0", stderr: "" };
      throw new Error(`unexpected command ${args.join(" ")}`);
    },
  };
  const git = new PlanningWorkspaceGit({
    runner,
    repoRoot: "/repo",
    worktreeRoot: "/repo/.worktrees",
  });
  await assert.rejects(
    git.removeWorktree({
      runId: "123e4567-e89b-42d3-a456-426614174000",
      phase: "spec",
      workspace: {
        runId: "123e4567-e89b-42d3-a456-426614174000",
        phase: "spec",
        identity,
        remote: "origin",
        baseBranch: "main",
        baseOid: oid,
        headOid: oid,
        cleanup: { state: "ready" },
      },
    }),
    /dirty-worktree/,
  );
});
