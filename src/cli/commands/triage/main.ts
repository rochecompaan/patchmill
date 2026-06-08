#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { parseArgs } from "./args.ts";
import { createCommandRunner } from "./command.ts";
import { runTriage } from "./pipeline.ts";
import { createTriageProgressReporter } from "./progress-output.ts";
import type {
  CommandRunner,
  TriageConfig,
  TriageProgressEvent,
  TriageResult,
  TriageToolCallEvent,
} from "./types.ts";

// TODO: Remove compatibility alias for --tea-login in favor of --host-login
export const HELP_TEXT = `Usage:
  patchmill triage [options]
  npm run triage -- [options]

Automated issue triage. Runs the configured triage skill against eligible untriaged open issues by default.
By default, only open issues without active triage or protection labels are selected.
Use --dry-run to preview decisions before mutating the configured issue host.

Options:
  --help, -h          Show this help and exit.
  --dry-run, --dryrun Preview configured triage skill decisions without mutating the configured issue host.
  --issue <number>    Triage one open issue by number.
  --all               Re-triage selected open issues and include issues already carrying triage or protection labels such as in-progress.
  --limit <number>    Triage only the first N selected open issues.
  --log-dir <path>    Write triage logs to a custom directory.
  --host-login <name> Use a named host login when the provider supports named logins.
  --tea-login <name>  Compatibility alias for --host-login.

Environment:
  PATCHMILL_HOST_LOGIN      Override the default host login name when supported.
`;

type Env = Record<string, string | undefined>;

export function isHelpOnlyInvocation(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

export function commandText(args: string[]): string {
  return ["patchmill", "triage", ...args].join(" ").trim();
}

export async function loadCliConfig(
  args: string[],
  repoRoot = cwd(),
  env: Env = process.env,
) {
  if (isHelpOnlyInvocation(args)) {
    return parseArgs(args, repoRoot, env);
  }

  const { config: patchmillConfig } = await loadPatchmillConfigState(
    repoRoot,
    env,
    args,
  );
  return parseArgs(args, repoRoot, env, patchmillConfig);
}

export type TriageCliProgressReporter = {
  onProgress(event: TriageProgressEvent): void;
  onToolCall?(event: TriageToolCallEvent): void;
  finish(result: TriageResult): void;
};

export type TriageCliDependencies = {
  loadCliConfig(
    args: string[],
    repoRoot?: string,
    env?: Env,
  ): Promise<TriageConfig>;
  createCommandRunner(): CommandRunner;
  runTriage(runner: CommandRunner, config: TriageConfig): Promise<TriageResult>;
  createProgressReporter(options: {
    command: string;
    writeLine: (line: string) => void;
  }): TriageCliProgressReporter;
  writeStdout(line: string): void;
  writeStderr(line: string): void;
};

const defaultTriageCliDependencies: TriageCliDependencies = {
  loadCliConfig,
  createCommandRunner,
  runTriage,
  createProgressReporter: createTriageProgressReporter,
  writeStdout(line) {
    console.log(line);
  },
  writeStderr(line) {
    console.error(line);
  },
};

export async function main(
  args = process.argv.slice(2),
  dependencies: TriageCliDependencies = defaultTriageCliDependencies,
): Promise<number> {
  try {
    const config = await dependencies.loadCliConfig(args);
    if (config.showHelp) {
      dependencies.writeStdout(HELP_TEXT);
      return 0;
    }

    const reporter = dependencies.createProgressReporter({
      command: commandText(args),
      writeLine: dependencies.writeStdout,
    });
    const result = await dependencies.runTriage(
      dependencies.createCommandRunner(),
      {
        ...config,
        onProgress: reporter.onProgress,
        onToolCall: reporter.onToolCall,
      },
    );
    reporter.finish(result);
    return 0;
  } catch (error) {
    dependencies.writeStderr(
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  process.exitCode = await main();
}
