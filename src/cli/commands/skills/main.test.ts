import assert from "node:assert/strict";
import test from "node:test";
import { HELP_TEXT, runSkills } from "./main.ts";

const updatedResult = {
  status: "updated" as const,
  fromVersion: "2026.04",
  toVersion: "2026.07",
  updatedFiles: 14,
  removedFiles: 2,
};

test("runSkills prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runSkills(["--help"], {
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async () => updatedResult,
    }),
    0,
  );

  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("runSkills updates project-local skills", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[] = [];

  assert.equal(
    await runSkills(["update"], {
      repoRoot: "/repo",
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async (options) => {
        calls.push(options.repoRoot);
        return updatedResult;
      },
    }),
    0,
  );

  assert.deepEqual(calls, ["/repo"]);
  assert.deepEqual(stdout, [
    "Updated Patchmill skill pack 2026.04 -> 2026.07.",
    "Updated 14 files, removed 2 obsolete files.",
    "Run git diff to review changes.",
  ]);
  assert.deepEqual(stderr, []);
});

test("runSkills reports already current packs", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runSkills(["update"], {
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async () => ({
        status: "up-to-date",
        version: "2026.07",
      }),
    }),
    0,
  );

  assert.deepEqual(stdout, ["Patchmill skill pack is already up to date."]);
  assert.deepEqual(stderr, []);
});

test("runSkills rejects unknown subcommands", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runSkills(["reset"], {
      output: {
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      updateProjectSkills: async () => updatedResult,
    }),
    1,
  );

  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, ["Unknown skills command: reset", HELP_TEXT]);
});

test("runSkills rejects update arguments", async () => {
  await assert.rejects(
    runSkills(["update", "--dry-run"], {
      updateProjectSkills: async () => updatedResult,
    }),
    /patchmill skills update does not accept arguments/u,
  );
});
