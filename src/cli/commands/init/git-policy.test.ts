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

function scriptedRunner(
  calls: string[][] = [],
  results: Array<{ code: number; stdout?: string; stderr?: string }> = [],
): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      const result = results.shift() ?? { code: 0, stdout: "", stderr: "" };
      return {
        code: result.code,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

test("selectInitGitPolicy defaults to add for defaulted runs", async () => {
  assert.equal(
    await selectInitGitPolicy({ isInteractive: false, assumeYes: false }),
    "add",
  );
  assert.equal(
    await selectInitGitPolicy({ isInteractive: true, assumeYes: true }),
    "add",
  );

  let question = "";
  assert.equal(
    await selectInitGitPolicy({
      isInteractive: true,
      assumeYes: false,
      prompt: async (value) => {
        question = value;
        return "";
      },
    }),
    "add",
  );
  assert.match(
    question,
    /1\) Add config and skills to git \(recommended for shared config\)/u,
  );
  assert.match(question, /Choose 1, 2, or 3 \[1\]:/u);
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
      prompt: async () => "3",
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
    ".patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n.worktrees/\n.pi/todos/\n",
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
    [
      "git",
      "commit",
      "-m",
      "chore: initialize Patchmill",
      "--",
      "patchmill.config.json",
      ".patchmill/skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(
    result.message,
    /Patchmill config, skills, and local artifact ignore rules were committed/u,
  );
  assert.deepEqual(result.setupCommit, {
    status: "committed",
    paths: ["patchmill.config.json", ".patchmill/skills", ".gitignore"],
  });
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
    [
      "git",
      "commit",
      "-m",
      "chore: initialize Patchmill",
      "--",
      "patchmill.config.json",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(
    result.message,
    /Patchmill config and local artifact ignore rules were committed/u,
  );
  assert.deepEqual(result.setupCommit, {
    status: "committed",
    paths: ["patchmill.config.json", ".gitignore"],
  });
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
    [
      "git",
      "commit",
      "-m",
      "chore: initialize Patchmill",
      "--",
      "patchmill.config.json",
      "custom-skills",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(
    result.message,
    /Patchmill config, skills, and local artifact ignore rules were committed/u,
  );
  assert.deepEqual(result.setupCommit, {
    status: "committed",
    paths: ["patchmill.config.json", "custom-skills", ".gitignore"],
  });
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
  assert.deepEqual(calls[1]?.slice(0, 6), [
    "git",
    "commit",
    "-m",
    "chore: initialize Patchmill",
    "--",
    "patchmill.config.json",
  ]);
});

test("applyInitGitPolicy ignore writes patchmill entries to .gitignore and commits .gitignore", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "ignore",
    runner: recordingRunner(calls),
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "patchmill.config.json\n.patchmill/\n.worktrees/\n.pi/todos/\n",
  );
  assert.deepEqual(calls, [
    ["git", "add", ".gitignore", `cwd=${repoRoot}`],
    [
      "git",
      "commit",
      "-m",
      "chore: initialize Patchmill git hygiene",
      "--",
      ".gitignore",
      `cwd=${repoRoot}`,
    ],
  ]);
  assert.match(result.message, /.gitignore git hygiene rules were committed/u);
});

test("applyInitGitPolicy exclude writes patchmill entries to local exclude without git commands", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "exclude",
    runner: recordingRunner(calls),
  });

  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n.worktrees/\n.pi/todos/\n",
  );
  assert.deepEqual(calls, []);
  assert.match(result.message, /Added Patchmill files to .git\/info\/exclude/u);
});

test("applyInitGitPolicy ignore skips commit when entries already exist", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeFile(
    join(repoRoot, ".gitignore"),
    "patchmill.config.json\n.patchmill/\n.worktrees/\n.pi/todos/\n",
  );

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "ignore",
    runner: recordingRunner(calls),
  });

  assert.deepEqual(calls, []);
  assert.match(result.message, /No git hygiene commit was needed/u);
});

test("applyInitGitPolicy does not duplicate existing ignore or exclude entries", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, ".gitignore"),
    "node_modules\n.patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n/.worktrees/\n.pi/todos\n",
  );
  await writeFile(
    join(repoRoot, ".git", "info", "exclude"),
    "node_modules\n.patchmill\npatchmill.config.json\n.worktrees\n/.pi/todos/\n",
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
    "node_modules\n.patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n/.worktrees/\n.pi/todos\n",
  );
  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "node_modules\n.patchmill\npatchmill.config.json\n.worktrees\n/.pi/todos/\n",
  );
});

test("applyInitGitPolicy treats root-anchored ignore entries as duplicates", async () => {
  const repoRoot = await tempRepo();
  await writeFile(
    join(repoRoot, ".gitignore"),
    "/patchmill.config.json\n/.patchmill/\n/.worktrees/\n/.pi/todos/\n",
  );
  const calls: string[][] = [];

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "ignore",
    runner: recordingRunner(calls),
  });

  assert.deepEqual(calls, []);
  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "/patchmill.config.json\n/.patchmill/\n/.worktrees/\n/.pi/todos/\n",
  );
  assert.match(result.message, /No git hygiene commit was needed/u);
});

test("applyInitGitPolicy reports git add failures as non-fatal warnings", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: scriptedRunner(calls, [{ code: 1, stderr: "index locked" }]),
  });

  assert.equal(calls.filter((call) => call[1] === "commit").length, 0);
  assert.match(result.message, /Warning/u);
  assert.match(result.message, /git add failed/u);
  assert.match(result.message, /index locked/u);
});

test("applyInitGitPolicy reports git commit failures as non-fatal warnings", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");

  const result = await applyInitGitPolicy({
    repoRoot,
    policy: "add",
    runner: scriptedRunner(calls, [
      { code: 0 },
      { code: 1, stderr: "author identity unknown" },
    ]),
  });

  assert.equal(calls.filter((call) => call[1] === "commit").length, 1);
  assert.match(result.message, /Warning/u);
  assert.match(result.message, /git commit failed/u);
  assert.match(result.message, /author identity unknown/u);
  assert.deepEqual(result.setupCommit, {
    status: "commit-warning",
    paths: ["patchmill.config.json", ".gitignore"],
  });
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
  assert.match(result.message, /.worktrees\//u);
  assert.match(result.message, /.pi\/todos\//u);
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
  assert.match(result.message, /.worktrees\//u);
  assert.match(result.message, /.pi\/todos\//u);
});
