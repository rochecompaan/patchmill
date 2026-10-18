import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";
import { CONFIG_FILE, loadConfig } from "../../../config/config.ts";
import {
  localPiAgentDir,
  readLocalPiDefaultModel,
  writeLocalPiDefaultModel,
} from "./pi-agent-settings.ts";
import {
  resolvePiAuthSetup as defaultResolvePiAuthSetup,
  type PiAuthSetupResolver,
  type PiAuthSetupResult,
} from "./pi-auth-setup.ts";
import { selectModelInteractively as defaultSelectModelInteractively } from "./pi-model-selector.ts";
import type { SelectInteractiveModel } from "./pi-model-selection.ts";
import { detectPiReadiness, type PiReadiness } from "./pi-preflight.ts";
import type { runPiSmokeTest } from "./pi-smoke-test.ts";

export const HELP_TEXT = `Usage:
  patchmill auth [options]

Configure repo-local provider authentication and choose a default model.

Options:
  --help, -h  Show this help and exit.
`;

export type AuthOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type PiReadinessDetector = (options: {
  agentDir: string;
}) => PiReadiness | Promise<PiReadiness>;
export type PiSmokeTestRunner = typeof runPiSmokeTest;

type AuthOptions = {
  detectPiReadiness?: PiReadinessDetector;
  runPiSmokeTest?: PiSmokeTestRunner;
  isInteractive?: boolean;
  selectModelInteractively?: SelectInteractiveModel;
  resolvePiAuthSetup?: PiAuthSetupResolver;
  readLocalPiDefaultModel?: typeof readLocalPiDefaultModel;
  persistDefaultModel?: typeof writeLocalPiDefaultModel;
};

const DEFAULT_OUTPUT: AuthOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

function selectedModel(setup: PiAuthSetupResult): string | undefined {
  return setup.selection.status === "selected"
    ? `${setup.selection.provider}/${setup.selection.modelId}`
    : undefined;
}

function formatSummary(piAgentDir: string, setup: PiAuthSetupResult): string {
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
  options: AuthOptions = {},
): Promise<number> {
  if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
    output.stdout(HELP_TEXT);
    return 0;
  }
  if (args.length > 0) throw new Error(`Unknown option: ${args[0]}`);

  const resolvedRepoRoot = resolve(repoRoot);
  const piAgentDir = existsSync(join(resolvedRepoRoot, CONFIG_FILE))
    ? resolve(
        resolvedRepoRoot,
        (await loadConfig(resolvedRepoRoot)).pi.agentDir,
      )
    : localPiAgentDir(resolvedRepoRoot);
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
  const setup = await (options.resolvePiAuthSetup ?? defaultResolvePiAuthSetup)(
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

export async function main(
  args = process.argv.slice(2),
  options: AuthOptions & { repoRoot?: string; output?: AuthOutput } = {},
): Promise<number> {
  const output = options.output ?? DEFAULT_OUTPUT;
  try {
    return await runAuth(args, options.repoRoot ?? cwd(), output, options);
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
