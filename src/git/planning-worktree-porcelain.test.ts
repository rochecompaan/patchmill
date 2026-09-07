import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanningWorktreePorcelain } from "./planning-worktree-porcelain.ts";
const oid = "a".repeat(40);
const attached = (branch = "topic") =>
  `worktree /repo\0HEAD ${oid}\0branch refs/heads/${branch}\0\0`;

test("parses complete attached and detached worktree porcelain", () => {
  const result = parsePlanningWorktreePorcelain(
    `${attached()}worktree /other\0HEAD ${oid}\0detached\0locked held\0prunable reason\0\0`,
  );
  assert.equal(result.malformed, false);
  assert.deepEqual(result.entries, [
    {
      path: "/repo",
      headOid: oid,
      branch: "topic",
      detached: false,
      locked: false,
      prunable: false,
    },
    {
      path: "/other",
      headOid: oid,
      detached: true,
      locked: true,
      prunable: true,
    },
  ]);
});

test("rejects every unsafe branch spelling", () => {
  for (const branch of [
    "",
    "-topic",
    "/topic",
    "topic/",
    "topic.",
    "topic..next",
    "topic@{x",
    "topic\\next",
    "topic~next",
    "topic^next",
    "topic:next",
    "topic?next",
    "topic*next",
    "topic[next",
    "topic next",
    "topic\u00a0next",
    "topic\u0001next",
    "a/" + "x".repeat(1024),
  ]) {
    assert.equal(
      parsePlanningWorktreePorcelain(attached(branch)).malformed,
      true,
      branch,
    );
  }
});

test("strictly parses marker field values and record coherence", () => {
  assert.equal(
    parsePlanningWorktreePorcelain(
      `worktree /repo\0HEAD ${oid}\0detached\0locked held by CI\0prunable retry after cleanup\0\0`,
    ).malformed,
    false,
  );
  const invalid = [
    `worktree /repo\0HEAD ${oid}\0detached value\0\0`,
    `worktree /repo\0HEAD ${oid}\0prunable bad\u0001\0\0`,
    `worktree /repo\0HEAD ${oid}\0branch refs/heads/topic\0detached\0\0`,
    `worktree /repo\0HEAD ${oid}\0unknown value\0\0`,
    `worktree /repo\0HEAD ${oid}\0detached\0detached\0\0`,
    `${attached()}worktree /other\0HEAD ${oid}\0detached extra\0\0`,
  ];
  for (const output of invalid)
    assert.equal(
      parsePlanningWorktreePorcelain(output).malformed,
      true,
      output,
    );
});
