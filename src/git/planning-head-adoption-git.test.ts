import assert from "node:assert/strict";
import test from "node:test";
import type { CommandRunner } from "../command/types.ts";
import { PlanningHeadAdoptionGit } from "./planning-head-adoption-git.ts";
import { PlanningWorkspaceRepositoryGit } from "./planning-workspace-inspection.ts";

const recorded = "a".repeat(40);
const candidate = "b".repeat(40);
const identity = { branch: "planning/spec", worktreePath: ".worktrees/spec" };
const workspace = {
  runId: "123e4567-e89b-42d3-a456-426614174000",
  phase: "spec" as const,
  identity,
  remote: "origin",
  baseBranch: "main",
  baseOid: recorded,
  headOid: recorded,
  cleanup: { state: "removed" as const, pushedHeadOid: recorded },
};

function adapter(run: CommandRunner["run"]) {
  const repository = new PlanningWorkspaceRepositoryGit({
    runner: { run },
    repoRoot: "/repo",
    worktreeRoot: "/repo/.worktrees",
  });
  return new PlanningHeadAdoptionGit({ repository });
}

test("blocks a host and remote disagreement without local mutation", async () => {
  const calls: string[][] = [];
  const result = await adapter(async (_command, args) => {
    calls.push(args);
    if (args[0] === "ls-remote")
      return {
        code: 0,
        stdout: `${candidate}\trefs/heads/planning/spec\n`,
        stderr: "",
      };
    throw new Error(`unexpected ${args.join(" ")}`);
  }).adopt({
    issueNumber: 188,
    runId: workspace.runId,
    phase: "spec",
    workspace,
    hostHeadOid: "c".repeat(40),
    artifactPaths: ["docs/specs/example.md"],
  });
  assert.deepEqual(result, {
    kind: "blocked",
    evidence: {
      failure: "head-disagreement",
      recordedHeadOid: recorded,
      hostHeadOid: "c".repeat(40),
      remoteHeadOid: candidate,
      artifactPaths: ["docs/specs/example.md"],
      unexpectedPaths: [],
      cleanupState: "removed",
    },
  });
  assert.equal(
    calls.some((args) => args.includes("fetch")),
    false,
  );
  assert.equal(
    calls.some((args) => args.includes("merge")),
    false,
  );
});

test("adopts an artifact-only fast-forward candidate after bounded proof", async () => {
  let remoteChecks = 0;
  const result = await adapter(async (_command, args) => {
    if (args[0] === "ls-remote") {
      remoteChecks += 1;
      return {
        code: 0,
        stdout: `${candidate}\trefs/heads/planning/spec\n`,
        stderr: "",
      };
    }
    if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-parse")
      return { code: 0, stdout: `${candidate}\n`, stderr: "" };
    if (args[0] === "merge-base") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "diff")
      return { code: 0, stdout: "docs/specs/example.md\0", stderr: "" };
    if (args[0] === "ls-tree")
      return {
        code: 0,
        stdout: `100644 blob ${candidate}\tdocs/specs/example.md\0`,
        stderr: "",
      };
    throw new Error(`unexpected ${args.join(" ")}`);
  }).adopt({
    issueNumber: 188,
    runId: workspace.runId,
    phase: "spec",
    workspace,
    hostHeadOid: candidate,
    artifactPaths: ["docs/specs/example.md"],
  });
  assert.deepEqual(result, { kind: "adopted", headOid: candidate });
  assert.equal(remoteChecks, 3);
});
