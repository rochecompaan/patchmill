import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP_TEXT, runDoctor } from "./main.ts";
import type { CommandRunner } from "../triage/types.ts";
import type { DoctorCheckResult } from "./checks.ts";

const runner: CommandRunner = {
  async run() {
    return { code: 0, stdout: "", stderr: "" };
  },
};

test("runDoctor prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runDoctor(["--help"], "/repo", {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    }),
    0,
  );

  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("runDoctor returns zero when checks pass", async () => {
  const stdout: string[] = [];
  const checks: DoctorCheckResult[] = [
    { name: "config", status: "pass", message: "patchmill.config.json" },
  ];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      { runner, runChecks: async () => checks },
    ),
    0,
  );
  assert.match(stdout.join("\n"), /Ready for safe dry runs/);
});

test("runDoctor returns one when any check fails", async () => {
  const stdout: string[] = [];
  const checks: DoctorCheckResult[] = [
    { name: "config", status: "fail", message: "missing" },
  ];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      { runner, runChecks: async () => checks },
    ),
    1,
  );
  assert.match(stdout.join("\n"), /✗ config: missing/);
});
