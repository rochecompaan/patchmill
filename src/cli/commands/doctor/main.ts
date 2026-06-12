#!/usr/bin/env node
import {
  stdin as defaultStdin,
  stdout as defaultStdout,
  cwd,
} from "node:process";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createCommandRunner } from "../triage/command.ts";
import { parseArgs } from "./args.ts";
import { runDoctorChecks, type DoctorCheckResult } from "./checks.ts";
import { formatDoctorReport, hasDoctorFailures } from "./reporting.ts";
import type { CommandRunner } from "../triage/types.ts";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { createIssueHostProvider } from "../../../host/factory.ts";
import { createWorkflowApprovalPolicy } from "../../../workflow/approval-policy.ts";
import { createTriagePolicy } from "../../../policy/triage.ts";
import {
  ensureRequiredLabels,
  type LabelSetupResult,
} from "../labels/setup.ts";

export const HELP_TEXT = `Usage:
  patchmill doctor [options]

Run read-only checks for Patchmill repository readiness.

Options:
  --help, -h  Show this help and exit.
  --quiet     Suppress successful checklist output; failures still print.
  --fix       Create missing labels after approval, then rerun checks.
  --yes       Skip --fix approval prompt.
`;

export type DoctorOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type DoctorPrompt = (question: string) => Promise<string>;

export type DoctorLabelSetupOptions = {
  runner: CommandRunner;
  repoRoot: string;
  prompt: DoctorPrompt;
  isInteractive: boolean;
  assumeYes: boolean;
};

export type DoctorLabelSetup = (
  options: DoctorLabelSetupOptions,
) => Promise<LabelSetupResult>;

const DEFAULT_OUTPUT: DoctorOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: defaultStdin, output: defaultStdout });
  return rl.question(question).finally(() => rl.close());
}

async function runDoctorLabelSetup(
  options: DoctorLabelSetupOptions,
): Promise<LabelSetupResult> {
  const loaded = await loadPatchmillConfigState(
    options.repoRoot,
    process.env,
    [],
  );
  const host = createIssueHostProvider({
    runner: options.runner,
    repoRoot: options.repoRoot,
    host: loaded.config.host,
  });
  const policy = createTriagePolicy(loaded.config.labels, loaded.config.triage);
  const approvalPolicy = createWorkflowApprovalPolicy(
    loaded.config.workflow,
    loaded.config.projectPolicy,
  );

  return ensureRequiredLabels({
    host,
    policy,
    extraLabels: approvalPolicy.labelDefinitions,
    prompt: options.prompt,
    isInteractive: options.isInteractive,
    assumeYes: options.assumeYes,
    command: "doctor",
  });
}

export async function runDoctor(
  args: string[],
  repoRoot = cwd(),
  output: DoctorOutput = DEFAULT_OUTPUT,
  options: {
    runner?: CommandRunner;
    prompt?: DoctorPrompt;
    isInteractive?: boolean;
    setupLabels?: DoctorLabelSetup;
    runChecks?: (
      runner: CommandRunner,
      options: { repoRoot: string },
    ) => Promise<DoctorCheckResult[]>;
  } = {},
): Promise<number> {
  const config = parseArgs(args, repoRoot);
  if (config.showHelp) {
    output.stdout(HELP_TEXT);
    return 0;
  }

  const runner = options.runner ?? createCommandRunner();
  if (config.fix) {
    try {
      const labelSetup = await (options.setupLabels ?? runDoctorLabelSetup)({
        runner,
        repoRoot: config.repoRoot,
        prompt: options.prompt ?? defaultPrompt,
        isInteractive: options.isInteractive ?? defaultStdin.isTTY,
        assumeYes: config.yes,
      });
      output.stdout(labelSetup.message);
    } catch (error) {
      output.stdout(
        `Could not run label repair: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const results = await (options.runChecks ?? runDoctorChecks)(runner, {
    repoRoot: config.repoRoot,
  });
  const failed = hasDoctorFailures(results);
  if (!config.quiet || failed) {
    output.stdout(formatDoctorReport(results).join("\n"));
  }
  return failed ? 1 : 0;
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    return await runDoctor(args);
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
