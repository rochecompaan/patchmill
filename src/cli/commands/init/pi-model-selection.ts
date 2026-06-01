import { formatPiModelLabel, type PiReadiness } from "./pi-preflight.ts";

export type ModelSelectionPrompt = (question: string) => Promise<string>;

export type PiModelSelection =
  | { status: "selected"; model: string; message: string }
  | {
      status: "unavailable";
      reason: "not-ready" | "invalid-selection";
      message: string;
    };

function isModelValue(value: string): boolean {
  return /^[^\s/]+\/.+$/u.test(value.trim());
}

function modelMenu(
  readiness: Extract<PiReadiness, { status: "ready" }>,
): string {
  return readiness.models
    .map(
      (model, index) =>
        `  ${index + 1}. ${formatPiModelLabel(model)} (${model.value})`,
    )
    .join("\n");
}

function selectedMessage(model: { label: string; value: string }): string {
  return `Using Pi model ${model.label}.`;
}

export async function selectPiModel(options: {
  readiness: PiReadiness;
  isInteractive: boolean;
  prompt: ModelSelectionPrompt;
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

  if (!options.isInteractive) {
    return {
      status: "selected",
      model: first.value,
      message: selectedMessage(first),
    };
  }

  const menu = modelMenu(options.readiness);
  const answer = await options.prompt(
    `Select a Pi model for the smoke test:\n${menu}\nChoose 1-${options.readiness.models.length} or enter provider/model [1]: `,
  );
  const trimmed = answer.trim();
  if (trimmed === "") {
    return {
      status: "selected",
      model: first.value,
      message: selectedMessage(first),
    };
  }

  const index = Number.parseInt(trimmed, 10) - 1;
  const selected = /^\d+$/u.test(trimmed)
    ? options.readiness.models[index]
    : undefined;
  if (selected) {
    return {
      status: "selected",
      model: selected.value,
      message: selectedMessage(selected),
    };
  }

  if (isModelValue(trimmed)) {
    return {
      status: "selected",
      model: trimmed,
      message: `Using manually entered Pi model ${trimmed}.`,
    };
  }

  return {
    status: "unavailable",
    reason: "invalid-selection",
    message: `Invalid Pi model selection: ${trimmed}. Enter a listed number or provider/model.`,
  };
}
