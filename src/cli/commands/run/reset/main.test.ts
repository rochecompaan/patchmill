import assert from "node:assert/strict";
import test from "node:test";
import { RunRecoveryMutationError } from "../../run-once/recovery-mutation.ts";
import { ResetIssueRunRecoveryError } from "./reset.ts";
import { runResetCommand } from "./main.ts";
test("reset requires an issue number", async () => {
  await assert.rejects(
    runResetCommand([], {
      loadConfig: async () => ({ issueNumber: undefined }) as never,
    }),
    /requires --issue/,
  );
});
test("reports archived mutation failure only to stderr", async () => {
  let stdout = "",
    stderr = "";
  const error = new ResetIssueRunRecoveryError(
    new RunRecoveryMutationError(
      new Error("CAS failed"),
      "archive-reset-and-start",
      [],
      ["quarantine"],
      ["stage"],
    ),
    "archive-path",
  );
  const code = await runResetCommand(["--issue", "45"], {
    loadConfig: async () => ({ issueNumber: 45, dryRun: false }) as never,
    executeReset: async () => {
      throw error;
    },
    stdout: {
      write: (value: string) => {
        stdout += value;
        return true;
      },
    } as never,
    stderr: {
      write: (value: string) => {
        stderr += value;
        return true;
      },
    } as never,
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /Archive: archive-path/);
  assert.match(stderr, /Preserved: quarantine/);
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
