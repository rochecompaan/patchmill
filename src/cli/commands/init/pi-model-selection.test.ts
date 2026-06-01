import assert from "node:assert/strict";
import { test } from "node:test";
import type { PiModelChoice, PiReadiness } from "./pi-preflight.ts";
import {
  selectPiModel,
  type ModelSelectionPrompt,
} from "./pi-model-selection.ts";

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

const ready: PiReadiness = {
  status: "ready",
  models: [model],
  message: "Pi reported 1 provider/model option with configured auth.",
};

function prompt(
  answers: string[],
): ModelSelectionPrompt & { questions: string[] } {
  const questions: string[] = [];
  return Object.assign(
    async (question: string) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
    { questions },
  );
}

test("selectPiModel selects first ready model without prompting in non-interactive mode", async () => {
  const ask = prompt([]);

  const result = await selectPiModel({
    readiness: ready,
    isInteractive: false,
    prompt: ask,
  });

  assert.deepEqual(result, {
    status: "selected",
    model: "anthropic/claude-sonnet-4-5",
    message: "Using Pi model Anthropic / Claude Sonnet 4.5.",
  });
  assert.deepEqual(ask.questions, []);
});

test("selectPiModel prompts for model when ready and interactive", async () => {
  const ask = prompt(["1"]);

  const result = await selectPiModel({
    readiness: ready,
    isInteractive: true,
    prompt: ask,
  });

  assert.equal(result.status, "selected");
  assert.equal(result.model, "anthropic/claude-sonnet-4-5");
  assert.equal(ask.questions.length, 1);
  assert.match(ask.questions[0] ?? "", /Select a Pi model/);
});

test("selectPiModel accepts manual provider/model input", async () => {
  const ask = prompt(["openai/gpt-4.1"]);

  const result = await selectPiModel({
    readiness: ready,
    isInteractive: true,
    prompt: ask,
  });

  assert.deepEqual(result, {
    status: "selected",
    model: "openai/gpt-4.1",
    message: "Using manually entered Pi model openai/gpt-4.1.",
  });
});

test("selectPiModel rejects invalid interactive model input", async () => {
  const ask = prompt(["999"]);

  const result = await selectPiModel({
    readiness: ready,
    isInteractive: true,
    prompt: ask,
  });

  assert.deepEqual(result, {
    status: "unavailable",
    reason: "invalid-selection",
    message:
      "Invalid Pi model selection: 999. Enter a listed number or provider/model.",
  });
});

test("selectPiModel does not fabricate a model when readiness is missing", async () => {
  const result = await selectPiModel({
    readiness: {
      status: "missing",
      models: [],
      message: "Pi did not report any provider/model with configured auth.",
    },
    isInteractive: true,
    prompt: prompt(["anthropic/claude-haiku-4-5"]),
  });

  assert.deepEqual(result, {
    status: "unavailable",
    reason: "not-ready",
    message: "Pi did not report any provider/model with configured auth.",
  });
});
