import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlanningWorkspaceRemovalStatus } from "./planning-workspace-inspection.ts";
import { PlanningWorkspaceResponseError } from "./planning-workspaces.ts";

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
