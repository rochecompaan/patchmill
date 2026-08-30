import assert from "node:assert/strict";
import test from "node:test";
import { runLeaseCommand } from "./main.ts";
test("dispatches lease repair arguments", async () => {
  let received: string[] = [];
  const code = await runLeaseCommand(
    ["repair", "--issue", "45"],
    new Map([
      [
        "repair",
        async (args) => {
          received = args;
          return 0;
        },
      ],
    ]),
  );
  assert.equal(code, 0);
  assert.deepEqual(received, ["--issue", "45"]);
});
