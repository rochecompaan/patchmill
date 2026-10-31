import assert from "node:assert/strict";
import { test } from "node:test";
import type { Facts } from "./facts.ts";
import { derivePhase, type Derived } from "./phase.ts";

const base: Facts = {
  stage: "implementation",
  branch: "agent/issue-9-x",
  remoteBranchExists: false,
  worktree: "/fixture/worktree",
  baseBranch: "main",
  expectedSpecPath: "docs/specs/2026-10-15-issue-9-x-design.md",
  expectedPlanPath: "docs/plans/2026-10-15-issue-9-x-plan.md",
};
const spec = { specPath: base.expectedSpecPath };
const plan = { planPath: base.expectedPlanPath };
const pr = {
  number: 2,
  url: "https://example.invalid/2",
  state: "merged" as const,
  draft: false,
  body: "",
  headRepository: "fixture/repo",
  headBranch: base.branch,
  baseBranch: "main",
};
const rows: { name: string; facts: Partial<Facts>; want: Derived }[] = [
  {
    name: "only a merged implementation PR marks done",
    facts: { pullRequest: pr },
    want: { kind: "stop", label: "done" },
  },
  {
    name: "missing spec needs planning",
    facts: {},
    want: { kind: "phase", phase: "planning" },
  },
  {
    name: "missing plan needs planning",
    facts: spec,
    want: { kind: "phase", phase: "planning" },
  },
  {
    name: "both artifacts allow ungated implementation",
    facts: { ...spec, ...plan },
    want: { kind: "phase", phase: "implementation" },
  },
];
for (const stage of ["spec", "plan"] as const) {
  rows.push({
    name: `${stage} stage without PR needs planning`,
    facts: { stage, ...spec, ...plan },
    want: { kind: "phase", phase: "planning" },
  });
  for (const state of ["open", "merged", "closed"] as const) {
    rows.push({
      name: `${state} ${stage} PR never marks done`,
      facts: { stage, pullRequest: { ...pr, state } },
      want: {
        kind: "stop",
        label: state === "closed" ? "needsInfo" : "inProgress",
      },
    });
  }
}
for (const row of rows) {
  test(row.name, () =>
    assert.deepEqual(derivePhase({ ...base, ...row.facts }), row.want),
  );
}
