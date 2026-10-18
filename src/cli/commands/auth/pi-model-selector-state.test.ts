import assert from "node:assert/strict";
import { test } from "node:test";
import type { PiModelChoice } from "./pi-preflight.ts";
import {
  createModelSelectorState,
  formatModelSelectorCount,
  modelSelectorDetails,
  moveModelSelection,
  searchModelSelector,
  visibleModelRows,
} from "./pi-model-selector-state.ts";

function model(provider: string, id: string, name = id): PiModelChoice {
  return {
    provider,
    providerName: provider === "anthropic" ? "Anthropic" : provider,
    id,
    label: `${provider} / ${name}`,
    value: `${provider}/${id}`,
    authSource: "stored",
    reasoning: id.includes("opus"),
    input: ["text"],
  };
}

const models = [
  model("openai-codex", "gpt-5.5", "GPT-5.5"),
  model("anthropic", "claude-3-5-haiku-20241022"),
  model("anthropic", "claude-3-5-haiku-latest"),
  model("anthropic", "claude-3-5-sonnet-20240620"),
  model("anthropic", "claude-3-5-sonnet-20241022"),
  model("anthropic", "claude-3-7-sonnet-20250219"),
  model("anthropic", "claude-3-haiku-20240307"),
  model("anthropic", "claude-3-opus-20240229"),
  model("anthropic", "claude-3-sonnet-20240229"),
  model("anthropic", "claude-haiku-4-5"),
  model("anthropic", "claude-opus-4-0"),
];

test("visibleModelRows returns the first ten selector rows", () => {
  const state = createModelSelectorState(models, {
    current: { provider: "openai-codex", modelId: "gpt-5.5" },
  });

  assert.equal(visibleModelRows(state).length, 10);
  assert.equal(visibleModelRows(state)[0]?.model.id, "gpt-5.5");
  assert.equal(visibleModelRows(state)[0]?.selected, true);
  assert.equal(visibleModelRows(state)[0]?.current, true);
  assert.equal(formatModelSelectorCount(state), "(1/11)");
});

test("searchModelSelector filters by model id and resets selection", () => {
  const state = searchModelSelector(createModelSelectorState(models), "opus-4");

  assert.deepEqual(
    visibleModelRows(state).map((row) => row.model.id),
    ["claude-opus-4-0"],
  );
  assert.equal(formatModelSelectorCount(state), "(1/1)");
});

test("searchModelSelector filters by provider display name", () => {
  const state = searchModelSelector(
    createModelSelectorState(models),
    "anthropic",
  );

  assert.equal(state.filtered.length, 10);
  assert.equal(state.filtered[0]?.provider, "anthropic");
});

test("moveModelSelection moves selection and keeps a ten-row window", () => {
  let state = createModelSelectorState(models);
  for (let index = 0; index < 10; index += 1) {
    state = moveModelSelection(state, 1);
  }

  assert.equal(state.selectedIndex, 10);
  assert.equal(visibleModelRows(state).length, 10);
  assert.equal(visibleModelRows(state).at(-1)?.model.id, "claude-opus-4-0");
  assert.equal(formatModelSelectorCount(state), "(11/11)");
});

test("searchModelSelector handles empty results", () => {
  const state = searchModelSelector(
    createModelSelectorState(models),
    "not-present",
  );

  assert.equal(state.filtered.length, 0);
  assert.deepEqual(visibleModelRows(state), []);
  assert.equal(formatModelSelectorCount(state), "(0/0)");
});

test("modelSelectorDetails returns Pi-like footer details", () => {
  const state = createModelSelectorState(models);

  assert.equal(modelSelectorDetails(state), "Model Name: GPT-5.5");
});
