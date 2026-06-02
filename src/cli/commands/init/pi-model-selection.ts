import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import type { selectModelInteractively } from "./pi-model-selector.ts";
import {
  formatPiModelLabel,
  type PiModelChoice,
  type PiReadiness,
} from "./pi-preflight.ts";

export type PiModelSelection =
  | {
      status: "selected";
      model: string;
      provider: string;
      modelId: string;
      message: string;
    }
  | {
      status: "unavailable";
      reason: "not-ready" | "invalid-selection";
      message: string;
    };

export type SelectInteractiveModel = typeof selectModelInteractively;
export type PersistDefaultModel = (
  selection: LocalPiDefaultModel,
) => Promise<void>;

function selectedMessage(model: { label: string; value: string }): string {
  return `Using Pi model ${model.label}.`;
}

function toSelection(
  model: PiModelChoice,
): Extract<PiModelSelection, { status: "selected" }> {
  return {
    status: "selected",
    model: model.value,
    provider: model.provider,
    modelId: model.id,
    message: selectedMessage(model),
  };
}

function findCurrentDefault(
  models: PiModelChoice[],
  current: LocalPiDefaultModel | undefined,
): PiModelChoice | undefined {
  return current
    ? models.find(
        (model) =>
          model.provider === current.provider && model.id === current.modelId,
      )
    : undefined;
}

function canonicalizeSelection(
  models: PiModelChoice[],
  selection: PiModelChoice | undefined,
): PiModelChoice | undefined {
  if (!selection) return undefined;

  return (
    models.find((model) => model.value === selection.value) ??
    models.find(
      (model) =>
        model.provider === selection.provider && model.id === selection.id,
    )
  );
}

function invalidSelection(
  selection: PiModelChoice,
): Extract<PiModelSelection, { status: "unavailable" }> {
  return {
    status: "unavailable",
    reason: "invalid-selection",
    message: `Invalid Pi model selection: ${selection.value}`,
  };
}

async function persistSelection(
  persistDefaultModel: PersistDefaultModel | undefined,
  model: PiModelChoice,
): Promise<void> {
  await persistDefaultModel?.({ provider: model.provider, modelId: model.id });
}

export async function selectPiModel(options: {
  readiness: PiReadiness;
  isInteractive: boolean;
  currentDefault?: LocalPiDefaultModel;
  selectModelInteractively?: SelectInteractiveModel;
  persistDefaultModel?: PersistDefaultModel;
}): Promise<PiModelSelection> {
  if (options.readiness.status !== "ready") {
    return {
      status: "unavailable",
      reason: "not-ready",
      message: options.readiness.message,
    };
  }

  const first = options.readiness.models[0];
  if (!first) {
    return {
      status: "unavailable",
      reason: "not-ready",
      message: "Pi did not report any provider/model with configured auth.",
    };
  }

  const current = findCurrentDefault(
    options.readiness.models,
    options.currentDefault,
  );

  let selected: PiModelChoice | undefined;
  if (options.isInteractive && options.selectModelInteractively) {
    const interactiveSelection = await options.selectModelInteractively({
      models: options.readiness.models,
      current: options.currentDefault,
    });
    if (interactiveSelection) {
      selected = canonicalizeSelection(
        options.readiness.models,
        interactiveSelection,
      );
      if (!selected) return invalidSelection(interactiveSelection);
    }
  }

  const resolved = selected ?? current ?? first;

  await persistSelection(options.persistDefaultModel, resolved);
  return toSelection({
    ...resolved,
    label: formatPiModelLabel(resolved),
  });
}
