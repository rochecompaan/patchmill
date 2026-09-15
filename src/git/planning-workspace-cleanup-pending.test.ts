import assert from "node:assert/strict";
import { test } from "node:test";
import { PlanningWorkspaceCleanupGit } from "./planning-workspace-cleanup.ts";
import { parsePlanningWorkspaceRemovalStatus } from "./planning-workspace-inspection.ts";
import {
  PlanningWorkspaceConflictError,
  PlanningWorkspaceResponseError,
} from "./planning-workspaces.ts";

const oid = "a".repeat(40);
const identity = { branch: "planning/spec", worktreePath: "/worktree" };

test("removal status preserves and sorts exact ignored paths", () => {
  assert.deepEqual(
    parsePlanningWorkspaceRemovalStatus(
      "!! .env\0!! build/output\nname.bin\0!! .env\0",
    ),
    {
      ordinaryDirty: false,
      ignoredPaths: [".env", "build/output\nname.bin"],
    },
  );
});

test("removal status preserves ordinary dirty evidence alongside ignored paths", () => {
  assert.deepEqual(
    parsePlanningWorkspaceRemovalStatus(
      " M tracked.txt\0?? ordinary.txt\0!! .env\0",
    ),
    { ordinaryDirty: true, ignoredPaths: [".env"] },
  );
});

test("worktree removal rejects a late ordinary status change without removing", async () => {
  const calls: string[][] = [];
  const cleanup = new PlanningWorkspaceCleanupGit({
    inspect: async () => ({
      state: "ready",
      identity,
      headOid: oid,
      clean: true,
    }),
    path: () => "/worktree",
    removalStatus: async () => ({ ordinaryDirty: true, ignoredPaths: [] }),
    run: async (args: string[]) => {
      calls.push(args);
      return { stdout: "" };
    },
    existing: async () => false,
  } as never);

  await assert.rejects(
    cleanup.removeWorktree({
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
    (error: unknown) => {
      assert.ok(error instanceof PlanningWorkspaceConflictError);
      assert.equal(error.reason, "dirty-worktree");
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

test("removal status rejects malformed NUL records", () => {
  assert.throws(
    () => parsePlanningWorkspaceRemovalStatus("!! .env"),
    PlanningWorkspaceResponseError,
  );
  assert.throws(
    () => parsePlanningWorkspaceRemovalStatus("!! \0"),
    PlanningWorkspaceResponseError,
  );
});
