import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecoveryMutationError } from "../../run-once/recovery-mutation.ts";
import { ResetIssueRunRecoveryError } from "./reset.ts";
import { runResetCommand } from "./main.ts";

function output() {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
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
    },
    read: () => ({ stdout, stderr }),
  };
}

const NOW = new Date("2026-08-30T00:00:00.000Z");

function config(runStateDir: string) {
  return {
    issueNumber: 45,
    dryRun: false,
    quiet: true,
    verbosePiOutput: true,
    runStateDir,
  };
}

test("reset reports pre-execution argument errors through the redirected result contract", async () => {
  const captured = output();
  const code = await runResetCommand([], {
    loadConfig: async () => ({ issueNumber: undefined }) as never,
    ...captured.streams,
  });
  assert.equal(code, 1);
  assert.match(captured.read().stdout, /"status":"error"/);
  assert.match(captured.read().stdout, /requires --issue/);
  assert.equal(captured.read().stderr, "");
});

test("reset reports archived mutation failure through the redirected result contract", async () => {
  const captured = output();
  const runStateDir = await mkdtemp(join(tmpdir(), "patchmill-reset-main-"));
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
    loadConfig: async () => config(runStateDir) as never,
    executeReset: async () => {
      throw error;
    },
    ...captured.streams,
    now: () => NOW,
  });
  assert.equal(code, 1);
  assert.match(captured.read().stdout, /"status":"error"/);
  assert.match(captured.read().stdout, /Archive: archive-path/);
  assert.match(captured.read().stdout, /Preserved paths: quarantine/);
});

test("reset forwards normal run-once output options and persists a redirected result", async () => {
  const captured = output();
  const runStateDir = await mkdtemp(join(tmpdir(), "patchmill-reset-main-"));
  let received: Record<string, unknown> | undefined;
  const code = await runResetCommand(["--issue", "45"], {
    loadConfig: async () => config(runStateDir) as never,
    executeReset: async (_runner, _config, options) => {
      received = options as Record<string, unknown>;
      return {
        status: "reset-started",
        issueNumber: 45,
        archivePath: "archive-path",
        recoveryAction: "archive-reset-and-start",
        quarantinePaths: [],
        pipelineResult: { status: "no-issue" },
      } as never;
    },
    ...captured.streams,
    now: () => NOW,
  });
  assert.equal(code, 0);
  assert.equal(received?.verbosePiOutput, true);
  assert.equal(typeof received?.progress, "object");
  assert.equal(typeof received?.logPath, "string");
  assert.equal(typeof received?.streamPiOutput, "undefined");
  assert.match(captured.read().stdout, /"status":"no-issue"/);
});

test("reset rejects dry-run before execution through the redirected result contract", async () => {
  let executed = false;
  const captured = output();
  const code = await runResetCommand(["--dry-run"], {
    loadConfig: async () => ({ issueNumber: 45, dryRun: true }) as never,
    executeReset: async () => {
      executed = true;
      throw new Error("unexpected");
    },
    ...captured.streams,
  });
  assert.equal(code, 1);
  assert.equal(executed, false);
  assert.match(captured.read().stdout, /no reset preview/);
});
