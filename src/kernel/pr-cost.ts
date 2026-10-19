import type { Host } from "../host/types.ts";
import {
  readIssueCostReport,
  type CostRun,
  type IssueCostReport,
} from "./issue-cost.ts";
import type { PiUsage } from "./pi-cost.ts";

const START = "<!-- patchmill-run-cost:start -->";
const END = "<!-- patchmill-run-cost:end -->";

function escapeCell(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\r\n]+/gu, " ")
    .trim();
}

function row(
  phase: string,
  model: string,
  usage: PiUsage,
  total = false,
): string {
  const cells = [
    phase,
    model,
    usage.inputTokens.toLocaleString("en-US"),
    usage.outputTokens.toLocaleString("en-US"),
    usage.costUsd === undefined
      ? "Unavailable"
      : `$${usage.costUsd.toFixed(4)}`,
  ];
  return `| ${cells.map((cell) => (total && cell ? `**${cell}**` : cell)).join(" | ")} |`;
}

export function upsertRunCostSection(
  body: string,
  report: IssueCostReport,
): string {
  const section = [
    START,
    "",
    "## Patchmill run cost",
    "",
    "| Phase | Model | Prompt tokens | Output tokens | Estimated cost (USD) |",
    "| ----- | ----- | ------------: | ------------: | -------------------: |",
    ...report.rows.map(({ phase, model, usage }) =>
      row(
        phase === "planning" ? "Planning" : "Implementation",
        escapeCell(model),
        usage,
      ),
    ),
    row("Total", "", report.total, true),
    "",
    "_Includes all retained local runs for this issue, including specification and planning PRs. Prompt tokens include uncached input, cache reads, and cache writes. Estimated cost uses Pi's recorded model pricing and includes parent and subagent sessions._",
    "",
    END,
  ].join("\n");
  const starts = body.split(START).length - 1;
  const ends = body.split(END).length - 1;
  if (starts === 0 && ends === 0) {
    const separator =
      !body || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
    return `${body}${separator}${section}`;
  }
  const start = body.indexOf(START);
  const end = body.indexOf(END);
  if (starts !== 1 || ends !== 1 || end < start)
    throw new Error("Malformed Patchmill run-cost markers");
  return `${body.slice(0, start)}${section}${body.slice(end + END.length)}`;
}

/** Only the marked cost section belongs to the kernel; the agent owns the PR. */
export async function publishIssueCost(options: {
  host: Host;
  branch: string;
  issueDir: string;
  current?: CostRun;
}): Promise<void> {
  const report = await readIssueCostReport(options.issueDir, options.current);
  if (!report) return;
  // Read again at publication time, rather than overwriting with collected facts.
  const pr = await options.host.findPullRequestByHead(options.branch);
  if (!pr) return;
  if (pr.headBranch !== options.branch)
    throw new Error(
      "Cost report pull request head does not match the issue branch",
    );
  const next = upsertRunCostSection(pr.body, report);
  if (next !== pr.body)
    await options.host.updatePullRequestBody(pr.number, next);
}
