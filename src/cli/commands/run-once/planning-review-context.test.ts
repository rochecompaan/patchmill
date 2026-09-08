import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import {
  planningReviewInstruction,
  specSourceInstruction,
  type PlanningReviewContext,
} from "./planning-review-context.ts";
import { buildSpecCreationPrompt } from "./prompts.ts";
import type { IssueSummary } from "./types.ts";

const issue: IssueSummary = {
  number: 188,
  title: "Example",
  labels: [],
  body: "",
  state: "open",
};
const expected: ReadonlyArray<[PlanningReviewContext, RegExp]> = [
  [
    "dedicated-pull-request",
    /Review this artifact in the current planning pull request/u,
  ],
  ["same-phase-pull-request", /do not call the spec already approved/u],
  ["merged-base", /verified merged-base spec/u],
  ["implementation-pull-request", /no planning pull request is created/u],
];
test("renders context-specific planning review and spec-source policy", () => {
  assert.equal(planningReviewInstruction("legacy-label"), undefined);
  assert.match(
    planningReviewInstruction("same-phase-pull-request") ?? "",
    /do not call the spec already approved/u,
  );
  const expectedPlanSources: ReadonlyArray<[PlanningReviewContext, RegExp]> = [
    ["dedicated-pull-request", /approved spec/u],
    ["same-phase-pull-request", /current-phase spec.*not yet approved/u],
    ["merged-base", /verified merged-base spec/u],
    ["implementation-pull-request", /implementation-carried spec/u],
    ["legacy-label", /approved spec/u],
  ];
  for (const [reviewContext, pattern] of expectedPlanSources) {
    assert.match(
      specSourceInstruction(reviewContext, "docs/specs/example.md"),
      pattern,
    );
  }
});
test("renders explicit planning review contexts without changing legacy default", () => {
  const input = {
    issue,
    specPath: "docs/specs/example.md",
    projectPolicy: DEFAULT_PATCHMILL_POLICY,
  };
  for (const [reviewContext, pattern] of expected)
    assert.match(buildSpecCreationPrompt({ ...input, reviewContext }), pattern);
  assert.doesNotMatch(
    buildSpecCreationPrompt(input),
    /current planning pull request/u,
  );
});
