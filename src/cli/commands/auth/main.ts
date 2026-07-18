#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import {
  localPiAgentDir,
  readLocalPiDefaultModel,
  writeLocalPiDefaultModel,
} from "../init/pi-agent-settings.ts";
import {
  resolvePiInitSetup as defaultResolvePiInitSetup,
  type PiInitSetupResolver,
  type PiInitSetupResult,
} from "../init/pi-init-setup.ts";
import { selectModelInteractively as defaultSelectModelInteractively } from "../init/pi-model-selector.ts";
import type { SelectInteractiveModel } from "../init/pi-model-selection.ts";
import { detectPiReadiness, type PiReadiness } from "../init/pi-preflight.ts";
import { runPiSmokeTest } from "../init/pi-smoke-test.ts";

export const HELP_TEXT = `Usage:
  patchmill auth [options]

Configure or repair repo-local Pi provider authentication.

Options:
  --help, -h  Show this help and exit.
`;

export type AuthOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

type MaybePromise<T> = T | Promise<T>;

export type PiReadinessDetector = (options: {
  agentDir: string;
}) => MaybePromise<PiReadiness>;
export type PiSmokeTestRunner = typeof runPiSmokeTest;

const DEFAULT_OUTPUT: AuthOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

function selectedModel(setup: PiInitSetupResult): string | undefined {
  return setup.selection.status === "selected"
    ? `${setup.selection.provider}/${setup.selection.modelId}`
    : undefined;
}

function formatSummary(piAgentDir: string, setup: PiInitSetupResult): string {
  const messages = [
    `Pi agent directory: ${piAgentDir}`,
    setup.readiness.message,
    setup.readiness.status === "ready" ? setup.readiness.warning : undefined,
    setup.selection.message !== setup.readiness.message
      ? setup.selection.message
      : undefined,
    selectedModel(setup)
      ? `Selected model: ${selectedModel(setup)}`
      : undefined,
    "smoke" in setup ? setup.smoke.message : undefined,
    "smoke" in setup && setup.smoke.details
      ? `Details:\n${setup.smoke.details}`
      : undefined,
    setup.status === "ready"
      ? "Next:\n  patchmill doctor\n  patchmill triage"
      : undefined,
  ];
  return messages.filter(Boolean).join("\n\n");
}

export async function runAuth(
  args: string[],
  repoRoot = cwd(),
  output: AuthOutput = DEFAULT_OUTPUT,
  options: {
    detectPiReadiness?: PiReadinessDetector;
    runPiSmokeTest?: PiSmokeTestRunner;
    isInteractive?: boolean;
    selectModelInteractively?: SelectInteractiveModel;
    resolvePiInitSetup?: PiInitSetupResolver;
    readLocalPiDefaultModel?: typeof readLocalPiDefaultModel;
    persistDefaultModel?: typeof writeLocalPiDefaultModel;
  } = {},
): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    output.stdout(HELP_TEXT);
    return 0;
  }
  if (args.length > 0) {
    throw new Error(`Unknown option: ${args[0]}`);
  }

  const resolvedRepoRoot = repoRoot;
  const piAgentDir = localPiAgentDir(resolvedRepoRoot);
  const readiness = await (options.detectPiReadiness ?? detectPiReadiness)({
    agentDir: piAgentDir,
  });
  const isInteractive = options.isInteractive ?? Boolean(process.stdin.isTTY);

  if (!isInteractive && readiness.status !== "ready") {
    output.stderr(
      "Pi provider/model setup is incomplete.\nRerun `patchmill auth` in an interactive terminal to configure provider auth and select a model.",
    );
    return 1;
  }

  const currentDefault = await (
    options.readLocalPiDefaultModel ?? readLocalPiDefaultModel
  )(piAgentDir);

  const persistDefaultModel = async (
    model: Parameters<typeof writeLocalPiDefaultModel>[1],
  ) => {
    await (options.persistDefaultModel ?? writeLocalPiDefaultModel)(
      piAgentDir,
      model,
    );
  };

  const setup = await (options.resolvePiInitSetup ?? defaultResolvePiInitSetup)(
    {
      repoRoot: resolvedRepoRoot,
      piAgentDir,
      readiness,
      isInteractive,
      currentDefault,
      selectModelInteractively:
        options.selectModelInteractively ?? defaultSelectModelInteractively,
      persistDefaultModel,
      runPiSmokeTest: options.runPiSmokeTest,
      forceInteractiveSetup: true,
    },
  );

  output.stdout(formatSummary(piAgentDir, setup));
  return setup.status === "ready" ? 0 : 1;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runAuth(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
