import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { HELP_TEXT, main, runAuth } from "./main.ts";
import type { PiInitSetupResult } from "../init/pi-init-setup.ts";
import type { PiModelChoice, PiReadiness } from "../init/pi-preflight.ts";

function model(): PiModelChoice {
  return {
    provider: "anthropic",
    providerName: "Anthropic",
    id: "claude-sonnet-4-5",
    label: "Anthropic / Claude Sonnet 4.5",
    value: "anthropic/claude-sonnet-4-5",
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  };
}

function readyReadiness(): PiReadiness {
  return {
    status: "ready",
    message: "Pi reported 1 provider/model option with configured auth.",
    models: [model()],
  };
}

function missingReadiness(): PiReadiness {
  return {
    status: "missing",
    message: "Pi did not report any provider/model with configured auth.",
    models: [],
  };
}

function readySetup(): PiInitSetupResult {
  return {
    status: "ready",
    readiness: readyReadiness(),
    selection: {
      status: "selected",
      model: "anthropic/claude-sonnet-4-5",
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
    },
    smoke: {
      status: "pass",
      message:
        "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
      command: "pi smoke",
      details: "ok",
    },
  };
}

test("patchmill auth --help prints help", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(
    await runAuth(["--help"], "/repo", {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    }),
    0,
  );
  assert.deepEqual(stdout, [HELP_TEXT]);
  assert.deepEqual(stderr, []);
});

test("patchmill auth rejects unknown options", async () => {
  await assert.rejects(
    runAuth(["--unknown"], "/repo", {
      stdout: () => undefined,
      stderr: () => undefined,
    }),
    /Unknown option: --unknown/,
  );
});

test("main returns numeric exit code", async () => {
  assert.equal(typeof (await main(["--help"])), "number");
});

test("successful interactive auth prints repo-local summary and next commands", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const repoRoot = "/repo";
  let forceInteractiveSetup: boolean | undefined;

  const exitCode = await runAuth(
    [],
    repoRoot,
    {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    },
    {
      isInteractive: true,
      detectPiReadiness: () => readyReadiness(),
      readLocalPiDefaultModel: async () => undefined,
      persistDefaultModel: async () => undefined,
      resolvePiInitSetup: async (options) => {
        forceInteractiveSetup = options.forceInteractiveSetup;
        assert.equal(
          options.piAgentDir,
          join(repoRoot, ".patchmill", "pi-agent"),
        );
        return readySetup();
      },
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(forceInteractiveSetup, true);
  assert.deepEqual(stderr, []);
  assert.match(
    stdout[0] ?? "",
    /Pi agent directory: \/repo\/\.patchmill\/pi-agent/,
  );
  assert.match(stdout[0] ?? "", /Pi reported 1 provider\/model option/);
  assert.match(stdout[0] ?? "", /Selected model: anthropic\/claude-sonnet-4-5/);
  assert.match(stdout[0] ?? "", /Pi completed the provider smoke test/);
  assert.match(stdout[0] ?? "", /Details:\nok/);
  assert.match(
    stdout[0] ?? "",
    /Next:\n {2}patchmill doctor\n {2}patchmill triage/,
  );
});

test("incomplete non-interactive setup exits before prompt-capable setup", async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let setupCalled = false;

  const exitCode = await runAuth(
    [],
    "/repo",
    {
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    },
    {
      isInteractive: false,
      detectPiReadiness: () => missingReadiness(),
      resolvePiInitSetup: async () => {
        setupCalled = true;
        throw new Error("setup should not run");
      },
    },
  );

  assert.equal(exitCode, 1);
  assert.equal(setupCalled, false);
  assert.deepEqual(stdout, []);
  assert.deepEqual(stderr, [
    "Pi provider/model setup is incomplete.\nRerun `patchmill auth` in an interactive terminal to configure provider auth and select a model.",
  ]);
});

test("local Pi default model read failures are surfaced", async () => {
  await assert.rejects(
    runAuth(
      [],
      "/repo",
      {
        stdout: () => undefined,
        stderr: () => undefined,
      },
      {
        isInteractive: true,
        detectPiReadiness: () => readyReadiness(),
        readLocalPiDefaultModel: async () => {
          throw new Error("settings are malformed");
        },
        resolvePiInitSetup: async () => {
          throw new Error("setup should not run");
        },
      },
    ),
    /settings are malformed/,
  );
});

test("ready state still forces interactive setup", async () => {
  let forceInteractiveSetup: boolean | undefined;

  await runAuth(
    [],
    "/repo",
    {
      stdout: () => undefined,
      stderr: () => undefined,
    },
    {
      isInteractive: true,
      detectPiReadiness: () => readyReadiness(),
      readLocalPiDefaultModel: async () => undefined,
      persistDefaultModel: async () => undefined,
      resolvePiInitSetup: async (options) => {
        forceInteractiveSetup = options.forceInteractiveSetup;
        return readySetup();
      },
    },
  );

  assert.equal(forceInteractiveSetup, true);
});

test("cancelled setup exits 1 without workflow commands", async () => {
  const stdout: string[] = [];

  const exitCode = await runAuth(
    [],
    "/repo",
    {
      stdout: (line) => stdout.push(line),
      stderr: () => undefined,
    },
    {
      isInteractive: true,
      detectPiReadiness: () => readyReadiness(),
      readLocalPiDefaultModel: async () => undefined,
      persistDefaultModel: async () => undefined,
      resolvePiInitSetup: async () => ({
        status: "cancelled",
        readiness: readyReadiness(),
        selection: {
          status: "unavailable",
          reason: "cancelled",
          message: "Pi model selection was cancelled.",
        },
      }),
    },
  );

  assert.equal(exitCode, 1);
  assert.doesNotMatch(stdout[0] ?? "", /patchmill triage/);
});
