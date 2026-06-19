import { createCommandRunner } from "../triage/command.ts";
import type { LocalPiDefaultModel } from "./pi-agent-settings.ts";
import { setupPiInteractively as defaultSetupPiInteractively } from "./pi-auth-flow.ts";
import {
  selectPiModel,
  type PersistDefaultModel,
  type PiModelSelection,
  type SelectInteractiveModel,
} from "./pi-model-selection.ts";
import type { PiReadiness } from "./pi-preflight.ts";
import { runPiSmokeTest, type PiSmokeTestResult } from "./pi-smoke-test.ts";

export type InteractivePiSetup = (options: {
  repoRoot: string;
  agentDir: string;
  currentDefault: LocalPiDefaultModel | undefined;
  initialReadiness: PiReadiness;
  selectModelInteractively?: SelectInteractiveModel;
  persistDefaultModel?: PersistDefaultModel;
}) => Promise<{
  readiness: PiReadiness;
  selection: PiModelSelection;
}>;

export type PiInitSetupResult =
  | {
      status: "ready";
      readiness: PiReadiness;
      selection: PiModelSelection;
      smoke: PiSmokeTestResult;
    }
  | {
      status: "incomplete";
      readiness: PiReadiness;
      selection: PiModelSelection;
      smoke: PiSmokeTestResult;
    }
  | {
      status: "cancelled";
      readiness: PiReadiness;
      selection: Extract<PiModelSelection, { status: "unavailable" }>;
    }
  | {
      status: "invalid";
      readiness: PiReadiness;
      selection: Extract<PiModelSelection, { status: "unavailable" }>;
    };

type PiSmokeTestRunner = typeof runPiSmokeTest;

function selectedModelFromReadiness(
  readiness: PiReadiness,
): string | undefined {
  return readiness.status === "ready" ? readiness.models[0]?.value : undefined;
}

function abortingSelectionStatus(
  selection: PiModelSelection,
): "cancelled" | "invalid" | undefined {
  if (selection.status === "selected") return undefined;
  if (selection.reason === "cancelled") return "cancelled";
  if (selection.reason === "invalid-selection") return "invalid";
  return undefined;
}

export const setupPiInteractively: InteractivePiSetup =
  defaultSetupPiInteractively;

export async function resolvePiInitSetup(options: {
  repoRoot: string;
  piAgentDir: string;
  readiness: PiReadiness;
  isInteractive: boolean;
  currentDefault?: LocalPiDefaultModel;
  selectModelInteractively?: SelectInteractiveModel;
  persistDefaultModel?: PersistDefaultModel;
  setupPiInteractively?: InteractivePiSetup;
  runPiSmokeTest?: PiSmokeTestRunner;
  forceInteractiveSetup?: boolean;
}): Promise<PiInitSetupResult> {
  const interactiveSetup = options.setupPiInteractively ?? setupPiInteractively;
  let readiness = options.readiness;
  let selection: PiModelSelection;

  if (
    options.isInteractive &&
    (readiness.status !== "ready" || options.forceInteractiveSetup === true)
  ) {
    const setup = await interactiveSetup({
      repoRoot: options.repoRoot,
      agentDir: options.piAgentDir,
      currentDefault: options.currentDefault,
      initialReadiness: readiness,
      selectModelInteractively: options.selectModelInteractively,
      persistDefaultModel: options.persistDefaultModel,
    });
    readiness = setup.readiness;
    selection = setup.selection;
  } else {
    selection = await selectPiModel({
      readiness,
      isInteractive: options.isInteractive,
      currentDefault: options.currentDefault,
      selectModelInteractively: options.selectModelInteractively,
      persistDefaultModel: options.persistDefaultModel,
    });
  }

  const abortStatus = abortingSelectionStatus(selection);
  if (abortStatus) {
    return { status: abortStatus, readiness, selection };
  }

  const smoke = await (options.runPiSmokeTest ?? runPiSmokeTest)(
    createCommandRunner(),
    {
      repoRoot: options.repoRoot,
      piAgentDir: options.piAgentDir,
      model:
        selection.status === "selected"
          ? selection.model
          : selectedModelFromReadiness(readiness),
    },
  );

  return {
    status: smoke.status === "pass" ? "ready" : "incomplete",
    readiness,
    selection,
    smoke,
  };
}

export type PiInitSetupResolver = typeof resolvePiInitSetup;
