import assert from "node:assert/strict";
import test from "node:test";
import { PlanningPublicationGitError } from "../../../git/planning-publication-git.ts";
import {
  assertPlanningImplementationAncestry,
  PlanningImplementationAncestryError,
} from "./planning-implementation-ancestry.ts";
import { ImplementationOidValidationError } from "./implementation-oid-validation.ts";

type Input = Parameters<typeof assertPlanningImplementationAncestry>[0];
const oid = "a".repeat(40);
function input(): Input {
  return {
    state: { phases: [] } as never,
    baseOid: oid,
    savedHeadOid: oid,
    headOid: oid,
    commits: [oid],
    git: { assertAncestor: async () => {} },
  };
}
test("validates every ancestry operand before Git", async () => {
  const cases: Array<[string, (value: Input) => void, number?]> = [
    [
      "commits",
      (v) => {
        v.commits = [oid, "abc123"];
      },
      1,
    ],
    [
      "commits",
      (v) => {
        v.commits = [];
      },
    ],
    [
      "commits",
      (v) => {
        v.commits = [oid, 123] as never;
      },
      1,
    ],
    ...["baseOid", "savedHeadOid", "headOid"].map(
      (field) =>
        [
          field,
          (v: Input) => {
            Object.assign(v, { [field]: "abc123" });
          },
        ] as [string, (value: Input) => void],
    ),
    [
      "phases[0].artifacts[1].commitOid",
      (v) => {
        v.state = {
          phases: [
            {
              artifacts: [
                { source: "remote-base", commitOid: "ignored" },
                { source: "workspace", commitOid: "short" },
              ],
            },
          ],
        } as never;
      },
    ],
  ];
  for (const [field, change, index] of cases) {
    const value = input();
    change(value);
    let calls = 0;
    value.git.assertAncestor = async () => {
      calls++;
    };
    await assert.rejects(
      assertPlanningImplementationAncestry(value),
      (error: unknown) => {
        assert.ok(error instanceof ImplementationOidValidationError);
        assert.equal(error.context, "planning-ancestry");
        assert.equal(error.field, field);
        assert.equal(error.index, index);
        return true;
      },
    );
    assert.equal(calls, 0);
  }
});
test("keeps ancestry and infrastructure failures distinct", async () => {
  for (const [operation, reason] of [
    ["ancestry", "invalid-input"],
    ["ancestry", "not-ancestor"],
    ["ancestry", "command-failed"],
    ["remote-head", "invalid-input"],
  ] as const) {
    const value = input();
    const failure = new PlanningPublicationGitError(operation, reason);
    value.git.assertAncestor = async () => {
      throw failure;
    };
    await assert.rejects(
      assertPlanningImplementationAncestry(value),
      (error: unknown) => {
        if (reason === "not-ancestor")
          assert.ok(error instanceof PlanningImplementationAncestryError);
        else if (operation === "ancestry" && reason === "invalid-input") {
          assert.ok(error instanceof ImplementationOidValidationError);
          assert.equal(error.field, "ancestry.operands");
          assert.equal(error.cause, failure);
        } else assert.equal(error, failure);
        return true;
      },
    );
  }
});
