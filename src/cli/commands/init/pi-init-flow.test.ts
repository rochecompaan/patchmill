import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInit } from "./main.ts";
import { resolvePiInitSetup } from "./pi-init-setup.ts";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";

async function tempRepo(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "patchmill-init-pi-"));
  await mkdir(join(repoRoot, ".git", "info"), { recursive: true });
  return repoRoot;
}

function model(
  provider: string,
  providerName: string,
  id: string,
  name: string,
): PiModelChoice {
  return {
    provider,
    providerName,
    id,
    label: `${providerName} / ${name}`,
    value: `${provider}/${id}`,
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  };
}

function anthropicModel(): PiModelChoice {
  return model(
    "anthropic",
    "Anthropic",
    "claude-sonnet-4-5",
    "Claude Sonnet 4.5",
  );
}

function codexModel(): PiModelChoice {
  return model("openai-codex", "OpenAI Codex", "gpt-5.5", "GPT-5.5");
}

function readyReadiness(
  models: [PiModelChoice, ...PiModelChoice[]],
  warning?: string,
): PiReadiness {
  return {
    status: "ready",
    message: `Pi reported ${models.length} provider/model option${
      models.length === 1 ? "" : "s"
    } with configured auth.`,
    models,
    ...(warning ? { warning } : {}),
  };
}

function missingPiReadiness(): PiReadiness {
  return {
    status: "missing",
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

async function skippedLabels() {
  return {
    status: "skipped" as const,
    message: "labels skipped",
  };
}

test("runInit uses Pi-reported ready configuration without launching a prompt selector", async () => {
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
        detectPiReadiness: () => readyReadiness([anthropicModel()]),
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

test("runInit starts Patchmill-owned interactive Pi setup when readiness is missing", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let setupAgentDir: string | undefined;
  let smokeModel: string | undefined;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        detectPiReadiness: missingPiReadiness,
        resolvePiInitSetup: (setupOptions) =>
          resolvePiInitSetup({
            ...setupOptions,
            setupPiInteractively: async ({ agentDir }) => {
              setupAgentDir = agentDir;
              return {
                readiness: readyReadiness([anthropicModel()]),
                selection: {
                  status: "selected",
                  model: "anthropic/claude-sonnet-4-5",
                  provider: "anthropic",
                  modelId: "claude-sonnet-4-5",
                  message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
                },
              };
            },
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

  assert.equal(setupAgentDir, join(repoRoot, ".patchmill", "pi-agent"));
  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
  assert.doesNotMatch(stdout.join("\n"), /Run `pi`, then `\/login`/);
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill triage --dry-run/);
});

test("runInit reports Patchmill setup guidance when Pi readiness remains missing", async () => {
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

  assert.doesNotMatch(stdout.join("\n"), /Run `pi`, then `\/login`/);
  assert.match(stdout.join("\n"), /Pi provider\/model setup is incomplete/);
  assert.match(
    stdout.join("\n"),
    /Run `patchmill init` in an interactive terminal to configure provider auth and select a model/,
  );
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
        setupLabels: skippedLabels,
        detectPiReadiness: () =>
          readyReadiness([anthropicModel(), codexModel()]),
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

test("runInit warns when saving the selected model to local Pi settings fails", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  let smokeModel: string | undefined;
  const agentDir = join(repoRoot, ".patchmill", "pi-agent");
  const settingsPath = join(agentDir, "settings.json");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    settingsPath,
    `${JSON.stringify(
      {
        defaultProvider: "anthropic",
        defaultModel: "claude-sonnet-4-5",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        setupLabels: skippedLabels,
        detectPiReadiness: () =>
          readyReadiness([anthropicModel(), codexModel()]),
        selectModelInteractively: async ({ models }) => {
          await rm(agentDir, { recursive: true, force: true });
          await writeFile(agentDir, "not a directory", "utf8");
          return models[1];
        },
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
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

  const output = stdout.join("\n");
  assert.equal(smokeModel, "openai-codex/gpt-5.5");
  assert.match(
    output,
    /Could not save local Pi default model: Could not parse local Pi settings:/,
  );
  assert.ok(
    output.indexOf("Could not save local Pi default model:") <
      output.indexOf("Using Pi model OpenAI Codex / GPT-5.5."),
  );
  assert.match(output, /Using Pi model OpenAI Codex \/ GPT-5\.5/);
  assert.match(
    output,
    /Pi completed the provider smoke test with openai-codex\/gpt-5\.5\./,
  );
  assert.equal(await readFile(agentDir, "utf8"), "not a directory");
});

test("runInit warns and preserves invalid local Pi settings while using a ready model", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  const invalidSettings = "{not json";
  let smokeModel: string | undefined;
  const settingsPath = join(
    repoRoot,
    ".patchmill",
    "pi-agent",
    "settings.json",
  );
  await mkdir(join(repoRoot, ".patchmill", "pi-agent"), { recursive: true });
  await writeFile(settingsPath, invalidSettings, "utf8");

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        setupLabels: skippedLabels,
        detectPiReadiness: () =>
          readyReadiness([anthropicModel(), codexModel()]),
        selectModelInteractively: async ({ models }) => models[1],
        runPiSmokeTest: async (_runner, options) => {
          smokeModel = options.model;
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

  const output = stdout.join("\n");
  assert.equal(smokeModel, "openai-codex/gpt-5.5");
  assert.match(
    output,
    /Could not read local Pi settings: Could not parse local Pi settings:/,
  );
  assert.match(
    output,
    /Could not read local Pi settings:[\s\S]*Pi reported 2 provider\/model options with configured auth\./,
  );
  assert.match(output, /Using Pi model OpenAI Codex \/ GPT-5\.5/);
  assert.equal(await readFile(settingsPath, "utf8"), invalidSettings);
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
        setupLabels: skippedLabels,
        detectPiReadiness: () => readyReadiness([anthropicModel()]),
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
        setupLabels: skippedLabels,
        detectPiReadiness: () =>
          readyReadiness(
            [anthropicModel()],
            "Pi model registry reported provider configuration issues: bad models.json",
          ),
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
        setupLabels: skippedLabels,
        detectPiReadiness: missingPiReadiness,
        runPiSmokeTest: failingPiSmokeTest,
      },
    ),
    0,
  );

  const output = stdout.join("\n");
  assert.match(output, /Pi provider\/model setup is incomplete/);
  assert.match(output, /missing key/);
  assert.match(output, /After setup, run `patchmill doctor`/);
  assert.match(
    output,
    /Run `patchmill init` in an interactive terminal to configure provider auth and select a model/,
  );
  assert.doesNotMatch(output, /Run `pi`, then `\/login`/);
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
        setupLabels: skippedLabels,
        detectPiReadiness: () => readyReadiness([anthropicModel()]),
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

test("runInit aborts when the required interactive model selector is cancelled", async () => {
  const repoRoot = await tempRepo();
  const stdout: string[] = [];
  const prompts: string[] = [];
  let smokeCalled = false;

  assert.equal(
    await runInit(
      ["--skills", "none"],
      repoRoot,
      { stdout: (line) => stdout.push(line), stderr: () => undefined },
      {
        isInteractive: true,
        setupLabels: skippedLabels,
        detectPiReadiness: () => readyReadiness([anthropicModel()]),
        selectModelInteractively: async () => undefined,
        runPiSmokeTest: async () => {
          smokeCalled = true;
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
    1,
  );

  assert.equal(smokeCalled, false);
  assert.deepEqual(prompts, []);
  assert.match(stdout.join("\n"), /Pi model selection was cancelled/);
  assert.match(stdout.join("\n"), /Next:\n {2}patchmill doctor/);
});
