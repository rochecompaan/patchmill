import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPlanningDialog } from "./planning-dialog.ts";

const facts = {
  issue: { number: 6, title: "Persist\n\tpolls  locally" },
  stage: "spec" as const,
  branch: "agent/issue-6--spec",
  commit: "9064d2a",
  specPath: "docs/specs/polls-design.md",
  mockupPath: "docs/mockups/polls.html",
};
const gate = { required: true, pullRequest: true };

test("normalizes and bounds prose without wrapping it into additional rows", () => {
  const dialog = renderPlanningDialog(
    facts,
    gate,
    ["One\n\t snapshot", "D".repeat(100)],
    { columns: 80, rows: 40 },
  );
  assert.match(
    dialog.title,
    /^Approve the spec for issue #6: Persist polls locally\?/,
  );
  assert.match(dialog.title, / {2}• One snapshot\n/);
  assert.match(dialog.title, new RegExp(`  • ${"D".repeat(71)}…$`));
  const long = renderPlanningDialog(
    { ...facts, issue: { number: 6, title: "T".repeat(183) } },
    gate,
    [],
    { columns: 120, rows: 40 },
  );
  assert.match(
    long.title.split("\n")[0]!,
    new RegExp(`${"T".repeat(59)}…\\?$`),
  );
});

test("removes bottom highlights before the mockup when reserving space", () => {
  const dialog = renderPlanningDialog(
    facts,
    gate,
    ["First", "Second", "Third", "Fourth", "Fifth"],
    { columns: 80, rows: 24 },
  );
  assert.match(dialog.title, /• First/);
  assert.doesNotMatch(dialog.title, /• Fifth/);
  assert.match(dialog.title, /Mockup/);
  const compact = renderPlanningDialog(facts, gate, ["First", "Second"], {
    columns: 80,
    rows: 19,
  });
  assert.doesNotMatch(compact.title, /Key points|Mockup/);
  assert.match(compact.title, /Spec {5}docs\/specs\/polls-design.md/);
});

test("keeps absurdly long paths whole in a details notification rather than hiding choices", () => {
  const specPath = `docs/specs/${"long-path/".repeat(250)}design.md`;
  const dialog = renderPlanningDialog({ ...facts, specPath }, gate, [
    "First decision",
    "Second decision",
  ]);
  assert.equal(
    dialog.title,
    "Approve the spec for issue #6: Persist polls locally?",
  );
  assert.ok(dialog.notification?.includes(specPath));
  assert.ok(dialog.notification?.includes("docs/mockups/polls.html"));
  assert.ok(dialog.notification?.includes("• Second decision"));
  assert.equal(dialog.options.length, 3);
});

test("bounds a long branch without losing the short commit", () => {
  const dialog = renderPlanningDialog(
    { ...facts, branch: `agent/${"branch-".repeat(30)}` },
    gate,
    [],
  );
  const branchLine = dialog.title
    .split("\n")
    .find((line) => line.startsWith("  Branch"))!;
  assert.match(branchLine, /… @ 9064d2a$/);
  assert.ok(branchLine.length <= 78);
});
