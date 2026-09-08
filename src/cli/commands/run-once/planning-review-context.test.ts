import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PATCHMILL_POLICY } from "../../../policy/defaults.ts";
import {
  buildSpecCreationPrompt,
  type PlanningReviewContext,
} from "./prompts.ts";
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
