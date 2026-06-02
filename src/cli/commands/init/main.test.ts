import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, runInit } from "./main.ts";

const PROJECT_LOCAL_SKILLS = {
  triage: ".patchmill/skills/patchmill-issue-triage",
  planning: ".patchmill/skills/writing-plans",
  implementation: ".patchmill/skills/subagent-driven-development",
};

const GLOBAL_SKILLS = {
  triage: "patchmill-issue-triage",
  planning: "superpowers:writing-plans",
  implementation: "superpowers:subagent-driven-development",
};

async function tempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-init-main-"));
  await mkdir(join(repoRoot, ".git", "info"), { recursive: true });
  return repoRoot;
}

async function readConfig(repoRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
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

test("runInit prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runInit(["--help"], await tempRepo(), {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    }),
    0,
  );
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("HELP_TEXT documents project as the default --skills mode", () => {
  assert.match(HELP_TEXT, /--skills <mode>[\s\S]*Default: project\./);
});

test("HELP_TEXT documents yes", () => {
  assert.match(HELP_TEXT, /--yes[\s\S]*Approve setup prompts/);
});

test("runInit installs project-local skills by default", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  assert.deepEqual((await readConfig(repoRoot)).skills, PROJECT_LOCAL_SKILLS);
  await access(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "patchmill-issue-triage",
      "SKILL.md",
    ),
  );
  await access(
    join(repoRoot, ".patchmill", "skills", "writing-plans", "SKILL.md"),
  );
  await access(
    join(
      repoRoot,
      ".patchmill",
      "skills",
      "subagent-driven-development",
      "SKILL.md",
    ),
  );
  assert.match(stdout.join("\n"), /Installed project-local skills/);
  assert.match(
    stdout.join("\n"),
    /Added Patchmill local files to \.git\/info\/exclude/,
  );
  assert.match(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    /\.patchmill\npatchmill\.config\.json\n/u,
  );
  assert.match(
    stdout.join("\n"),
    /Warning: Patchmill config and skills are local-only by default/u,
  );
  assert.doesNotMatch(stdout.join("\n"), /Commit \.patchmill\/skills\//);
  assert.match(
    stdout.join("\n"),
    /Run `patchmill doctor` after completing Pi setup/,
  );
});

test("runInit preserves existing local exclude entries and does not touch gitignore", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, ".gitignore"), "node_modules\n");
  await writeFile(
    join(repoRoot, ".git", "info", "exclude"),
    "node_modules\n.patchmill\n",
  );

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      {
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  assert.equal(
    await readFile(join(repoRoot, ".gitignore"), "utf8"),
    "node_modules\n",
  );
  assert.equal(
    await readFile(join(repoRoot, ".git", "info", "exclude"), "utf8"),
    "node_modules\n.patchmill\npatchmill.config.json\n",
  );
});

test("runInit --skills none skips skill installation and omits skills config", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let installCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
      },
    ),
    0,
  );

  assert.equal(installCalled, false);
  assert.equal(Object.hasOwn(await readConfig(repoRoot), "skills"), false);
  assert.match(
    stdout.join("\n"),
    /Skipped default project-local skill installation/,
  );
});

test("runInit --skills global writes default global skill names", async () => {
  const repoRoot = await tempRepo();
  let installCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "global"],
      repoRoot,
      {
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
      },
    ),
    0,
  );

  assert.equal(installCalled, false);
  assert.deepEqual((await readConfig(repoRoot)).skills, GLOBAL_SKILLS);
});

test("runInit --skills path validates existing local skill directory", async () => {
  const repoRoot = await tempRepo();
  let validatedPath: string | undefined;
  let installCalled = false;
  const localSkills = {
    triage: "vendor/skills/patchmill-issue-triage",
    planning: "vendor/skills/writing-plans",
    implementation: "vendor/skills/subagent-driven-development",
  };

  assert.equal(
    await runInit(
      ["--skills", "path:vendor/skills"],
      repoRoot,
      {
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
        validateExistingSkillDirectory: async (validateRepoRoot, skillDir) => {
          assert.equal(validateRepoRoot, repoRoot);
          validatedPath = skillDir;
          return localSkills;
        },
      },
    ),
    0,
  );

  assert.equal(installCalled, false);
  assert.equal(validatedPath, "vendor/skills");
  assert.deepEqual((await readConfig(repoRoot)).skills, localSkills);
});

test("runInit creates config and prints next step", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
      },
    ),
    0,
  );

  assert.match(stdout.join("\n"), /Created patchmill\.config\.json/);
  assert.match(stdout.join("\n"), /provider: forgejo-tea/);
  assert.match(stdout.join("\n"), /PATCHMILL_HOST_LOGIN/);
  assert.match(
    stdout.join("\n"),
    /Run `patchmill doctor` after completing Pi setup/,
  );
  assert.match(stdout.join("\n"), /patchmill doctor/);
});

test("runInit prints missing label review and edit guidance when label setup is skipped", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let labelSetupCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
        setupLabels: async () => {
          labelSetupCalled = true;
          return {
            status: "skipped",
            missingCount: 1,
            createdCount: 0,
            message:
              "Patchmill needs these labels:\n  agent-ready — Ready for automated agent processing\n\nSkipped label creation.\nYou can edit label names in patchmill.config.json after init, then run:\n  patchmill doctor --fix",
          };
        },
      },
    ),
    0,
  );

  assert.equal(labelSetupCalled, true);
  assert.match(
    stdout.join("\n"),
    /agent-ready — Ready for automated agent processing/,
  );
  assert.match(stdout.join("\n"), /patchmill doctor --fix/);
});

test("runInit --yes approves setup-time label creation", async () => {
  const repoRoot = await tempRepo();
  let assumeYes: boolean | undefined;

  assert.equal(
    await runInit(
      ["--yes", "--skills", "none"],
      repoRoot,
      { stdout: () => undefined, stderr: () => undefined },
      {
        env: {},
        homeDir: await tempRepo(),
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        isInteractive: false,
        checkPiAvailable: async () => false,
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

test("runInit refuses existing config without installing skills", async () => {
  const repoRoot = await tempRepo();
  await writeFile(join(repoRoot, "patchmill.config.json"), "{}\n");
  const stdout: string[] = [];
  let installCalled = false;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      {
        stdout: (line) => stdout.push(line),
        stderr: () => undefined,
      },
      {
        installProjectSkills: async () => {
          installCalled = true;
          throw new Error("should not install skills");
        },
      },
    ),
    1,
  );
  assert.equal(installCalled, false);
  assert.match(stdout.join("\n"), /already exists/);
  assert.match(stdout.join("\n"), /did not overwrite/);
});

test("runInit uses Pi-reported ready configuration without launching an interactive selector", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  const prompts: string[] = [];

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 1 provider/model option with configured auth.",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        selectModelInteractively: async ({ models }) => models[0],
        runPiSmokeTest: async () => ({
          status: "pass",
          message:
            "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
          command:
            "pi --no-session --no-context-files --no-prompt-templates --model anthropic/claude-sonnet-4-5 -p Reply with PATCHMILL_PI_OK and nothing else.",
        }),
        prompt: async (question) => {
          prompts.push(question);
          return "";
        },
      },
    ),
    0,
  );

  assert.deepEqual(prompts, []);
  assert.match(stdout.join("\n"), /Pi reported 1 provider\/model option/);
  assert.match(
    stdout.join("\n"),
    /Using Pi model Anthropic \/ Claude Sonnet 4.5/,
  );
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill triage --dry-run/);
});

test("runInit does not pretend to configure Pi when readiness is missing", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let prompted = false;
  let smokeModel: string | undefined = "not-called";

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          return {
            status: "fail",
            message: "Pi could not complete the provider smoke test.",
            command: "pi smoke",
            details: "missing key",
          };
        },
        prompt: async () => {
          prompted = true;
          return "anthropic/claude-haiku-4-5";
        },
      },
    ),
    0,
  );

  assert.equal(prompted, false);
  assert.equal(smokeModel, undefined);
  assert.match(stdout.join("\n"), /Pi setup is incomplete/);
  assert.match(stdout.join("\n"), /Run `pi`, then `\/login`/);
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill doctor/);
});

test("runInit reports manual setup when missing Pi readiness is declined", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
        prompt: async () => "no",
      },
    ),
    0,
  );

  assert.match(stdout.join("\n"), /Run `pi`, then `\/login`/);
  assert.match(stdout.join("\n"), /Pi setup is incomplete/);
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill doctor/);
});

test("runInit persists selected model to local Pi settings and smoke-tests it", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let smokeModel: string | undefined;
  let smokeAgentDir: string | undefined;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 2 provider/model options with configured auth.",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
            {
              provider: "openai-codex",
              providerName: "OpenAI Codex",
              id: "gpt-5.5",
              label: "OpenAI Codex / GPT-5.5",
              value: "openai-codex/gpt-5.5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        selectModelInteractively: async ({ models }) => models[1],
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          smokeAgentDir = options.piAgentDir;
          return {
            status: "pass",
            message:
              "Pi completed the provider smoke test with openai-codex/gpt-5.5.",
            command: "pi smoke",
          };
        },
      },
    ),
    0,
  );

  assert.equal(smokeModel, "openai-codex/gpt-5.5");
  assert.equal(smokeAgentDir, join(repoRoot, ".patchmill", "pi-agent"));
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(repoRoot, ".patchmill", "pi-agent", "settings.json"),
        "utf8",
      ),
    ),
    {
      defaultProvider: "openai-codex",
      defaultModel: "gpt-5.5",
    },
  );
  assert.match(stdout.join("\n"), /Using Pi model OpenAI Codex \/ GPT-5\.5/);
});

test("runInit skips model selector and local settings when no models are available", async () => {
  const repoRoot = await tempRepo();
  let selectorCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: () => undefined, stderr: () => undefined },
      {
        isInteractive: true,
        detectPiReadiness: missingPiReadiness,
        selectModelInteractively: async () => {
          selectorCalled = true;
          return undefined;
        },
        runPiSmokeTest: failingPiSmokeTest,
      },
    ),
    0,
  );

  assert.equal(selectorCalled, false);
  await assert.rejects(
    stat(join(repoRoot, ".patchmill", "pi-agent", "settings.json")),
    /ENOENT/u,
  );
});

test("runInit runs Pi smoke test when Pi readiness is available", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let smokeModel: string | undefined;

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: false,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 1 provider/model option with configured auth.",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          return {
            status: "pass",
            message:
              "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
            command:
              "pi --no-session --no-context-files --no-prompt-templates --model anthropic/claude-sonnet-4-5 -p Reply with PATCHMILL_PI_OK and nothing else.",
          };
        },
      },
    ),
    0,
  );

  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
  assert.match(stdout.join("\n"), /Pi completed the provider smoke test/);
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill triage --dry-run/);
});

test("runInit warns about Pi registry errors while using available models", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let smokeModel: string | undefined;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: false,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 1 provider/model option with configured auth.",
          warning:
            "Pi model registry reported provider configuration issues: bad models.json",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          return {
            status: "pass",
            message:
              "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
            command: "pi smoke",
          };
        },
      },
    ),
    0,
  );

  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
  assert.match(
    stdout.join("\n"),
    /Pi model registry reported provider configuration issues: bad models\.json/,
  );
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill triage --dry-run/);
});

test("runInit keeps config but reports incomplete Pi setup when smoke test fails", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      [],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: false,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "missing",
          message: "Pi did not report any provider/model with configured auth.",
          models: [],
        }),
        runPiSmokeTest: async () => ({
          status: "fail",
          message: "Pi could not complete the provider smoke test.",
          command:
            "pi --no-session --no-context-files --no-prompt-templates -p Reply with PATCHMILL_PI_OK and nothing else.",
          details: "missing key",
        }),
      },
    ),
    0,
  );

  const output = stdout.join("\n");
  assert.match(output, /Pi setup is incomplete/);
  assert.match(output, /missing key/);
  assert.match(output, /After login, run `patchmill doctor`/);
  assert.doesNotMatch(output, /rerun `patchmill init`/);
  assert.match(output, /Next:\n {2}patchmill doctor/);
  assert.doesNotMatch(
    await readFile(join(repoRoot, "patchmill.config.json"), "utf8"),
    /missing key|sk-/u,
  );
});

test("runInit does not print manual login remediation after non-interactive ready smoke success", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: false,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 1 provider/model option with configured auth.",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        runPiSmokeTest: async () => ({
          status: "pass",
          message:
            "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
          command: "pi smoke",
        }),
      },
    ),
    0,
  );

  const output = stdout.join("\n");
  assert.doesNotMatch(output, /Run `pi`, then `\/login`/);
  assert.match(output, /Next:\n {2}patchmill triage --dry-run/);
});

test("runInit smoke-tests the default model when the interactive selector is cancelled", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  const prompts: string[] = [];
  let smokeModel: string | undefined;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        setupLabels: async () => ({
          status: "skipped",
          message: "labels skipped",
        }),
        detectPiReadiness: () => ({
          status: "ready",
          message: "Pi reported 1 provider/model option with configured auth.",
          models: [
            {
              provider: "anthropic",
              providerName: "Anthropic",
              id: "claude-sonnet-4-5",
              label: "Anthropic / Claude Sonnet 4.5",
              value: "anthropic/claude-sonnet-4-5",
              authSource: "stored",
              reasoning: true,
              input: ["text"],
            },
          ],
        }),
        selectModelInteractively: async () => undefined,
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
          return {
            status: "pass",
            message: "Pi smoke test passed.",
            command: "pi smoke",
          };
        },
        prompt: async (question) => {
          prompts.push(question);
          return "999";
        },
      },
    ),
    0,
  );

  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
  assert.deepEqual(prompts, []);
  assert.doesNotMatch(stdout.join("\n"), /Invalid Pi model selection/);
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill triage --dry-run/);
});
