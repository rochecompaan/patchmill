import assert from "node:assert/strict";
import { test } from "node:test";
import { callWhere } from "./stall-text.ts";

test("callWhere names the top-level session of either phase", () => {
  assert.equal(callWhere({ session: "planning session" }), "planning session");
  // A stall-block.json from before the phase names was written this way.
  assert.equal(
    callWhere({ session: "implementation session" }),
    "implementation session",
  );
  assert.equal(
    callWhere({ session: "parent/3f2a/run-0/session.jsonl" }),
    "subagent session parent/3f2a/run-0/session.jsonl",
  );
  assert.equal(
    callWhere({ session: "planning session", run: "3f2a" }),
    "subagent run 3f2a",
  );
});
