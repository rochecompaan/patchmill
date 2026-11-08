import { resolve } from "node:path";
import { loadConfig } from "../../../config/config.ts";
import {
  STATE_DIR,
  StateStore,
  type WorkflowStatus,
} from "../../../state/store.ts";
import type { CliOutput } from "../../main.ts";

const HELP = `Usage: patchmill status [--all | --issue N]
Show local workflow state without syncing. Closed issues are hidden unless --all is passed.`;

const GROUP_ORDER: WorkflowStatus[] = [
  "inProgress",
  "needsInfo",
  "ready",
  "done",
  "unsuitable",
];

type Options = { repoRoot?: string; output?: CliOutput };

export async function main(
  args: string[] = process.argv.slice(2),
  options: Options = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!)) {
    output.stdout(HELP);
    return 0;
  }
  const showAll = args.length === 1 && args[0] === "--all";
  const showIssue =
    args.length === 2 &&
    args[0] === "--issue" &&
    /^[1-9]\d*$/.test(args[1]!) &&
    Number.isSafeInteger(Number(args[1]));
  if (args.length !== 0 && !showAll && !showIssue) {
    output.stderr(
      "Use no arguments, --all, or --issue N with a positive integer issue number.",
    );
    output.stderr(HELP);
    return 1;
  }
  try {
    const repoRoot = options.repoRoot ?? process.cwd();
    const config = await loadConfig(repoRoot);
    if (config.workflow.stateTracking !== "local") {
      output.stderr(
        'patchmill status requires workflow.stateTracking "local".',
      );
      return 1;
    }
    const store = new StateStore(resolve(repoRoot, STATE_DIR), (message) =>
      output.stderr(`Warning: ${message}`),
    );
    if (showIssue) {
      const n = Number(args[1]);
      const issue = await store.readIssue(n);
      if (!issue) {
        output.stderr(
          `Issue #${n} is not in local state. Run patchmill triage to sync it.`,
        );
        return 1;
      }
      const changes = await store.readStatus(n);
      output.stdout(`#${n} ${issue.title}`);
      output.stdout(`State: ${issue.state}`);
      output.stdout(`Status: ${changes.at(-1)?.status ?? "untriaged"}`);
      if (changes.length === 0) output.stdout("No status changes.");
      for (const change of changes) {
        output.stdout(`${change.at} ${change.status}`);
        if (change.runId !== undefined) output.stdout(`  run: ${change.runId}`);
        if (change.summary !== undefined)
          output.stdout(`  summary: ${change.summary}`);
        if (change.cost !== undefined) output.stdout(`  cost: ${change.cost}`);
        for (const warning of change.warnings ?? [])
          output.stdout(`  warning: ${warning}`);
        if (change.questionUrl !== undefined)
          output.stdout(`  question: ${change.questionUrl}`);
      }
      return 0;
    }
    const cursor = await store.readCursor();
    output.stdout(
      cursor ? `Synced up to ${cursor.syncedUpTo}` : "Not synced yet.",
    );
    const { issues, damaged } = await store.listIssues();
    for (const n of damaged)
      output.stderr(`Warning: damaged issue copy ${store.issuePath(n)}`);
    const groups = new Map<WorkflowStatus, string[]>();
    for (const issue of issues) {
      if (!showAll && issue.state === "closed") continue;
      const last = (await store.readStatus(issue.number)).at(-1);
      if (!last) continue;
      const rows = groups.get(last.status) ?? [];
      rows.push(`  #${issue.number} ${issue.title} (${last.at})`);
      groups.set(last.status, rows);
    }
    if (groups.size === 0)
      output.stdout("No issues with local workflow state.");
    for (const status of GROUP_ORDER) {
      const rows = groups.get(status);
      if (!rows) continue;
      output.stdout(status);
      for (const row of rows) output.stdout(row);
    }
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
