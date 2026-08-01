import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticCommandRunner } from "../../../../test-support/command-runner.ts";
import { createCommandRunner } from "./command.ts";

test("command runner captures stdout from successful commands", async () => {
  const runner = createCommandRunner();
  const result = await runner.run(process.execPath, [
    "-e",
    "console.log('ok')",
  ]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "ok\n");
  assert.equal(result.stderr, "");
});

test("command runner streams stdout and stderr chunks while still capturing output", async () => {
  const runner = createCommandRunner();
  const chunks: string[] = [];
  const result = await runner.run(
    process.execPath,
    ["-e", "process.stdout.write('out'); process.stderr.write('err')"],
    {
      onStdout: (chunk) => chunks.push(`stdout:${chunk}`),
      onStderr: (chunk) => chunks.push(`stderr:${chunk}`),
    },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "out");
  assert.equal(result.stderr, "err");
  assert.deepEqual(chunks.sort(), ["stderr:err", "stdout:out"]);
});

test("command runner captures non-zero exit code and stderr", async () => {
  const runner = createCommandRunner();
  const result = await runner.run(process.execPath, [
    "-e",
    "console.error('bad'); process.exit(7)",
  ]);

  assert.equal(result.code, 7);
  assert.match(result.stderr, /bad/);
});

test("command runner reports spawn errors for missing commands", async () => {
  const runner = createCommandRunner();
  const result = await runner.run(
    "definitely-not-a-real-patchmill-command",
    [],
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /definitely-not-a-real-patchmill-command|ENOENT/);
});

test("command runner uses the provided cwd", async () => {
  const runner = createCommandRunner();
  const cwd = await mkdtemp(join(tmpdir(), "patchmill-command-runner-"));
  const result = await runner.run(
    process.execPath,
    ["-e", "console.log(process.cwd())"],
    { cwd },
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${cwd}\n`);
});

test("command runner aborts an in-flight process and waits for close", async () => {
  const runner = createCommandRunner();
  const controller = new AbortController();
  let started!: () => void;
  const didStart = new Promise<void>((resolve) => {
    started = resolve;
  });
  const resultPromise = runner.run(
    process.execPath,
    [
      "-e",
      [
        "process.stdout.write('started\\n');",
        "process.stderr.write('stderr-before-abort\\n');",
        "process.on('SIGTERM', () => {",
        "  process.stdout.write('closed-after-abort\\n');",
        "  process.exit(0);",
        "});",
        "process.stdout.write('ready-to-abort\\n');",
        "setInterval(() => {}, 1000);",
      ].join(""),
    ],
    {
      signal: controller.signal,
      onStdout: (chunk) => {
        if (chunk.includes("ready-to-abort")) started();
      },
    },
  );

  await didStart;
  controller.abort();
  const result = await resultPromise;

  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /closed-after-abort/);
  assert.match(result.stderr, /stderr-before-abort|aborted/i);
});

test("command runner does not spawn when signal is already aborted", async () => {
  const runner = createCommandRunner();
  const controller = new AbortController();
  controller.abort();

  const result = await runner.run(
    process.execPath,
    ["-e", "process.stdout.write('should-not-run')"],
    { signal: controller.signal },
  );

  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /aborted/i);
});

test("static runner returns queued results and records calls", async () => {
  const runner = createStaticCommandRunner([
    { code: 0, stdout: "one", stderr: "" },
    { code: 1, stdout: "", stderr: "two" },
  ]);
  const args = ["first-arg"];

  assert.equal((await runner.run("first", args)).stdout, "one");
  args.push("mutated");
  assert.equal((await runner.run("second", [])).stderr, "two");
  assert.deepEqual(
    runner.calls.map((call) => call.command),
    ["first", "second"],
  );
  assert.deepEqual(runner.calls[0].args, ["first-arg"]);
});
