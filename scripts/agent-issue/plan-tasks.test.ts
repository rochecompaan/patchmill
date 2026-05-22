import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPlanTaskLabels } from "./plan-tasks.ts";

test("readPlanTaskLabels extracts ordered task headings", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-plan-tasks-"));
  const planPath = join("docs", "plans", "plan.md");
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    join(repoRoot, planPath),
    [
      "# Example Plan",
      "",
      "### Task 1: Date Range Model",
      "",
      "### Task 2: Dashboard Wiring",
      "",
      "### Task 10: Final Verification",
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(await readPlanTaskLabels(repoRoot, planPath), [
    { number: 1, label: "date range model" },
    { number: 2, label: "dashboard wiring" },
    { number: 10, label: "final verification" },
  ]);
});

test("readPlanTaskLabels accepts h2 task headings used by issue plans", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-plan-tasks-"));
  const planPath = join("docs", "plans", "plan.md");
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    join(repoRoot, planPath),
    [
      "# Example Plan",
      "",
      "## Task 1: Date Range Model",
      "",
      "## Task 2: Dashboard Wiring",
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(await readPlanTaskLabels(repoRoot, planPath), [
    { number: 1, label: "date range model" },
    { number: 2, label: "dashboard wiring" },
  ]);
});
