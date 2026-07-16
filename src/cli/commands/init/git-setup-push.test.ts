import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandResult, CommandRunner } from "../triage/types.ts";
import { maybeOfferInitSetupPush } from "./git-setup-push.ts";

type ScriptedResult = Partial<CommandResult>;

function result(value: ScriptedResult = {}): CommandResult {
  return {
    code: value.code ?? 0,
    stdout: value.stdout ?? "",
    stderr: value.stderr ?? "",
  };
}

function runner(calls: string[][], results: ScriptedResult[]): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      return result(results.shift());
    },
  };
}

const safeInspection: ScriptedResult[] = [
  { stdout: "main\n" },
  { stdout: "origin/main\n" },
  { stdout: "target-sha\n" },
  { code: 0 },
  { stdout: "abc123\0chore: initialize Patchmill\n" },
];

test("maybeOfferInitSetupPush pushes a safe setup commit when accepted", async () => {
  const calls: string[][] = [];
  const prompts: string[] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [...safeInspection, { code: 0 }]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: true,
    assumeYes: false,
    prompt: async (question) => {
      prompts.push(question);
      return "";
    },
  });

  assert.equal(prompts.length, 1);
  assert.match(prompts[0] ?? "", /Push it now\? \[Y\/n\]/u);
  assert.deepEqual(calls.at(-1), [
    "git",
    "push",
    "origin",
    "HEAD:main",
    "cwd=/repo",
  ]);
  assert.match(
    outcome.message ?? "",
    /Pushed Patchmill setup commit to origin\/main/u,
  );
});

test("maybeOfferInitSetupPush prints guidance when safe push is declined", async () => {
  const calls: string[][] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [...safeInspection]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: true,
    assumeYes: false,
    prompt: async () => "n",
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    false,
  );
  assert.match(
    outcome.message ?? "",
    /must be pushed or merged into origin\/main/u,
  );
  assert.match(outcome.message ?? "", /git push origin HEAD:main/u);
});

test("maybeOfferInitSetupPush does not push in non-interactive mode", async () => {
  const calls: string[][] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [...safeInspection]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: false,
    assumeYes: false,
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    false,
  );
  assert.match(outcome.message ?? "", /Patchmill did not push automatically/u);
  assert.match(outcome.message ?? "", /non-interactive/u);
});

test("maybeOfferInitSetupPush reports an upstream mismatch", async () => {
  const calls: string[][] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [
      { stdout: "main\n" },
      { stdout: "origin/develop\n" },
    ]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: true,
    assumeYes: false,
    prompt: async () => "",
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    false,
  );
  assert.match(
    outcome.message ?? "",
    /current branch tracks origin\/develop, not origin\/main/u,
  );
  assert.match(outcome.message ?? "", /git push origin HEAD:main/u);
});

test("maybeOfferInitSetupPush reports missing remote tracking ref", async () => {
  const calls: string[][] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [
      { stdout: "main\n" },
      { stdout: "origin/main\n" },
      { code: 128, stderr: "fatal: Needed a single revision" },
    ]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: true,
    assumeYes: false,
    prompt: async () => "",
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    false,
  );
  assert.match(
    outcome.message ?? "",
    /refs\/remotes\/origin\/main is missing/u,
  );
});

test("maybeOfferInitSetupPush refuses multiple unpushed commits", async () => {
  const calls: string[][] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [
      ...safeInspection.slice(0, 4),
      {
        stdout:
          "abc123\0chore: initialize Patchmill\n" +
          "def456\0docs: local setup\n",
      },
    ]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: true,
    assumeYes: false,
    prompt: async () => "",
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    false,
  );
  assert.match(outcome.message ?? "", /HEAD has unpushed commits in addition/u);
  assert.match(outcome.message ?? "", /docs: local setup/u);
});

test("maybeOfferInitSetupPush reports push failures with git output", async () => {
  const calls: string[][] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [
      ...safeInspection,
      { code: 1, stderr: "protected branch" },
    ]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: true,
    assumeYes: false,
    prompt: async () => "yes",
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    true,
  );
  assert.match(outcome.message ?? "", /Warning: git push failed/u);
  assert.match(outcome.message ?? "", /protected branch/u);
  assert.match(outcome.message ?? "", /git push origin HEAD:main/u);
});

test("maybeOfferInitSetupPush reports detached HEAD", async () => {
  const calls: string[][] = [];

  const outcome = await maybeOfferInitSetupPush({
    repoRoot: "/repo",
    runner: runner(calls, [{ stdout: "HEAD\n" }]),
    remote: "origin",
    baseBranch: "main",
    isInteractive: true,
    assumeYes: false,
    prompt: async () => "",
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    false,
  );
  assert.match(outcome.message ?? "", /current checkout is detached/u);
});
