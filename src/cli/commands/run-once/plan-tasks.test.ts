import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPlanTaskLabels } from "./plan-tasks.ts";
import { DEFAULT_PI_TASK_CONTRACT } from "../../../policy/task-contract.ts";

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

test("readPlanTaskLabels preserves default heading compatibility with irregular spacing", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-plan-tasks-"));
  const planPath = join("docs", "plans", "plan.md");
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    join(repoRoot, planPath),
    ["# Example Plan", "", "####   Task   3  :   Validation Sweep"].join("\n"),
    "utf8",
  );

  assert.deepEqual(await readPlanTaskLabels(repoRoot, planPath), [
    { number: 3, label: "validation sweep" },
  ]);
});

test("readPlanTaskLabels accepts a custom task heading contract", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-plan-tasks-"));
  const planPath = join("docs", "plans", "plan.md");
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    join(repoRoot, planPath),
    [
      "# Example Plan",
      "",
      "### Step 2 - Dashboard Wiring",
      "",
      "#### Step 10 - Final Verification",
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(
    await readPlanTaskLabels(repoRoot, planPath, {
      ...DEFAULT_PI_TASK_CONTRACT,
      planTaskHeadingPattern: "### Step <number> - <label>",
    }),
    [
      { number: 2, label: "dashboard wiring" },
      { number: 10, label: "final verification" },
    ],
  );
});

test("readPlanTaskLabels supports reordered custom task heading placeholders", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-plan-tasks-"));
  const planPath = join("docs", "plans", "plan.md");
  await mkdir(join(repoRoot, "docs", "plans"), { recursive: true });
  await writeFile(
    join(repoRoot, planPath),
    [
      "# Example Plan",
      "",
      "### Dashboard Wiring as step 2",
      "",
      "#### Final Verification as step 10",
    ].join("\n"),
    "utf8",
  );

  assert.deepEqual(
    await readPlanTaskLabels(repoRoot, planPath, {
      ...DEFAULT_PI_TASK_CONTRACT,
      planTaskHeadingPattern: "### <label> as step <number>",
    }),
    [
      { number: 2, label: "dashboard wiring" },
      { number: 10, label: "final verification" },
    ],
  );
});
