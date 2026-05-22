#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { parseArgs } from "./agent-issue-triage/args.ts";
import { createCommandRunner } from "./agent-issue-triage/command.ts";
import { runTriage } from "./agent-issue-triage/pipeline.ts";
import type { TriageResult } from "./agent-issue-triage/types.ts";

export const HELP_TEXT = `Usage:
  node scripts/agent-issue-triage.ts [options]
  just agent-issue-triage -- [options]

Automated Forgejo issue triage. Defaults to showing this help when no options are provided.
By default, only open issues without active triage or protection labels are classified.

Options:
  --help, -h          Show this help and exit.
  --dry-run, --dryrun Classify issues and write a log without mutating Forgejo.
  --execute           Create missing labels and apply validated triage decisions.
  --issue <number>    Triage one open issue by number.
  --all               Re-triage all selected open issues, including issues already carrying triage or protection labels such as in-progress or blocked.
  --limit <number>    Triage only the first N selected open issues.
  --log-dir <path>    Write triage logs to a custom directory.
  --tea-login <name>   Use a named tea login for Forgejo issue updates (default: triage-agent).

Environment:
  CROPRUN_TRIAGE_TEA_LOGIN  Override the default tea login name.
`;

function formatLabels(labels: string[]): string {
  return labels.length > 0 ? labels.join(", ") : "(none)";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0] ?? "";
}

export function formatResultLines(result: TriageResult): string[] {
  if (result.status !== "dry-run") return [];

  return result.issues.flatMap((issue) => {
    const lines = [
      `#${issue.issueNumber} ${issue.primaryBucket}`,
      `  labels: ${formatLabels(issue.previousLabels)} -> ${formatLabels(issue.finalLabels)}`,
    ];

    if (issue.comment) {
      lines.push(`  comment: ${firstLine(issue.comment)}`);
    }

    return lines;
  });
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  if (config.showHelp) {
    console.log(HELP_TEXT);
    return;
  }

  const result = await runTriage(createCommandRunner(), config);
  console.log(`agent issue triage: ${result.status}`);
  console.log(`issues: ${result.issueCount}`);
  console.log(`log: ${result.logPath}`);
  for (const line of formatResultLines(result)) {
    console.log(line);
  }
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
