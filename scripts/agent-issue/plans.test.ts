import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlanFilename, findIssuePlan } from "./plans.ts";

test("buildPlanFilename creates a stable issue plan filename", () => {
  assert.equal(
    buildPlanFilename(
      42,
      "Add once runner helpers",
      "2026-05-09T12:30:00.000Z",
    ),
    "2026-05-09-issue-42-add-once-runner-helpers.md",
  );
});

test("findIssuePlan discovers an existing plan by issue marker", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-plans-"));
  const plansDir = join(repoRoot, "docs", "plans");
  await mkdir(plansDir, { recursive: true });
  await writeFile(
    join(plansDir, "2026-05-01-issue-42-first-plan.md"),
    "# plan\n",
    "utf8",
  );
  await writeFile(
    join(plansDir, "2026-05-07-issue-7-other-plan.md"),
    "# other\n",
    "utf8",
  );

  const found = await findIssuePlan(plansDir, 42);

  assert.equal(found, join(plansDir, "2026-05-01-issue-42-first-plan.md"));
});

test("findIssuePlan returns undefined when docs/plans is absent", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "agent-issue-plans-missing-"));

  const found = await findIssuePlan(join(repoRoot, "docs", "plans"), 42);

  assert.equal(found, undefined);
});
