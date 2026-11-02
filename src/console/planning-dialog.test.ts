import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPlanningDialog } from "./planning-dialog.ts";

const facts = {
  issue: { number: 6, title: "Persist polls locally" },
  stage: "spec" as const,
  branch: "agent/issue-6--spec",
  commit: "9064d2a",
  specPath: "docs/specs/polls-design.md",
  mockupPath: "docs/mockups/polls.html",
};
const highlights = [
  "One versioned localStorage snapshot",
  "Restores votes and the browser vote lock",
];

test("required spec review presents trustworthy details and highlights, not the agent summary", () => {
  const submittedFacts = { ...facts, summary: "UNTRUSTED SUMMARY" };
  const dialog = renderPlanningDialog(
    submittedFacts,
    { required: true, pullRequest: true },
    highlights,
  );
  assert.equal(
    dialog.title,
    "Approve the spec for issue #6: Persist polls locally?\n\n  Spec     docs/specs/polls-design.md\n  Mockup   docs/mockups/polls.html\n  Branch   agent/issue-6--spec @ 9064d2a\n\n  Key points\n  • One versioned localStorage snapshot\n  • Restores votes and the browser vote lock",
  );
  assert.deepEqual(dialog.options, [
    "Approve and open a planning PR",
    "Approve without a PR (continue now)",
    "Request changes",
  ]);
  assert.doesNotMatch(JSON.stringify(dialog), /UNTRUSTED SUMMARY/);
});

test("later plan review explains why the earlier spec prevents a PR", () => {
  const dialog = renderPlanningDialog(
    {
      ...facts,
      stage: "plan",
      planPath: "docs/plans/polls.md",
      earlierStage: "spec",
    },
    { required: true, pullRequest: false },
    highlights,
  );
  assert.match(dialog.title, /^Approve the plan for issue #6/);
  assert.match(dialog.title, / {2}Plan {5}docs\/plans\/polls.md/);
  assert.match(
    dialog.title.replace(/\s+/g, " "),
    /A planning PR isn't offered: it would also carry the spec, which was approved without a PR\.$/,
  );
  assert.deepEqual(dialog.options, [
    "Approve (continue now)",
    "Request changes",
  ]);
});

for (const row of [
  { specPath: "spec.md", planPath: undefined, subject: "spec" },
  { specPath: undefined, planPath: "plan.md", subject: "plan" },
  { specPath: "spec.md", planPath: "plan.md", subject: "spec and plan" },
])
  test(`ungated review names the ${row.subject}`, () => {
    const dialog = renderPlanningDialog(
      { ...facts, ...row, stage: "implementation", mockupPath: undefined },
      { required: false, pullRequest: false },
      highlights,
    );
    assert.match(
      dialog.title,
      new RegExp(
        `^Have you reviewed the ${row.subject} for issue #6: Persist polls locally\\?`,
      ),
    );
    assert.doesNotMatch(dialog.title, /Mockup/);
    assert.deepEqual(dialog.options, ["Reviewed, continue", "Request changes"]);
  });
