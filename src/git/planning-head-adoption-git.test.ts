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

test("rejects mismatched workspace ownership and cleanup head before Git effects", async () => {
  for (const input of [
    { runId: "another-run" },
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
    const calls: string[][] = [];
    await assert.rejects(
      adapter(async (_command, args) => {
        calls.push(args);
        return { code: 0, stdout: "", stderr: "" };
      }).adopt({
        issueNumber: 188,
        runId: workspace.runId,
        phase: "spec",
        workspace,
        hostHeadOid: candidate,
        artifactPaths: ["docs/specs/example.md"],
        ...input,
      }),
      (error: unknown) =>
        error instanceof PlanningWorkspaceConflictError &&
        (error.reason === "invalid-saved-identity" ||
          error.reason === "head-oid-mismatch"),
    );
    assert.deepEqual(calls, []);
  }
});

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

test("classifies unsafe proof failures without local fast-forward", async () => {
  const failures = [
    ["remote-missing", "remote-missing"],
    ["not-descendant", "not-descendant"],
    ["unexpected-paths", "unexpected-paths"],
    ["non-regular-artifact", "non-regular-artifact"],
  ] as const;
  for (const [scenario, expectedFailure] of failures) {
    const calls: string[][] = [];
    let remoteChecks = 0;
    const result = await adapter(async (_command, args) => {
      calls.push(args);
      if (args[0] === "ls-remote") {
        remoteChecks += 1;
        return scenario === "remote-missing"
          ? { code: 2, stdout: "", stderr: "" }
          : {
              code: 0,
              stdout: `${candidate}\trefs/heads/planning/spec\n`,
              stderr: "",
            };
      }
      if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse")
        return { code: 0, stdout: `${candidate}\n`, stderr: "" };
      if (args[0] === "merge-base")
        return {
          code: scenario === "not-descendant" ? 1 : 0,
          stdout: "",
          stderr: "",
        };
      if (args[0] === "diff")
        return {
          code: 0,
          stdout: scenario === "unexpected-paths" ? "README.md\0" : "",
          stderr: "",
        };
      if (args[0] === "ls-tree")
        return {
          code: 0,
          stdout:
            scenario === "non-regular-artifact"
              ? `120000 blob ${candidate}\tdocs/specs/example.md\0`
              : `100644 blob ${candidate}\tdocs/specs/example.md\0`,
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
    assert.equal(result.kind, "blocked", scenario);
    if (result.kind === "blocked") {
      assert.equal(result.evidence.failure, expectedFailure, scenario);
      assert.deepEqual(
        result.evidence.unexpectedPaths,
        scenario === "unexpected-paths" ? ["README.md"] : [],
        scenario,
      );
    }
    assert.equal(
      calls.some((args) => args.includes("merge")),
      false,
      scenario,
    );
    assert.equal(
      calls.some((args) => args.includes("update-ref")),
      false,
      scenario,
    );
    if (scenario === "remote-missing") assert.equal(remoteChecks, 1);
  }
});

test("rejects malformed planning artifact diff proof output", async () => {
  for (const stdout of ["\0", "docs/specs/example.md\0\0"]) {
    await assert.rejects(
      adapter(async (_command, args) => {
        if (args[0] === "ls-remote")
          return {
            code: 0,
            stdout: `${candidate}\trefs/heads/planning/spec\n`,
            stderr: "",
          };
        if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
        if (args[0] === "rev-parse")
          return { code: 0, stdout: `${candidate}\n`, stderr: "" };
        if (args[0] === "merge-base")
          return { code: 0, stdout: "", stderr: "" };
        if (args[0] === "diff") return { code: 0, stdout, stderr: "" };
        throw new Error(`unexpected ${args.join(" ")}`);
      }).adopt({
        issueNumber: 188,
        runId: workspace.runId,
        phase: "spec",
        workspace,
        hostHeadOid: candidate,
        artifactPaths: ["docs/specs/example.md"],
      }),
      (error: unknown) =>
        error instanceof PlanningWorkspaceResponseError &&
        error.operation === "head-adoption-proof" &&
        error.reason === "malformed-diff",
    );
  }
});

test("rejects malformed planning artifact tree proof output", async () => {
  for (const stdout of [
    `100644 blob ${candidate}\tdocs/specs/example.md`,
    `100644 ${candidate}\tdocs/specs/example.md\0`,
    `100644 blob ${candidate}\tdocs/specs/substituted.md\0`,
  ]) {
    await assert.rejects(
      adapter(async (_command, args) => {
        if (args[0] === "ls-remote")
          return {
            code: 0,
            stdout: `${candidate}\trefs/heads/planning/spec\n`,
            stderr: "",
          };
        if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
        if (args[0] === "rev-parse")
          return { code: 0, stdout: `${candidate}\n`, stderr: "" };
        if (args[0] === "merge-base")
          return { code: 0, stdout: "", stderr: "" };
        if (args[0] === "diff") return { code: 0, stdout: "", stderr: "" };
        if (args[0] === "ls-tree") return { code: 0, stdout, stderr: "" };
        throw new Error(`unexpected ${args.join(" ")}`);
      }).adopt({
        issueNumber: 188,
        runId: workspace.runId,
        phase: "spec",
        workspace,
        hostHeadOid: candidate,
        artifactPaths: ["docs/specs/example.md"],
      }),
      (error: unknown) =>
        error instanceof PlanningWorkspaceResponseError &&
        error.operation === "head-adoption-proof" &&
        error.reason === "malformed-tree",
    );
  }
});

test("returns head-moved after local proof when the final remote observation races", async () => {
  let remoteChecks = 0;
  const result = await adapter(async (_command, args) => {
    if (args[0] === "ls-remote") {
      remoteChecks += 1;
      return {
        code: 0,
        stdout: `${remoteChecks === 3 ? "c".repeat(40) : candidate}\trefs/heads/planning/spec\n`,
        stderr: "",
      };
    }
    if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "rev-parse")
      return { code: 0, stdout: `${candidate}\n`, stderr: "" };
    if (args[0] === "merge-base") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "diff") return { code: 0, stdout: "", stderr: "" };
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
  assert.equal(result.kind, "blocked");
  if (result.kind === "blocked") {
    assert.equal(result.evidence.failure, "head-moved");
    assert.equal(result.evidence.remoteHeadOid, "c".repeat(40));
  }
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

test("rejects a successful local fast-forward that leaves a dirty workspace", async () => {
  let remoteChecks = 0;
  let inspections = 0;
  await assert.rejects(
    adapter(async (_command, args) => {
      if (args[0] === "worktree")
        return {
          code: 0,
          stdout: `worktree /repo/.worktrees/spec\0HEAD ${inspections === 0 ? recorded : candidate}\0branch refs/heads/planning/spec\0\0`,
          stderr: "",
        };
      if (args[0] === "show-ref") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-parse") {
        if (args[2]?.includes("planning-head-adoption"))
          return { code: 0, stdout: `${candidate}\n`, stderr: "" };
        inspections += 1;
        return {
          code: 0,
          stdout: `${inspections === 1 ? recorded : candidate}\n`,
          stderr: "",
        };
      }
      if (args.includes("status"))
        return {
          code: 0,
          stdout: inspections > 1 ? " M unsafe\0" : "",
          stderr: "",
        };
      if (args[0] === "ls-remote") {
        remoteChecks += 1;
        return {
          code: 0,
          stdout: `${candidate}\trefs/heads/planning/spec\n`,
          stderr: "",
        };
      }
      if (args[0] === "fetch" || args.includes("merge"))
        return { code: 0, stdout: "", stderr: "" };
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
      workspace: { ...workspace, cleanup: { state: "ready" } },
      hostHeadOid: candidate,
      artifactPaths: ["docs/specs/example.md"],
    }),
    /dirty-worktree/,
  );
  assert.equal(remoteChecks, 2);
});
