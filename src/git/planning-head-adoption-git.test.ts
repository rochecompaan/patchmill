import assert from "node:assert/strict";
import test from "node:test";
import type { CommandRunner } from "../command/types.ts";
import { PlanningHeadAdoptionGit } from "./planning-head-adoption-git.ts";
import { PlanningWorkspaceRepositoryGit } from "./planning-workspace-inspection.ts";
import {
  PlanningWorkspaceConflictError,
  PlanningWorkspaceResponseError,
} from "./planning-workspaces.ts";

const recorded = "a".repeat(40);
const candidate = "b".repeat(40);
const path = "docs/specs/example.md";
const artifact = (commitOid = recorded) => ({
  kind: "spec" as const,
  path,
  commitOid,
  source: "workspace" as const,
});
const workspace = {
  runId: "123e4567-e89b-42d3-a456-426614174000",
  phase: "spec" as const,
  identity: { branch: "planning/spec", worktreePath: ".worktrees/spec" },
  remote: "origin",
  baseBranch: "main",
  baseOid: recorded,
  headOid: recorded,
  cleanup: { state: "removed" as const, pushedHeadOid: recorded },
};
const input = {
  issueNumber: 188,
  runId: workspace.runId,
  phase: "spec" as const,
  workspace,
  hostHeadOid: candidate,
  artifacts: [artifact()],
};
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
function adapter(run: CommandRunner["run"]) {
  return new PlanningHeadAdoptionGit({
    repository: new PlanningWorkspaceRepositoryGit({
      runner: { run },
      repoRoot: "/repo",
      worktreeRoot: "/repo/.worktrees",
    }),
  });
}
function proof(args: string[]) {
  if (args[0] === "ls-remote")
    return ok(`${candidate}\trefs/heads/planning/spec\n`);
  if (args[0] === "fetch" || args[0] === "merge-base") return ok();
  if (args[0] === "rev-parse") return ok(`${candidate}\n`);
  if (args[0] === "ls-tree") return ok(`100644 blob ${candidate}\t${path}\0`);
  if (args[0] === "show") return ok("# Spec\n");
  if (args[0] === "diff") return ok(`M\0${path}\0`);
  throw new Error(`unexpected ${args.join(" ")}`);
}

test("rejects mismatched ownership and cleanup before Git effects", async () => {
  for (const override of [
    { runId: "another" },
    { phase: "plan" as const },
    {
      workspace: {
        ...workspace,
        cleanup: {
          state: "worktree-removed" as const,
          pushedHeadOid: candidate,
        },
      },
    },
  ]) {
    await assert.rejects(
      adapter(async () => assert.fail("no Git effect authorized")).adopt({
        ...input,
        ...override,
      }),
      PlanningWorkspaceConflictError,
    );
  }
});

test("blocks unsafe proofs without local mutation", async () => {
  for (const scenario of [
    "remote-missing",
    "head-disagreement",
    "not-descendant",
    "unexpected-paths",
    "non-regular-artifact",
  ] as const) {
    const calls: string[][] = [];
    const result = await adapter(async (_command, args) => {
      calls.push(args);
      if (scenario === "remote-missing" && args[0] === "ls-remote")
        return { code: 2, stdout: "", stderr: "" };
      if (scenario === "head-disagreement" && args[0] === "ls-remote")
        return ok(`${recorded}\trefs/heads/planning/spec\n`);
      if (scenario === "not-descendant" && args[0] === "merge-base")
        return { code: 1, stdout: "", stderr: "" };
      if (scenario === "unexpected-paths" && args[0] === "diff")
        return ok("M\0README.md\0");
      if (scenario === "non-regular-artifact" && args[0] === "ls-tree")
        return ok(`120000 blob ${candidate}\t${path}\0`);
      return proof(args);
    }).adopt(input);
    assert.equal(result.kind, "blocked");
    if (result.kind === "blocked") {
      assert.equal(result.evidence.failure, scenario);
      assert.deepEqual(
        result.evidence.unexpectedPaths,
        scenario === "unexpected-paths" ? ["README.md"] : [],
      );
    }
    assert.equal(
      calls.some(
        (args) => args.includes("merge") || args.includes("update-ref"),
      ),
      false,
    );
  }
});

test("rejects malformed diff and tree responses", async () => {
  for (const [command, stdout] of [
    ["diff", "\0"],
    ["diff", `${path}\0\0`],
    ["ls-tree", `100644 blob ${candidate}\t${path}`],
  ]) {
    await assert.rejects(
      adapter(async (_command, args) =>
        args[0] === command ? ok(stdout) : proof(args),
      ).adopt(input),
      PlanningWorkspaceResponseError,
    );
  }
});

test("adopts verified evidence and detects a final remote race", async () => {
  for (const race of [false, true]) {
    let remoteChecks = 0;
    const result = await adapter(async (_command, args) => {
      if (args[0] === "ls-remote" && ++remoteChecks === 3 && race)
        return ok(`${"c".repeat(40)}\trefs/heads/planning/spec\n`);
      return proof(args);
    }).adopt(input);
    if (!race)
      assert.deepEqual(result, {
        kind: "adopted",
        headOid: candidate,
        artifacts: [artifact(candidate)],
      });
    else {
      assert.equal(result.kind, "blocked");
      if (result.kind === "blocked")
        assert.equal(result.evidence.failure, "head-moved");
    }
    assert.equal(remoteChecks, 3);
  }
});

test("rejects a local fast-forward that leaves a dirty workspace", async () => {
  let inspections = 0;
  await assert.rejects(
    adapter(async (_command, args) => {
      if (args[0] === "worktree")
        return ok(
          `worktree /repo/.worktrees/spec\0HEAD ${inspections === 0 ? recorded : candidate}\0branch refs/heads/planning/spec\0\0`,
        );
      if (args[0] === "show-ref") return ok();
      if (
        args[0] === "rev-parse" &&
        !args[2]?.includes("planning-head-adoption")
      )
        return ok(`${++inspections === 1 ? recorded : candidate}\n`);
      if (args.includes("status"))
        return ok(inspections > 1 ? " M unsafe\0" : "");
      if (args.includes("merge")) return ok();
      return proof(args);
    }).adopt({
      ...input,
      workspace: { ...workspace, cleanup: { state: "ready" } },
    }),
    /dirty-worktree/u,
  );
});
