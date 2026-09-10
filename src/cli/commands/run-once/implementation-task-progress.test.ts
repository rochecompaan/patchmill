import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_PI_TASK_CONTRACT } from "../../../policy/task-contract.ts";
import { createImplementationTaskProgress } from "./implementation-task-progress.ts";

test("switches runtime implementation tasks once and closes the active task", async () => {
  const repoRoot = await mkdtemp(
    join(tmpdir(), "patchmill-implementation-progress-"),
  );
  const planPath = join(repoRoot, "plan.md");
  await writeFile(planPath, "# plan\n", "utf8");
  const events: string[] = [];
  const progress = await createImplementationTaskProgress({
    repoRoot,
    worktreeRoot: repoRoot,
    issueNumber: 189,
    planPath,
    taskContract: DEFAULT_PI_TASK_CONTRACT,
    stepStart: async (label) => events.push(`start:${label}`),
    stepComplete: async (label) => events.push(`complete:${label}`),
  });
  await progress.update({ current: 2, total: 3, label: "validate" });
  await progress.update({ current: 2, total: 3, label: "validate" });
  await progress.finish();
  assert.deepEqual(events, [
    "start:implement task 2/3 validate",
    "complete:implement task 2/3 validate",
  ]);
});
