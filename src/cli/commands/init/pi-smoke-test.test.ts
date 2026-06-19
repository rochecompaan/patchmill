import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandRunner } from "../triage/types.ts";
import { runPiSmokeTest } from "./pi-smoke-test.ts";

const FAKE_PI_COMMAND = { command: "pi", argsPrefix: [] };

function runner(result: {
  code: number;
  stdout?: string;
  stderr?: string;
}): CommandRunner & {
  calls: Array<{
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
  }>;
} {
  const calls: Array<{
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
  }> = [];
  return {
    calls,
    async run(command, args, options = {}) {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return { stdout: "", stderr: "", ...result };
    },
  };
}

test("runPiSmokeTest succeeds when Pi prints sentinel", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  const result = await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    model: "anthropic/claude-sonnet-4-5",
    piCommand: FAKE_PI_COMMAND,
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
      env: undefined,
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

test("runPiSmokeTest uses injectable bundled command spec without spawning real Pi", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    piCommand: { command: "node", argsPrefix: ["/pkg/dist/cli.js"] },
  });

  assert.equal(fake.calls[0]?.command, "node");
  assert.deepEqual(fake.calls[0]?.args.slice(0, 2), [
    "/pkg/dist/cli.js",
    "--no-session",
  ]);
});

test("runPiSmokeTest scopes Pi to the provided local agent dir", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    model: "openai-codex/gpt-5.5",
    piAgentDir: "/repo/.patchmill/pi-agent",
    piCommand: FAKE_PI_COMMAND,
  });

  assert.equal(
    fake.calls[0]?.env?.PI_CODING_AGENT_DIR,
    "/repo/.patchmill/pi-agent",
  );
});

test("runPiSmokeTest omits model when no model is selected", async () => {
  const fake = runner({ code: 0, stdout: "PATCHMILL_PI_OK\n" });

  await runPiSmokeTest(fake, { repoRoot: "/repo", piCommand: FAKE_PI_COMMAND });

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

  const result = await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    piCommand: FAKE_PI_COMMAND,
  });

  assert.equal(result.status, "fail");
  assert.match(result.message, /Pi could not complete the provider smoke test/);
  assert.match(result.details ?? "", /missing key/);
});

test("runPiSmokeTest fails when sentinel is absent", async () => {
  const fake = runner({ code: 0, stdout: "hello\n" });

  const result = await runPiSmokeTest(fake, {
    repoRoot: "/repo",
    piCommand: FAKE_PI_COMMAND,
  });

  assert.equal(result.status, "fail");
  assert.match(result.details ?? "", /hello/);
});
