import assert from "node:assert/strict";
import test from "node:test";
import { runResetCommand } from "./main.ts";
test("reset requires an issue number", async () => {
  await assert.rejects(
    runResetCommand([], {
      loadConfig: async () => ({ issueNumber: undefined }) as never,
    }),
    /requires --issue/,
  );
});
test("reset rejects dry-run before execution", async () => {
  let executed = false;
  await assert.rejects(
    runResetCommand(["--dry-run"], {
      loadConfig: async () => ({ issueNumber: 45, dryRun: true }) as never,
      executeReset: async () => {
        executed = true;
        throw new Error("unexpected");
      },
    }),
    /no reset preview/,
  );
  assert.equal(executed, false);
});
