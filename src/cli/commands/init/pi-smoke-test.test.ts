import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandRunner } from "../triage/types.ts";
import { runPiSmokeTest } from "./pi-smoke-test.ts";

function runner(result: {
  code: number;
  stdout?: string;
  stderr?: string;
}): CommandRunner & {
  calls: Array<{ command: string; args: string[]; cwd?: string }>;
} {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  return {
    calls,
    async run(command, args, options = {}) {
      calls.push({ command, args, cwd: options.cwd });
      return { stdout: "", stderr: "", ...result };
    },
  };
}

test("runPiSmokeTest succeeds when Pi prints sentinel", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  const result = await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    model: "anthropic/claude-sonnet-4-5",
  });

  assert.deepEqual(result, {
    status: "pass",
    message:
      "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
    command:
      "pi --no-session --no-context-files --no-prompt-templates --model anthropic/claude-sonnet-4-5 -p Reply with PATCHMILL_PI_OK and nothing else.",
  });
  assert.deepEqual(fake.calls, [
    {
      command: "pi",
      cwd: "/repo",
      args: [
        "--no-session",
        "--no-context-files",
        "--no-prompt-templates",
        "--model",
        "anthropic/claude-sonnet-4-5",
        "-p",
        "Reply with PATCHMILL_PI_OK and nothing else.",
      ],
    },
  ]);
});

test("runPiSmokeTest omits model when no model is selected", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  await runPiSmokeTest(fake, { repoRoot: "/repo" });

  assert.deepEqual(fake.calls[0]?.args, [
    "--no-session",
    "--no-context-files",
    "--no-prompt-templates",
    "-p",
    "Reply with PATCHMILL_PI_OK and nothing else.",
  ]);
});

test("runPiSmokeTest fails when Pi exits non-zero", async () => {
  const fake = runner({ code: 1, stderr: "missing key" });

  const result = await runPiSmokeTest(fake, { repoRoot: "/repo" });

  assert.equal(result.status, "fail");
  assert.match(result.message, /Pi could not complete the provider smoke test/);
  assert.match(result.details ?? "", /missing key/);
});

test("runPiSmokeTest fails when sentinel is absent", async () => {
  const fake = runner({ code: 0, stdout: "hello\n" });

  const result = await runPiSmokeTest(fake, { repoRoot: "/repo" });

  assert.equal(result.status, "fail");
  assert.match(result.details ?? "", /hello/);
});
