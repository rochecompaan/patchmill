import assert from "node:assert/strict";
import test from "node:test";
import { runRunCommand } from "./main.ts";
test("dispatches reset with remaining arguments", async () => {
  const calls: string[][] = [];
  const code = await runRunCommand(
    ["reset", "--issue", "45", "--plan-only"],
    new Map([
      [
        "reset",
        async (args) => {
          calls.push(args);
          return 0;
        },
      ],
    ]),
  );
  assert.equal(code, 0);
  assert.deepEqual(calls, [["--issue", "45", "--plan-only"]]);
});
test("returns failure for unknown nested command", async () => {
  assert.equal(await runRunCommand(["unknown"], new Map()), 1);
});
