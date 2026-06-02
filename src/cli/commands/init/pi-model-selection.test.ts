import assert from "node:assert/strict";
import { test } from "node:test";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";
import { selectPiModel } from "./pi-model-selection.ts";

const model: PiModelChoice = {
  provider: "anthropic",
  providerName: "Anthropic",
  id: "claude-sonnet-4-5",
  label: "Anthropic / Claude Sonnet 4.5",
  value: "anthropic/claude-sonnet-4-5",
  authSource: "stored",
  reasoning: true,
  input: ["text"],
};

function secondModel(): PiModelChoice {
  return {
    provider: "openai-codex",
    providerName: "OpenAI Codex",
    id: "gpt-5.5",
    label: "OpenAI Codex / GPT-5.5",
    value: "openai-codex/gpt-5.5",
    authSource: "stored",
    reasoning: true,
    input: ["text"],
  };
}

const twoReady: PiReadiness = {
  status: "ready",
  models: [model, secondModel()],
  message: "Pi reported 2 provider/model options with configured auth.",
};

test("selectPiModel uses the interactive selector and persists the selected model", async () => {
  const persisted: Array<{ provider: string; modelId: string }> = [];

  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    currentDefault: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
    selectModelInteractively: async () => secondModel(),
    persistDefaultModel: async (selection) => {
      persisted.push(selection);
    },
  });

  assert.deepEqual(result, {
    status: "selected",
    model: "openai-codex/gpt-5.5",
    provider: "openai-codex",
    modelId: "gpt-5.5",
    message: "Using Pi model OpenAI Codex / GPT-5.5.",
  });
  assert.deepEqual(persisted, [
    { provider: "openai-codex", modelId: "gpt-5.5" },
  ]);
});

test("selectPiModel falls back to current default when selector is cancelled", async () => {
  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    currentDefault: { provider: "openai-codex", modelId: "gpt-5.5" },
    selectModelInteractively: async () => undefined,
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "openai-codex/gpt-5.5");
});

test("selectPiModel falls back deterministically without an interactive selector callback", async () => {
  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    currentDefault: { provider: "openai-codex", modelId: "gpt-5.5" },
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "openai-codex/gpt-5.5");
});

test("selectPiModel falls back to first model without an interactive selector callback", async () => {
  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "anthropic/claude-sonnet-4-5");
});

test("selectPiModel falls back to first model when selector is cancelled without a current default", async () => {
  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    selectModelInteractively: async () => undefined,
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "anthropic/claude-sonnet-4-5");
});

test("selectPiModel rejects and does not persist an unknown interactive selection", async () => {
  const persisted: Array<{ provider: string; modelId: string }> = [];

  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: true,
    selectModelInteractively: async () => ({
      provider: "unknown",
      providerName: "Unknown",
      id: "not-ready",
      label: "Unknown / Not Ready",
      value: "unknown/not-ready",
      authSource: "stored",
      reasoning: false,
      input: ["text"],
    }),
    persistDefaultModel: async (selection) => {
      persisted.push(selection);
    },
  });

  assert.deepEqual(result, {
    status: "unavailable",
    reason: "invalid-selection",
    message: "Invalid Pi model selection: unknown/not-ready",
  });
  assert.deepEqual(persisted, []);
});

test("selectPiModel persists deterministic non-interactive selection", async () => {
  const persisted: Array<{ provider: string; modelId: string }> = [];

  const result = await selectPiModel({
    readiness: twoReady,
    isInteractive: false,
    persistDefaultModel: async (selection) => {
      persisted.push(selection);
    },
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "anthropic/claude-sonnet-4-5");
  assert.deepEqual(persisted, [
    { provider: "anthropic", modelId: "claude-sonnet-4-5" },
  ]);
});

test("selectPiModel does not fabricate a model when readiness is missing", async () => {
  const result = await selectPiModel({
    readiness: {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    },
    isInteractive: true,
  });

  assert.deepEqual(result, {
    status: "unavailable",
    reason: "not-ready",
    message: "Pi did not report any provider/model with configured auth.",
  });
});
