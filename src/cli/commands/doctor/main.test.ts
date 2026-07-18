import assert from "node:assert/strict";
import { test } from "node:test";
import { HELP_TEXT, runDoctor } from "./main.ts";
import type { CommandRunner } from "../triage/types.ts";
import type { DoctorCheckResult } from "./checks.ts";
import type { DoctorPiResourceReport } from "./pi-resources.ts";

const runner: CommandRunner = {
  async run() {
    return { code: 0, stdout: "", stderr: "" };
  },
};

const emptyResources: DoctorPiResourceReport = { blocks: [] };

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

test("HELP_TEXT documents fix and yes", () => {
  assert.match(HELP_TEXT, /--fix[\s\S]*Create missing labels after approval/);
  assert.match(HELP_TEXT, /--yes[\s\S]*Skip --fix approval prompt/);
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
      {
        runner,
        loadPiResources: async () => emptyResources,
        runChecks: async () => checks,
      },
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
      {
        runner,
        loadPiResources: async () => emptyResources,
        runChecks: async () => checks,
      },
    ),
    1,
  );
  assert.match(stdout.join("\n"), /✗ config: missing/);
});

test("runDoctor --fix runs label setup and prints its review", async () => {
  const stdout: string[] = [];
  let called = false;

  assert.equal(
    await runDoctor(
      ["--fix"],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => emptyResources,
        runChecks: async () => [
          { name: "labels", status: "pass", message: "ok" },
        ],
        setupLabels: async (options) => {
          called = true;
          assert.equal(options.assumeYes, false);
          return {
            status: "created",
            missingCount: 1,
            createdCount: 1,
            message:
              "Patchmill needs these labels:\n  agent-ready — Ready for automated agent processing\n\nCreated 1 label.",
          };
        },
      },
    ),
    0,
  );

  assert.equal(called, true);
  assert.match(stdout.join("\n"), /Created 1 label/);
});

test("runDoctor --fix --yes passes assumeYes", async () => {
  let assumeYes: boolean | undefined;

  assert.equal(
    await runDoctor(
      ["--fix", "--yes"],
      "/repo",
      { stdout: () => undefined, stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => emptyResources,
        runChecks: async () => [],
        setupLabels: async (options) => {
          assumeYes = options.assumeYes;
          return {
            status: "satisfied",
            missingCount: 0,
            createdCount: 0,
            message: "Required labels already exist.",
          };
        },
      },
    ),
    0,
  );

  assert.equal(assumeYes, true);
});

test("runDoctor prints Pi resource blocks before checks", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [
            {
              label: "run-once planning",
              sections: [
                { heading: "Context", items: ["AGENTS.md"] },
                { heading: "Skills", items: ["github"] },
              ],
            },
          ],
        }),
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.match(
    stdout.join("\n"),
    /^\[Pi resources: run-once planning\]\n\n\[Context\]\n {2}AGENTS\.md\n\n\[Skills\]\n {2}github\n\nPatchmill doctor/m,
  );
});

test("runDoctor adds Pi resource warnings without failing", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [],
          check: {
            name: "pi resources",
            status: "warn",
            message: "skipped missing package npm:@acme/pi-tools",
          },
        }),
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.match(stdout.join("\n"), /! pi resources: skipped missing package/);
  assert.match(stdout.join("\n"), /Ready for safe dry runs/);
});

test("runDoctor converts thrown Pi resource provider errors to warnings", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      [],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => {
          throw new Error("resource load exploded");
        },
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.match(
    stdout.join("\n"),
    /! pi resources: could not list Pi resources: resource load exploded/,
  );
});

test("runDoctor --quiet suppresses resource-only output", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      ["--quiet"],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [
            {
              label: "run-once planning",
              sections: [{ heading: "Skills", items: ["github"] }],
            },
          ],
        }),
        runChecks: async () => [
          { name: "config", status: "pass", message: "patchmill.config.json" },
        ],
      },
    ),
    0,
  );

  assert.deepEqual(stdout, []);
});

test("runDoctor --quiet prints resources when a required check fails", async () => {
  const stdout: string[] = [];

  assert.equal(
    await runDoctor(
      ["--quiet"],
      "/repo",
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        runner,
        loadPiResources: async () => ({
          blocks: [
            {
              label: "run-once planning",
              sections: [{ heading: "Skills", items: ["github"] }],
            },
          ],
        }),
        runChecks: async () => [
          { name: "config", status: "fail", message: "missing" },
        ],
      },
    ),
    1,
  );

  assert.match(stdout.join("\n"), /\[Pi resources: run-once planning\]/);
  assert.match(stdout.join("\n"), /✗ config: missing/);
});
