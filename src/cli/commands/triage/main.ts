#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { parseArgs } from "./args.ts";
import { createCommandRunner } from "./command.ts";
import { runTriage } from "./pipeline.ts";
import type { TriageResult } from "./types.ts";

// TODO: Remove compatibility alias for --tea-login in favor of --host-login
// TODO: Remove explicit mention of Forgejo in help text and logs to allow for broader applicability of triage command to other host providers
export const HELP_TEXT = `Usage:
  patchmill triage [options]
  npm run triage -- [options]

Automated Forgejo issue triage. Defaults to showing this help when no options are provided.
With arguments, patchmill triage executes the configured triage skill by default.
By default, only open issues without active triage or protection labels are selected.

Options:
  --help, -h          Show this help and exit.
  --dry-run, --dryrun Preview configured triage skill decisions without mutating Forgejo.
  --issue <number>    Triage one open issue by number.
  --all               Re-triage all selected open issues, including issues already carrying triage or protection labels such as in-progress or blocked.
  --limit <number>    Triage only the first N selected open issues.
  --log-dir <path>    Write triage logs to a custom directory.
  --host-login <name> Use a named host login for Forgejo issue updates.
  --tea-login <name>  Compatibility alias for --host-login.

Environment:
  PATCHMILL_HOST_LOGIN      Override the default host login name.
`;

type Env = Record<string, string | undefined>;

function isHelpOnlyInvocation(args: string[]): boolean {
  return args.length === 0 || args.includes("--help") || args.includes("-h");
}

function formatLabels(labels: string[]): string {
  return labels.length > 0 ? labels.join(", ") : "(none)";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0] ?? "";
}

export function formatResultLines(result: TriageResult): string[] {
  if (result.status === "no-issues") return [];

  return result.issues.flatMap((issue) => {
    const bucket = issue.primaryBucket ?? "unmapped";
    const lines = [
      `#${issue.issueNumber} ${bucket} ${issue.mutationStatus}`,
      `  labels: ${formatLabels(issue.previousLabels)} -> ${formatLabels(issue.finalLabels)}`,
    ];

    if (
      issue.previousState &&
      issue.finalState &&
      issue.previousState !== issue.finalState
    ) {
      lines.push(`  state: ${issue.previousState} -> ${issue.finalState}`);
    }

    if (issue.comment) {
      lines.push(`  comment: ${firstLine(issue.comment)}`);
    }

    return lines;
  });
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

    const result = await runTriage(createCommandRunner(), config);
    console.log(`agent issue triage: ${result.status}`);
    console.log(`issues: ${result.issueCount}`);
    console.log(`log: ${result.logPath}`);
    for (const line of formatResultLines(result)) {
      console.log(line);
    }
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
