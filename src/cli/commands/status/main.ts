import { resolve } from "node:path";
import { loadConfig } from "../../../config/config.ts";
import { STATE_DIR, StateStore } from "../../../state/store.ts";
import { createHost } from "../../../host/factory.ts";
import { runCommand } from "../../../process/command.ts";
import { readBlockers, type BlockerHost } from "./blockers.ts";
import { formatter, type StatusRow } from "./format.ts";
import type { CliOutput } from "../../main.ts";

const HELP = `Usage: patchmill status [--all | --issue N]
Show local workflow state. Blockers of ready and in-progress issues are read live from the issue tracker. Closed issues are hidden unless --all is passed.`;

type Options = {
  repoRoot?: string;
  output?: CliOutput;
  host?: BlockerHost;
  color?: boolean;
  timeZone?: string;
};

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
    const format = formatter(
      options.color ??
        (Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env)),
      options.timeZone,
    );
    const blockersFor = (candidates: number[]) =>
      readBlockers(
        candidates,
        options.host ?? createHost(config, runCommand, repoRoot),
        store,
        (message) => output.stderr(`Warning: ${message}`),
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
      const blockers = await blockersFor(issue.state === "open" ? [n] : []);
      for (const line of format.issue(issue, changes, blockers))
        output.stdout(line);
      return 0;
    }
    const cursor = await store.readCursor();
    output.stdout(
      cursor ? format.synced(cursor.syncedUpTo) : "Not synced yet.",
    );
    const { issues, damaged } = await store.listIssues();
    for (const n of damaged)
      output.stderr(`Warning: damaged issue copy ${store.issuePath(n)}`);
    const listed = issues.filter(
      (issue) => showAll || issue.state !== "closed",
    );
    const statuses = await Promise.all(
      listed.map(async (issue) => {
        // Buffer each issue's warnings so parallel reads retain listing order.
        const warnings: string[] = [];
        const reader = new StateStore(resolve(repoRoot, STATE_DIR), (message) =>
          warnings.push(message),
        );
        try {
          const last = (await reader.readStatus(issue.number)).at(-1);
          return { issue, last, warnings };
        } catch (error) {
          return { issue, error, warnings };
        }
      }),
    );
    const rows: StatusRow[] = [];
    for (const entry of statuses) {
      for (const warning of entry.warnings)
        output.stderr(`Warning: ${warning}`);
      if ("error" in entry) throw entry.error;
      if (entry.last) rows.push({ issue: entry.issue, change: entry.last });
    }
    const candidates = rows
      .filter(
        ({ issue, change }) =>
          issue.state === "open" &&
          (change.status === "ready" || change.status === "inProgress"),
      )
      .map(({ issue }) => issue.number);
    const blockers = await blockersFor(candidates);
    output.stdout("");
    for (const line of format.list(rows, blockers)) output.stdout(line);
    return 0;
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
