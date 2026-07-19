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
  if (name === "subagent-driven-development") {
    await writeFile(join(dir, "implementer-prompt.md"), "implement\n");
    await writeFile(join(dir, "task-reviewer-prompt.md"), "review\n");
    await mkdir(join(dir, "scripts"), { recursive: true });
    for (const scriptName of [
      "review-package",
      "sdd-workspace",
      "task-brief",
    ]) {
      await writeFile(
        join(dir, "scripts", scriptName),
        "#!/usr/bin/env bash\n",
      );
    }
  }
  if (name === "patchmill-visual-evidence") {
    await mkdir(join(dir, "scripts"), { recursive: true });
    await writeFile(
      join(dir, "scripts", "capture-visual-evidence.cjs"),
      "#!/usr/bin/env node\n",
    );
  }
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

function scriptedRunner(
  calls: string[][],
  results: Array<{ code?: number; stdout?: string; stderr?: string }>,
): CommandRunner {
  return {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      const result = results.shift() ?? { code: 0, stdout: "", stderr: "" };
      return {
        code: result.code ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
  };
}

const safePushInspection = [
  { stdout: "main\n" },
  { stdout: "origin/main\n" },
  { stdout: "target-sha\n" },
  { code: 0 },
  { stdout: "abc123\0chore: initialize Patchmill\n" },
];

async function runInitForGitPolicy(
  repoRoot: string,
  options: {
    args?: string[];
    isInteractive: boolean;
    promptAnswer?: string;
    promptAnswers?: string[];
    calls?: string[][];
    commandRunner?: CommandRunner;
  },
) {
  const stdout: string[] = [];
  const promptAnswers = [
    ...(options.promptAnswers ?? [options.promptAnswer ?? ""]),
  ];
  const exitCode = await runInit(
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
      prompt: async () => promptAnswers.shift() ?? "",
      commandRunner: options.commandRunner ?? runner(options.calls ?? []),
      setupLabels: async () => ({
        status: "skipped",
        message: "Label setup skipped.",
      }),
    },
  );
  return { exitCode, output: stdout.join("\n") };
}

test("interactive init add-to-git commits config, skills, and gitignore", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const { output } = await runInitForGitPolicy(repoRoot, {
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
    ["git", "rev-parse", "--abbrev-ref", "HEAD", `cwd=${repoRoot}`],
  ]);
  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    ".patchmill/pi-agent\n.patchmill/runs\n.patchmill/triage-runs\n.worktrees/\n.pi/todos/\n",
  );
  assert.match(
    output,
    /Patchmill config, skills, and local artifact ignore rules were committed/u,
  );
  assert.match(output, /must be pushed or merged into origin\/main/u);
  assert.match(output, /git push origin HEAD:main/u);
  assert.doesNotMatch(output, /local-only by default/u);
});

test("interactive init add-to-git with no skills commits config and gitignore only", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const { output } = await runInitForGitPolicy(repoRoot, {
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
    ["git", "rev-parse", "--abbrev-ref", "HEAD", `cwd=${repoRoot}`],
  ]);
  assert.match(
    output,
    /Patchmill config and local artifact ignore rules were committed/u,
  );
  assert.match(output, /must be pushed or merged into origin\/main/u);
  assert.match(output, /git push origin HEAD:main/u);
  assert.doesNotMatch(output, /.patchmill\/skills/u);
});

test("interactive init add-to-git with path skills commits the provided skill root", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  await writeSkill(repoRoot, "custom-skills", "patchmill-issue-triage");
  await writeSkill(repoRoot, "custom-skills", "patchmill-planning");
  await writeSkill(repoRoot, "custom-skills", "brainstorming");
  await writeSkill(repoRoot, "custom-skills", "writing-plans");
  await writeSkill(
    repoRoot,
    "custom-skills",
    "subagent-dev-with-validation-and-pr-checks",
  );
  await writeSkill(repoRoot, "custom-skills", "subagent-driven-development");
  await writeSkill(
    repoRoot,
    "custom-skills",
    "subagent-dev-with-codex-and-thermo-reviews",
  );
  await mkdir(
    join(
      repoRoot,
      "custom-skills",
      "subagent-dev-with-codex-and-thermo-reviews",
      "prompts",
    ),
    { recursive: true },
  );
  for (const prompt of [
    "final-validation-review.md",
    "fix-pr-checks.md",
    "fix-review-findings.md",
  ]) {
    await writeFile(
      join(
        repoRoot,
        "custom-skills",
        "subagent-dev-with-codex-and-thermo-reviews",
        "prompts",
        prompt,
      ),
      `${prompt}\n`,
    );
  }
  await writeSkill(repoRoot, "custom-skills", "patchmill-visual-evidence");

  const { output } = await runInitForGitPolicy(repoRoot, {
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
    ["git", "rev-parse", "--abbrev-ref", "HEAD", `cwd=${repoRoot}`],
  ]);
  assert.match(
    output,
    /Patchmill config, skills, and local artifact ignore rules were committed/u,
  );
  assert.match(output, /must be pushed or merged into origin\/main/u);
  assert.match(output, /git push origin HEAD:main/u);
  assert.doesNotMatch(output, /.patchmill\/skills/u);
});

test("interactive init git-ignore commits .gitignore hygiene rules", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const { output } = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "2",
    calls,
  });

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
  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "patchmill.config.json\n.patchmill/\n.worktrees/\n.pi/todos/\n",
  );
  assert.match(output, /.gitignore git hygiene rules were committed/u);
  assert.doesNotMatch(output, /local-only by default/u);
});

test("interactive init git-exclude writes config and .patchmill to local exclude", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const { output } = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "3",
    calls,
  });

  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "patchmill.config.json\n.patchmill/\n.worktrees/\n.pi/todos/\n",
  );
  assert.deepEqual(calls, []);
  assert.match(output, /Added Patchmill files to .git\/info\/exclude/u);
});

test("non-interactive and --yes init choose add without pushing", async () => {
  const nonInteractiveRoot = await tempRepo();
  const yesRoot = await tempRepo();
  const nonInteractiveCalls: string[][] = [];
  const yesCalls: string[][] = [];
  let prompted = false;

  const nonInteractive = await runInitForGitPolicy(nonInteractiveRoot, {
    isInteractive: false,
    promptAnswer: "3",
    calls: nonInteractiveCalls,
  });
  const yes = await runInit(
    ["--yes"],
    yesRoot,
    {
      stdout: (line) => {
        if (!line.includes("Created patchmill.config.json")) return;
      },
      stderr: () => undefined,
    },
    {
      detectPiReadiness: missingPiReadiness,
      runPiSmokeTest: failingPiSmokeTest,
      resolvePiInitSetup: incompletePiSetup,
      isInteractive: true,
      prompt: async () => {
        prompted = true;
        return "3";
      },
      commandRunner: runner(yesCalls),
      setupLabels: async () => ({
        status: "skipped",
        message: "Label setup skipped.",
      }),
    },
  );

  assert.equal(prompted, false);
  assert.equal(yes, 0);
  assert.match(
    await readFile(join(nonInteractiveRoot, ".gitignore"), "utf8"),
    /\.patchmill\/runs/u,
  );
  assert.match(nonInteractive.output, /git push origin HEAD:main/u);
  assert.equal(
    nonInteractiveCalls.some((call) => call[1] === "push"),
    false,
  );
  assert.equal(
    yesCalls.some((call) => call[1] === "push"),
    false,
  );
});

test("interactive init offers and pushes a safe Patchmill setup commit", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const { output } = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswers: ["", ""],
    commandRunner: scriptedRunner(calls, [
      { code: 0 },
      { code: 0 },
      ...safePushInspection,
      { code: 0 },
    ]),
  });

  assert.deepEqual(calls.at(-1), [
    "git",
    "push",
    "origin",
    "HEAD:main",
    `cwd=${repoRoot}`,
  ]);
  assert.match(output, /Pushed Patchmill setup commit to origin\/main/u);
  assert.doesNotMatch(output, /git.baseRef HEAD is not contained/u);
});

test("interactive init prints guidance when setup push is declined", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];

  const { output } = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswers: ["", "n"],
    commandRunner: scriptedRunner(calls, [
      { code: 0 },
      { code: 0 },
      ...safePushInspection,
    ]),
  });

  assert.equal(
    calls.some((call) => call[1] === "push"),
    false,
  );
  assert.match(output, /must be pushed or merged into origin\/main/u);
  assert.match(output, /git push origin HEAD:main/u);
});

test("interactive init reports commit failures without aborting label or Pi setup", async () => {
  const repoRoot = await tempRepo();
  const calls: string[][] = [];
  const failingCommitRunner: CommandRunner = {
    async run(command, args, options) {
      calls.push([command, ...args, `cwd=${options?.cwd ?? ""}`]);
      if (args[0] === "commit") {
        return { code: 1, stdout: "", stderr: "author identity unknown" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };

  const { exitCode, output } = await runInitForGitPolicy(repoRoot, {
    isInteractive: true,
    promptAnswer: "1",
    commandRunner: failingCommitRunner,
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.filter((call) => call[1] === "commit").length, 1);
  assert.match(output, /Warning: git commit failed/u);
  assert.match(output, /author identity unknown/u);
  assert.match(output, /Label setup skipped\./u);
  assert.match(output, /Pi provider\/model setup is incomplete/u);
});
