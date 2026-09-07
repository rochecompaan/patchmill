import assert from "node:assert/strict";
import test from "node:test";
import { parsePlanningWorktreePorcelain } from "./planning-worktree-porcelain.ts";
const oid = "a".repeat(40);
test("parses complete attached and detached worktree porcelain", () => {
  const result = parsePlanningWorktreePorcelain(
    `worktree /repo\0HEAD ${oid}\0branch refs/heads/topic\0\0worktree /other\0HEAD ${oid}\0detached\0\0`,
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
      locked: false,
      prunable: false,
    },
  ]);
});
test("marks malformed duplicate and unterminated records unsafe", () => {
  assert.equal(
    parsePlanningWorktreePorcelain(
      `worktree /repo\0HEAD ${oid}\0branch refs/heads/topic\0detached\0\0`,
    ).malformed,
    true,
  );
  assert.equal(
    parsePlanningWorktreePorcelain(`worktree /repo\0HEAD ${oid}`).malformed,
    true,
  );
  assert.equal(
    parsePlanningWorktreePorcelain(
      `worktree /repo\0HEAD ${oid}\0branch refs/heads/a\0branch refs/heads/a\0\0`,
    ).malformed,
    true,
  );
});
