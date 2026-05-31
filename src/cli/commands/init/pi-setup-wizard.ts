import { formatPiModelLabel, type PiReadiness } from "./pi-preflight.ts";

export type SetupPrompt = (question: string) => Promise<string>;

export type PiSetupWizardResult =
  | { status: "selected"; model: string; message: string }
  | { status: "manual"; message: string };

const MANUAL_SETUP = [
  "Run `pi`, then `/login` to configure a provider using Pi's native login flow.",
  "After login, rerun `patchmill init` or `patchmill doctor`.",
].join("\n");

function isYes(value: string): boolean {
  return /^(|y|yes)$/iu.test(value.trim());
}

function isNo(value: string): boolean {
  return /^(n|no)$/iu.test(value.trim());
}

function isModelValue(value: string): boolean {
  return /^[^\s/]+\/.+$/u.test(value.trim());
}

function modelMenu(readiness: PiReadiness): string {
  if (readiness.models.length === 0) return "";
  return readiness.models
    .map(
      (model, index) =>
        `  ${index + 1}. ${formatPiModelLabel(model)} (${model.value})`,
    )
    .join("\n");
}

export async function runPiSetupWizard(options: {
  readiness: PiReadiness;
  isInteractive: boolean;
  assumeYes: boolean;
  prompt: SetupPrompt;
}): Promise<PiSetupWizardResult> {
  if (!options.isInteractive) {
    return { status: "manual", message: MANUAL_SETUP };
  }

  if (options.assumeYes && options.readiness.status !== "ready") {
    return {
      status: "manual",
      message: `--yes does not choose or create Pi credentials.\n${MANUAL_SETUP}`,
    };
  }

  if (options.readiness.status === "ready") {
    const useExisting = await options.prompt(
      `${options.readiness.message}\nUse existing Pi provider/model configuration? [Y/n] `,
    );
    if (isNo(useExisting)) {
      return {
        status: "manual",
        message: `Pi setup was left unchanged.\n${MANUAL_SETUP}`,
      };
    }

    const menu = modelMenu(options.readiness);
    const answer = await options.prompt(
      `Select a Pi model for the smoke test:\n${menu}\nChoose 1-${options.readiness.models.length} or enter provider/model [1]: `,
    );
    const trimmed = answer.trim();
    const index = trimmed === "" ? 0 : Number.parseInt(trimmed, 10) - 1;
    const selected = Number.isInteger(index)
      ? options.readiness.models[index]
      : undefined;
    if (selected) {
      return {
        status: "selected",
        model: selected.value,
        message: `Using Pi model ${formatPiModelLabel(selected)}.`,
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
      status: "selected",
      model: options.readiness.models[0]?.value ?? "",
      message: `Using Pi model ${formatPiModelLabel(options.readiness.models[0]!)}.`,
    };
  }

  const configure = await options.prompt(
    `${options.readiness.message}\nConfigure Pi now using Pi's native /login flow, then enter a provider/model for the smoke test? [y/N] `,
  );
  if (!isYes(configure)) {
    return { status: "manual", message: MANUAL_SETUP };
  }

  const model = await options.prompt(
    "After completing `pi` + `/login`, enter the Pi model as provider/model, or press Enter for manual setup instructions: ",
  );
  const trimmed = model.trim();
  if (isModelValue(trimmed)) {
    return {
      status: "selected",
      model: trimmed,
      message: `Using manually entered Pi model ${trimmed}.`,
    };
  }

  return { status: "manual", message: MANUAL_SETUP };
}
