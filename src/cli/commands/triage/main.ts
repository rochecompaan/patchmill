#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { parseArgs } from "./args.ts";
import { createCommandRunner } from "./command.ts";
import { runTriage } from "./pipeline.ts";
import { createTriageProgressReporter } from "./progress-output.ts";

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
  --all               Re-triage selected open issues and include issues already carrying triage or protection labels such as in-progress or blocked.
  --limit <number>    Triage only the first N selected open issues.
  --log-dir <path>    Write triage logs to a custom directory.
  --host-login <name> Use a named host login when the provider supports named logins.
  --tea-login <name>  Compatibility alias for --host-login.

Environment:
  PATCHMILL_HOST_LOGIN      Override the default host login name when supported.
`;

type Env = Record<string, string | undefined>;

function isHelpOnlyInvocation(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function commandText(args: string[]): string {
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

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const config = await loadCliConfig(args);
    if (config.showHelp) {
      console.log(HELP_TEXT);
      return 0;
    }

    const reporter = createTriageProgressReporter({
      command: commandText(args),
      writeLine: (line) => console.log(line),
    });
    const result = await runTriage(createCommandRunner(), {
      ...config,
      onProgress: reporter.onProgress,
    });
    reporter.finish(result);
    return 0;
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
