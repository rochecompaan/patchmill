import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CommandRunner } from "../triage/types.ts";
import { applyInitGitPolicy, selectInitGitPolicy } from "./git-policy.ts";

async function tempRepo(options: { git?: boolean } = { git: true }) {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-git-policy-"));
  if (options.git !== false) {
    await mkdir(join(repoRoot, ".git", "info"), { recursive: true });
  }
  return repoRoot;
}

function recordingRunner(calls: string[][] = []): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

test("selectInitGitPolicy defaults to git-exclude for non-interactive runs", async () => {
  assert.equal(
    await selectInitGitPolicy({ isInteractive: false, assumeYes: false }),
    "exclude",
  );
  assert.equal(
    await selectInitGitPolicy({ isInteractive: true, assumeYes: true }),
    "exclude",
  );
});

test("selectInitGitPolicy accepts add, ignore, and exclude prompt answers", async () => {
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "1",
    }),
    "add",
  );
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "ignore",
    }),
    "ignore",
  );
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async () => "",
    }),
    "exclude",
  );
});

test("applyInitGitPolicy add stages config, skills, and runtime ignore entries", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  await mkdir(join(repoRoot, ".patchmill", "skills"), { recursive: true });

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: recordingRunner(calls),
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    ".patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  assert.deepEqual(calls, [
    [
      "git",
      "add",
      "-f",
      "patchmill.config.json",
      ".patchmill/skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(result.message, /Added Patchmill config and skills to git/u);
});

test("applyInitGitPolicy add omits missing skills directory", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: recordingRunner(calls),
  });

  assert.deepEqual(calls, [
    [
      "git",
      "add",
      "-f",
      "patchmill.config.json",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(result.message, /Staged patchmill.config.json and .gitignore/u);
  assert.doesNotMatch(result.message, /.patchmill\/skills/u);
});

test("applyInitGitPolicy add stages provided repo-local skill roots", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  await mkdir(join(repoRoot, "custom-skills"), { recursive: true });

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: recordingRunner(calls),
    skillRoots: ["custom-skills"],
  });

  assert.deepEqual(calls, [
    [
      "git",
      "add",
      "-f",
      "patchmill.config.json",
      "custom-skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(result.message, /Added Patchmill config and skills to git/u);
});

test("applyInitGitPolicy add force-stages skills when .patchmill is ignored", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  await mkdir(join(repoRoot, ".patchmill", "skills"), { recursive: true });
  await writeFile(join(repoRoot, ".gitignore"), ".patchmill/\n");

  await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: recordingRunner(calls),
  });

  assert.deepEqual(calls[0]?.slice(0, 4), [
    "git",
    "add",
    "-f",
    "patchmill.config.json",
  ]);
  assert.ok(calls[0]?.includes(".patchmill/skills"));
});

test("applyInitGitPolicy ignore writes patchmill.config.json and .patchmill to .gitignore", async () => {
  const repoRoot = await tempRepo();

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "ignore",
    runner: recordingRunner(),
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(result.message, /Added Patchmill files to .gitignore/u);
});

test("applyInitGitPolicy exclude writes patchmill.config.json and .patchmill to local exclude", async () => {
  const repoRoot = await tempRepo();

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(result.message, /Added Patchmill files to .git\/info\/exclude/u);
});

test("applyInitGitPolicy does not duplicate existing ignore or exclude entries", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, ".gitignore"),
    "node_modules\n.patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  await writeFile(
    join(repoRoot, ".git", "info", "exclude"),
    "node_modules\n.patchmill\npatchmill.config.json\n",
  );

  await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: recordingRunner(),
  });
  await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "node_modules\n.patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "node_modules\n.patchmill\npatchmill.config.json\n",
  );
});

test("applyInitGitPolicy treats root-anchored exclude entries as duplicates", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, ".git", "info", "exclude"),
    "node_modules\n/.patchmill/\n/patchmill.config.json\n",
  );

  await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "node_modules\n/.patchmill/\n/patchmill.config.json\n",
  );
});

test("applyInitGitPolicy reports missing git metadata without failing init", async () => {
  const repoRoot = await tempRepo({ git: false });

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.match(
    result.message,
    /Warning: Patchmill could not update .git\/info\/exclude/u,
  );
  assert.match(result.message, /patchmill.config.json/u);
  assert.match(result.message, /.patchmill\//u);
});

test("applyInitGitPolicy reports local exclude write failures without failing init", async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-git-policy-"));
  await mkdir(join(repoRoot, ".git"), { recursive: true });
  await writeFile(join(repoRoot, ".git", "info"), "not a directory\n");

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(),
  });

  assert.match(
    result.message,
    /Warning: Patchmill could not update .git\/info\/exclude/u,
  );
  assert.match(result.message, /not a directory|EEXIST/u);
  assert.match(result.message, /patchmill.config.json/u);
  assert.match(result.message, /.patchmill\//u);
});
