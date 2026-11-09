import { visibleWidth } from "@earendil-works/pi-tui";
import type { Issue } from "../../../host/types.ts";
import { cleanValue } from "../../../kernel/terminal-layout.ts";
import type { StatusChange } from "../../../state/store.ts";
import {
  WORKFLOW_STATUSES,
  type WorkflowStatus,
} from "../../../kernel/workflow-state.ts";

const TITLES: Record<WorkflowStatus, string> = {
  inProgress: "In Progress",
  needsInfo: "Needs Info",
  ready: "Ready",
  done: "Done",
  unsuitable: "Unsuitable",
};
const SGR = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  red: "\u001b[31m",
};
const COLORS: Record<WorkflowStatus, string> = {
  inProgress: SGR.cyan,
  needsInfo: SGR.yellow,
  ready: SGR.green,
  done: SGR.dim,
  unsuitable: SGR.red,
};
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
export type StatusRow = { issue: Issue; change: StatusChange };

export function formatter(color: boolean, timeZone?: string) {
  const style = (text: string, sgr: string) =>
    color ? `${sgr}${text}${SGR.reset}` : text;
  const date = (timestamp: string) => {
    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) return timestamp;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(parsed);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)!.value;
    return `${Number(part("day"))} ${MONTHS[Number(part("month")) - 1]} ${part("year")}, ${part("hour")}:${part("minute")}`;
  };
  const dimDate = (timestamp: string) => style(date(timestamp), SGR.dim);
  const blocker = (text: string) =>
    style(text, text === "Blockers unknown" ? SGR.yellow : SGR.red);
  return {
    synced: (timestamp: string) => `Synced ${dimDate(timestamp)}`,
    list(rows: StatusRow[], blockers: Map<number, string>): string[] {
      if (!rows.length) return ["No issues with local workflow state."];
      const numberWidth = Math.max(
        ...rows.map((r) => `#${r.issue.number}`.length),
      );
      const titleWidth = Math.min(
        60,
        Math.max(...rows.map((r) => visibleWidth(cleanValue(r.issue.title)))),
      );
      const lines: string[] = [];
      for (const status of WORKFLOW_STATUSES) {
        const group = rows.filter((r) => r.change.status === status);
        if (!group.length) continue;
        if (lines.length) lines.push("");
        lines.push(
          style(
            `${TITLES[status]} (${group.length})`,
            SGR.bold + COLORS[status],
          ),
        );
        for (const { issue, change } of group) {
          const title = cleanValue(issue.title);
          lines.push(
            `  ${`#${issue.number}`.padEnd(numberWidth)}  ${title}${" ".repeat(Math.max(0, titleWidth - visibleWidth(title)))}  ${dimDate(change.at)}`,
          );
          const text = blockers.get(issue.number);
          if (text) lines.push(" ".repeat(2 + numberWidth + 2) + blocker(text));
        }
      }
      return lines;
    },
    issue(
      issue: Issue,
      changes: StatusChange[],
      blockers: Map<number, string>,
    ): string[] {
      const last = changes.at(-1);
      const lines = [
        style(`#${issue.number} ${cleanValue(issue.title)}`, SGR.bold),
        `State: ${issue.state === "open" ? "Open" : "Closed"}`,
        `Status: ${last ? TITLES[last.status] : "Untriaged"}`,
      ];
      const text = blockers.get(issue.number);
      if (text) lines.push(blocker(text));
      if (!changes.length) lines.push("", "No status changes.");
      for (const change of changes) {
        lines.push(
          "",
          `${dimDate(change.at)}  ${style(TITLES[change.status], COLORS[change.status])}`,
        );
        if (change.runId !== undefined)
          lines.push(`  Run: ${cleanValue(change.runId)}`);
        if (change.summary !== undefined)
          change.summary
            .split(/\r\n?|\n/u)
            .forEach((line, index) =>
              lines.push(
                `${index === 0 ? "  Summary: " : "           "}${cleanValue(line)}`,
              ),
            );
        if (change.cost !== undefined)
          lines.push(`  Cost: ${cleanValue(change.cost)}`);
        for (const warning of change.warnings ?? [])
          lines.push(`  Warning: ${cleanValue(warning)}`);
        if (change.questionUrl !== undefined)
          lines.push(`  Question: ${cleanValue(change.questionUrl)}`);
      }
      return lines;
    },
  };
}
