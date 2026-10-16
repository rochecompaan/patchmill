import assert from "node:assert/strict";
import { test } from "node:test";
import type { Facts } from "./facts.ts";
import { derivePhase, type Derived } from "./phase.ts";

const base: Facts = {
  branch: "agent/issue-9-x",
  remoteBranchExists: false,
  worktree: "/fixture/worktree",
  baseBranch: "main",
  expectedSpecPath: "docs/specs/2026-10-15-issue-9-x-design.md",
  expectedPlanPath: "docs/plans/2026-10-15-issue-9-x.md",
  specApproved: false,
};
const spec = { specPath: base.expectedSpecPath };
const plan = { planPath: base.expectedPlanPath };
const rows: {
  name: string;
  facts: Partial<Facts>;
  gate: boolean;
  want: Derived;
}[] = [
  {
    name: "merged PR wins even without spec, approval, or plan",
    facts: {
      pullRequest: {
        number: 2,
        url: "https://example.invalid/2",
        state: "merged",
        draft: false,
        body: "",
        headBranch: base.branch,
      },
    },
    gate: true,
    want: { kind: "stop", label: "done" },
  },
  {
    name: "missing spec precedes approval stop",
    facts: {},
    gate: true,
    want: { kind: "phase", phase: "planning" },
  },
  {
    name: "spec without approval stops before missing plan",
    facts: spec,
    gate: true,
    want: { kind: "stop", label: "specReview" },
  },
  {
    name: "approved spec without plan needs planning",
    facts: { ...spec, specApproved: true },
    gate: true,
    want: { kind: "phase", phase: "planning" },
  },
  {
    name: "approved spec and plan allow implementation",
    facts: { ...spec, ...plan, specApproved: true },
    gate: true,
    want: { kind: "phase", phase: "implementation" },
  },
  {
    name: "gate off overrides false approval with spec and plan",
    facts: { ...spec, ...plan },
    gate: false,
    want: { kind: "phase", phase: "implementation" },
  },
  {
    name: "gate off does not bypass missing plan",
    facts: spec,
    gate: false,
    want: { kind: "phase", phase: "planning" },
  },
];
for (const row of rows) {
  test(row.name, () =>
    assert.deepEqual(
      derivePhase({ ...base, ...row.facts }, row.gate),
      row.want,
    ),
  );
}
