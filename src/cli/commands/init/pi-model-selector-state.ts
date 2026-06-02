import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import type { PiModelChoice } from "./pi-preflight.ts";

const VISIBLE_ROWS = 10;

export type ModelSelectorState = {
  models: PiModelChoice[];
  filtered: PiModelChoice[];
  query: string;
  selectedIndex: number;
  current?: LocalPiDefaultModel;
};

export type VisibleModelRow = {
  model: PiModelChoice;
  selected: boolean;
  current: boolean;
};

function matchesCurrent(
  model: PiModelChoice,
  current: LocalPiDefaultModel | undefined,
): boolean {
  return current?.provider === model.provider && current.modelId === model.id;
}

function searchableText(model: PiModelChoice): string {
  return [
    model.id,
    model.provider,
    model.providerName,
    model.label,
    model.value,
  ]
    .join("\n")
    .toLowerCase();
}

function filterModels(models: PiModelChoice[], query: string): PiModelChoice[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return models;
  return models.filter((model) => searchableText(model).includes(normalized));
}

export function createModelSelectorState(
  models: PiModelChoice[],
  options: { current?: LocalPiDefaultModel; query?: string } = {},
): ModelSelectorState {
  const filtered = filterModels(models, options.query ?? "");
  const currentIndex = filtered.findIndex((model) =>
    matchesCurrent(model, options.current),
  );
  return {
    models,
    filtered,
    query: options.query ?? "",
    selectedIndex: currentIndex >= 0 ? currentIndex : 0,
    current: options.current,
  };
}

export function searchModelSelector(
  state: ModelSelectorState,
  query: string,
): ModelSelectorState {
  return createModelSelectorState(state.models, {
    current: state.current,
    query,
  });
}

export function moveModelSelection(
  state: ModelSelectorState,
  delta: number,
): ModelSelectorState {
  if (state.filtered.length === 0) return { ...state, selectedIndex: 0 };
  const next = Math.max(
    0,
    Math.min(state.filtered.length - 1, state.selectedIndex + delta),
  );
  return { ...state, selectedIndex: next };
}

export function selectedModel(
  state: ModelSelectorState,
): PiModelChoice | undefined {
  return state.filtered[state.selectedIndex];
}

export function visibleModelRows(state: ModelSelectorState): VisibleModelRow[] {
  if (state.filtered.length === 0) return [];
  const start = Math.min(
    Math.max(0, state.selectedIndex - VISIBLE_ROWS + 1),
    Math.max(0, state.filtered.length - VISIBLE_ROWS),
  );
  return state.filtered.slice(start, start + VISIBLE_ROWS).map((model) => ({
    model,
    selected: model === selectedModel(state),
    current: matchesCurrent(model, state.current),
  }));
}

export function formatModelSelectorCount(state: ModelSelectorState): string {
  if (state.filtered.length === 0) return "(0/0)";
  return `(${state.selectedIndex + 1}/${state.filtered.length})`;
}

export function modelSelectorDetails(state: ModelSelectorState): string {
  const model = selectedModel(state);
  return model
    ? `Model Name: ${model.label.split(" / ").at(-1) ?? model.id}`
    : "No matching models";
}
