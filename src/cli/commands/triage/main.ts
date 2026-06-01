#!/usr/bin/env node
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { loadPatchmillConfigState } from "../../../config/load.ts";
import { parseArgs } from "./args.ts";
import { createCommandRunner } from "./command.ts";
import { runTriage } from "./pipeline.ts";
import type { TriageResult } from "./types.ts";

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
