import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunRecoveryMutationError } from "../../run-once/recovery-mutation.ts";
import { ResetIssueRunRecoveryError } from "./reset.ts";
import { runLogPath } from "../../run-once/progress.ts";
import { runResetCommand } from "./main.ts";

function output(isTTY = false) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdout: {
        isTTY,
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

test("successful reset reports action, archive, and quarantines on stderr without changing redirected stdout", async () => {
  const captured = output();
  const runStateDir = await mkdtemp(join(tmpdir(), "patchmill-reset-main-"));
  const code = await runResetCommand(["--issue", "45"], {
    loadConfig: async () => ({ ...config(runStateDir), quiet: false }) as never,
    executeReset: async () =>
      ({
        status: "reset-started",
        issueNumber: 45,
        archivePath: "archive-path",
        recoveryAction: "archive-reset-and-start",
        quarantinePaths: ["quarantine-one", "quarantine-two"],
        pipelineResult: { status: "no-issue" },
      }) as never,
    ...captured.streams,
    now: () => NOW,
  });
  assert.equal(code, 0);
  assert.match(
    captured.read().stderr,
    /Recovery action: archive-reset-and-start/,
  );
  assert.match(captured.read().stderr, /Archive: archive-path/);
  assert.match(captured.read().stderr, /Quarantine: quarantine-one/);
  assert.match(captured.read().stderr, /Quarantine: quarantine-two/);
  assert.match(captured.read().stdout, /^\{"status":"no-issue"/);
  assert.doesNotMatch(captured.read().stdout, /archive-path|quarantine-one/);
  const log = await import("node:fs/promises").then(({ readFile }) =>
    readFile(runLogPath(runStateDir, NOW.toISOString()), "utf8"),
  );
  assert.match(log, /"archivePath":"archive-path"/);
  assert.match(log, /"quarantinePaths":\["quarantine-one","quarantine-two"\]/);
});

test("successful reset writes recovery diagnostics for TTY output", async () => {
  const captured = output(true);
  const runStateDir = await mkdtemp(join(tmpdir(), "patchmill-reset-main-"));
  const code = await runResetCommand(["--issue", "45"], {
    loadConfig: async () => ({ ...config(runStateDir), quiet: false }) as never,
    executeReset: async () =>
      ({
        status: "reset-started",
        issueNumber: 45,
        archivePath: "tty-archive",
        recoveryAction: "archive-reset-and-start",
        quarantinePaths: ["tty-quarantine"],
        pipelineResult: { status: "no-issue" },
      }) as never,
    ...captured.streams,
    now: () => NOW,
  });
  assert.equal(code, 0);
  assert.match(
    captured.read().stderr,
    /Recovery action: archive-reset-and-start/,
  );
  assert.match(captured.read().stderr, /Archive: tty-archive/);
  assert.match(captured.read().stderr, /Quarantine: tty-quarantine/);
  assert.doesNotMatch(captured.read().stdout, /^\{"status"/);
});

test("nothing-to-reset writes direct stderr guidance and no stdout", async () => {
  const captured = output();
  const runStateDir = await mkdtemp(join(tmpdir(), "patchmill-reset-main-"));
  const code = await runResetCommand(["--issue", "45"], {
    loadConfig: async () => config(runStateDir) as never,
    executeReset: async () =>
      ({
        status: "nothing-to-reset",
        issueNumber: 45,
        guidance: "No saved Run recovery state exists for issue #45.",
      }) as never,
    ...captured.streams,
    now: () => NOW,
  });
  assert.equal(code, 1);
  assert.equal(captured.read().stdout, "");
  assert.match(captured.read().stderr, /No saved Run recovery state exists/);
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
