import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CommandRunner } from "../triage/types.ts";
import { runInit } from "./main.ts";

async function tempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-init-git-policy-"));
  await mkdir(join(repoRoot, ".git", "info"), { recursive: true });
  return repoRoot;
}

async function writeSkill(repoRoot: string, skillRoot: string, name: string) {
  const dir = join(repoRoot, skillRoot, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill\n---\n`,
  );
}

function missingPiReadiness() {
  return {
    status: "missing" as const,
    message: "Pi did not report any provider/model with configured auth.",
    models: [],
  };
}

async function failingPiSmokeTest() {
  return {
    status: "fail" as const,
    message: "Pi could not complete the provider smoke test.",
    command:
      "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.",
    details: "missing key",
  };
}

async function incompletePiSetup() {
  return {
    status: "incomplete" as const,
    readiness: missingPiReadiness(),
    selection: {
      status: "unavailable" as const,
      reason: "not-ready" as const,
      message: "Pi provider/model setup is incomplete.",
    },
    smoke: await failingPiSmokeTest(),
  };
}

function runner(calls: string[][]): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function runInitForGitPolicy(
  repoRoot: string,
  options: {
    args?: string[];
    isInteractive: boolean;
    promptAnswer?: string;
    calls?: string[][];
  },
) {
  const stdout: string[] = [];
  await runInit(
    options.args ?? [],
    repoRoot,
    {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    },
    {
      detectPiReadiness: missingPiReadiness,
      runPiSmokeTest: failingPiSmokeTest,
      resolvePiInitSetup: incompletePiSetup,
      isInteractive: options.isInteractive,
      prompt: async () => options.promptAnswer ?? "",
      commandRunner: runner(options.calls ?? []),
      setupLabels: async () => ({
        status: "skipped",
        message: "Label setup skipped.",
      }),
    },
  );
  return stdout.join("\n");
}

test("interactive init add-to-git stages config, skills, and gitignore", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const output = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "1",
    calls,
  });

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
  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    ".patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n",
  );
  assert.match(output, /Added Patchmill config and skills to git/u);
  assert.doesNotMatch(output, /local-only by default/u);
});

test("interactive init add-to-git with no skills stages config and gitignore only", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const output = await runInitForGitPolicy(repoRoot, {
    args: ["--skills", "none"],
    isInteractive: true,
    promptAnswer: "1",
    calls,
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
  assert.match(output, /Added Patchmill config to git/u);
  assert.doesNotMatch(output, /.patchmill\/skills/u);
});

test("interactive init add-to-git with path skills stages the provided skill root", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeSkill(repoRoot, "custom-skills", "patchmill-issue-triage");
  await writeSkill(repoRoot, "custom-skills", "writing-plans");
  await writeSkill(repoRoot, "custom-skills", "subagent-driven-development");

  const output = await runInitForGitPolicy(repoRoot, {
    args: ["--skills", "path:custom-skills"],
    isInteractive: true,
    promptAnswer: "1",
    calls,
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
  assert.match(output, /Added Patchmill config and skills to git/u);
  assert.doesNotMatch(output, /.patchmill\/skills/u);
});

test("interactive init git-ignore writes config and .patchmill to .gitignore", async () => {
  const repoRoot = await tempRepo();

  const output = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "2",
  });

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(output, /Added Patchmill files to .gitignore/u);
  assert.doesNotMatch(output, /local-only by default/u);
});

test("interactive init git-exclude writes config and .patchmill to local exclude", async () => {
  const repoRoot = await tempRepo();

  const output = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "3",
  });

  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.match(output, /Added Patchmill files to .git\/info\/exclude/u);
});

test("non-interactive and --yes init choose git-exclude without prompting", async () => {
  const nonInteractiveRoot = await tempRepo();
  const yesRoot = await tempRepo();
  let prompted = false;

  await runInitForGitPolicy(nonInteractiveRoot, {
    isInteractive: false,
    promptAnswer: "1",
  });
  await runInit(
    ["--yes"],
    yesRoot,
    {
      stdout: () => undefined,
      stderr: () => undefined,
    },
    {
      detectPiReadiness: missingPiReadiness,
      runPiSmokeTest: failingPiSmokeTest,
      resolvePiInitSetup: incompletePiSetup,
      isInteractive: true,
      prompt: async () => {
        prompted = true;
        return "1";
      },
      commandRunner: runner([]),
      setupLabels: async () => ({
        status: "skipped",
        message: "Label setup skipped.",
      }),
    },
  );

  assert.equal(prompted, false);
  assert.equal(
    await readFile(join(nonInteractiveRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
  assert.equal(
    await readFile(join(yesRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n",
  );
});
