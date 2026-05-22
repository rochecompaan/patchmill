import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandRunner, createDryRunCommandRunner, createStaticCommandRunner, shellQuote } from "./command.ts";

test("shellQuote preserves simple values", () => {
  assert.equal(shellQuote("tea"), "tea");
  assert.equal(shellQuote("issue-42"), "issue-42");
});

test("shellQuote quotes values with spaces", () => {
  assert.equal(shellQuote("hello world"), "'hello world'");
});

test("dry-run runner records commands without executing", async () => {
  const runner = createDryRunCommandRunner();
  const result = await runner.run("tea", ["issues", "list", "--output", "json"], { cwd: "/repo" });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(runner.commands, ["cd /repo && tea issues list --output json"]);
});

test("command runner captures stdout from successful commands", async () => {
  const runner = createCommandRunner();
  const result = await runner.run(process.execPath, ["-e", "console.log('ok')"]);

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
  const result = await runner.run(process.execPath, ["-e", "console.error('bad'); process.exit(7)"]);

  assert.equal(result.code, 7);
  assert.match(result.stderr, /bad/);
});

test("command runner reports spawn errors for missing commands", async () => {
  const runner = createCommandRunner();
  const result = await runner.run("definitely-not-a-real-croprun-command", []);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /definitely-not-a-real-croprun-command|ENOENT/);
});

test("command runner uses the provided cwd", async () => {
  const runner = createCommandRunner();
  const cwd = await mkdtemp(join(tmpdir(), "croprun-command-runner-"));
  const result = await runner.run(process.execPath, ["-e", "console.log(process.cwd())"], { cwd });

  assert.equal(result.code, 0);
  assert.equal(result.stdout, `${cwd}\n`);
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
  assert.deepEqual(runner.calls.map((call) => call.command), ["first", "second"]);
  assert.deepEqual(runner.calls[0].args, ["first-arg"]);
});
