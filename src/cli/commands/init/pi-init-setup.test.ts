import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePiInitSetup } from "./pi-init-setup.ts";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";

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

test("resolvePiInitSetup returns cancelled without running a fake smoke test", async () => {
  let smokeCalled = false;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: readyReadiness(),
    isInteractive: true,
    selectModelInteractively: async () => undefined,
    runPiSmokeTest: async () => {
      smokeCalled = true;
      throw new Error("smoke should not run");
    },
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.selection.status, "unavailable");
  assert.equal(result.selection.reason, "cancelled");
  assert.equal(smokeCalled, false);
});

test("resolvePiInitSetup returns invalid without running a fake smoke test", async () => {
  let smokeCalled = false;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: readyReadiness(),
    isInteractive: true,
    selectModelInteractively: async () => ({
      ...model(),
      value: "unknown/model",
      provider: "unknown",
      id: "model",
    }),
    runPiSmokeTest: async () => {
      smokeCalled = true;
      throw new Error("smoke should not run");
    },
  });

  assert.equal(result.status, "invalid");
  assert.equal(result.selection.status, "unavailable");
  assert.equal(result.selection.reason, "invalid-selection");
  assert.equal(smokeCalled, false);
});

test("resolvePiInitSetup selects model without interactive setup when ready and force is false", async () => {
  let setupCalled = false;
  let selected = false;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: readyReadiness(),
    isInteractive: false,
    setupPiInteractively: async () => {
      setupCalled = true;
      throw new Error("setup should not run");
    },
    selectModelInteractively: async () => {
      selected = true;
      return model();
    },
    runPiSmokeTest: async (_runner, options) => ({
      status: "pass",
      message: `smoke ${options.model}`,
      command: "pi smoke",
    }),
  });

  assert.equal(result.status, "ready");
  assert.equal(setupCalled, false);
  assert.equal(selected, false);
  assert.equal(result.selection.status, "selected");
});

test("resolvePiInitSetup forces interactive setup when readiness is already ready", async () => {
  let setupCalled = false;
  let smokeModel: string | undefined;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: readyReadiness(),
    isInteractive: true,
    forceInteractiveSetup: true,
    setupPiInteractively: async ({ agentDir, initialReadiness }) => {
      setupCalled = true;
      assert.equal(agentDir, "/repo/.patchmill/pi-agent");
      assert.equal(initialReadiness.status, "ready");
      return {
        readiness: readyReadiness(),
        selection: {
          status: "selected",
          model: "anthropic/claude-sonnet-4-5",
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
        },
      };
    },
    runPiSmokeTest: async (_runner, options) => {
      smokeModel = options.model;
      return {
        status: "pass",
        message:
          "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
        command: "pi smoke",
      };
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(setupCalled, true);
  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
});

test("resolvePiInitSetup uses canonical interactive setup when readiness is missing", async () => {
  let setupAgentDir: string | undefined;
  let smokeModel: string | undefined;

  const result = await resolvePiInitSetup({
    repoRoot: "/repo",
    piAgentDir: "/repo/.patchmill/pi-agent",
    readiness: missingReadiness(),
    isInteractive: true,
    setupPiInteractively: async ({ agentDir }) => {
      setupAgentDir = agentDir;
      return {
        readiness: readyReadiness(),
        selection: {
          status: "selected",
          model: "anthropic/claude-sonnet-4-5",
          provider: "anthropic",
          modelId: "claude-sonnet-4-5",
          message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
        },
      };
    },
    runPiSmokeTest: async (_runner, options) => {
      smokeModel = options.model;
      return {
        status: "pass",
        message:
          "Pi completed the provider smoke test with anthropic/claude-sonnet-4-5.",
        command: "pi smoke",
      };
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(setupAgentDir, "/repo/.patchmill/pi-agent");
  assert.equal(smokeModel, "anthropic/claude-sonnet-4-5");
});
