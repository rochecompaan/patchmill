import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandFailedError, runCommand } from "./command.ts";

test("runCommand preserves stdout and a non-zero exit code", async () => {
  assert.deepEqual(
    await runCommand(process.execPath, [
      "-e",
      "process.stdout.write('hi'); process.exit(3)",
    ]),
    { code: 3, stdout: "hi", stderr: "" },
  );
});

test("runCommand delivers stdin", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdin.pipe(process.stdout)"],
    { stdin: "abc" },
  );
  assert.deepEqual(result, { code: 0, stdout: "abc", stderr: "" });
});

test("runCommand passes cwd", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write(process.cwd())"],
    { cwd: "/" },
  );
  assert.equal(result.stdout, "/");
});

test("runCommand passes the supplied environment", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write(process.env.PATCHMILL_PROBE)"],
    { env: { ...process.env, PATCHMILL_PROBE: "1" } },
  );
  assert.equal(result.stdout, "1");
});

test("runCommand resolves with diagnostics when a binary cannot start", async () => {
  const result = await runCommand("patchmill-no-such-binary-xyz", []);
  assert.equal(result.code, -1);
  assert.match(result.stderr, /ENOENT/);
});

test("runCommand reports abort even when the child handles SIGTERM and exits zero", async () => {
  const controller = new AbortController();
  const reportOnSignal = process.report.reportOnSignal;
  process.report.reportOnSignal = false;
  const abort = () => controller.abort();
  process.once("SIGUSR2", abort);
  try {
    const result = await runCommand(
      process.execPath,
      [
        "-e",
        'process.on("SIGTERM", () => process.exit(0)); process.kill(process.ppid, "SIGUSR2"); setInterval(() => {}, 1000)',
      ],
      { signal: controller.signal },
    );
    assert.equal(result.code, -1);
    assert.match(result.stderr, /aborted/i);
  } finally {
    process.removeListener("SIGUSR2", abort);
    process.report.reportOnSignal = reportOnSignal;
  }
});

test("runCommand resolves synchronous spawn failures with diagnostics", async () => {
  const result = await runCommand(process.execPath, ["-e", "1", "a\u0000b"]);
  assert.equal(result.code, -1);
  assert.match(result.stderr, /null bytes/);
});

test("CommandFailedError exposes command context and trimmed diagnostics", () => {
  const error = new CommandFailedError("gh", ["auth", "status"], {
    code: 1,
    stdout: "",
    stderr: "not logged in\n",
  });
  assert.equal(error.name, "CommandFailedError");
  assert.equal(
    error.message,
    "gh auth status exited with code 1: not logged in",
  );
  assert.equal(error.command, "gh");
  assert.deepEqual(error.args, ["auth", "status"]);
  assert.equal(error.result.code, 1);
});
