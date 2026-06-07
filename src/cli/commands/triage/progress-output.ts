import type {
  TriageProgressEvent,
  TriageResult,
  TriageToolCallEvent,
} from "./types.ts";

const DIVIDER =
  "──────────────────────────────────────────────────────────────────────────────";

function formatLabels(labels: string[]): string {
  return labels.length > 0 ? labels.join(", ") : "(none)";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u, 1)[0] ?? "";
}

function truncateLines(lines: string[], maxLines: number): string[] {
  return lines.slice(0, maxLines);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function formatArgumentValue(value: unknown): string {
  const rendered = typeof value === "string" ? value : JSON.stringify(value);
  return truncate(rendered ?? String(value), 50);
}

function subagentLabel(task: unknown): string | undefined {
  if (typeof task !== "object" || task === null || Array.isArray(task)) {
    return undefined;
  }
  const agent = (task as Record<string, unknown>).agent;
  if (typeof agent !== "string") return undefined;
  const count = (task as Record<string, unknown>).count;
  return typeof count === "number" && count > 1 ? `${agent}×${count}` : agent;
}

function subagentLabels(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const direct = subagentLabel(args);
  if (direct) return [direct];

  const tasks = args.tasks;
  if (Array.isArray(tasks)) {
    return tasks.flatMap((task) => subagentLabel(task) ?? []);
  }

  return [];
}

function formatSubagentCall(
  args: Record<string, unknown> | undefined,
): string | undefined {
  const agents = subagentLabels(args);
  if (agents.length === 1) return `🤖 subagent (agent=${agents[0]})`;
  if (agents.length > 1) return `🤖 subagent (agents=${agents.join(", ")})`;
  return undefined;
}

export function formatToolCallLine(event: TriageToolCallEvent): string {
  const name = event.toolName ?? "tool";
  const subagentCall =
    name === "subagent" ? formatSubagentCall(event.arguments) : undefined;
  if (subagentCall) return subagentCall;
  const argPairs = Object.entries(event.arguments ?? {})
    .map(([key, value]) => `${key}=${formatArgumentValue(value)}`)
    .join(", ");
  return argPairs ? `🔧 ${name} (${argPairs})` : `🔧 ${name}`;
}

export function formatProgressIssueLines(
  issue: TriageResult["issues"][number],
  completed: number,
  total: number,
): string[] {
  const lines = [DIVIDER, `#${issue.issueNumber} ${issue.title}`];

  if (issue.url) lines.push(`  link: ${issue.url}`);

  lines.push(
    `  labels: ${formatLabels(issue.previousLabels)} -> ${formatLabels(issue.finalLabels)}`,
  );

  if (
    issue.previousState &&
    issue.finalState &&
    issue.previousState !== issue.finalState
  ) {
    lines.push(`  state: ${issue.previousState} -> ${issue.finalState}`);
  }

  if (issue.comment) {
    lines.push(
      issue.mutationStatus === "observed" ? "  comment added:" : "  comment:",
    );
    lines.push(
      ...truncateLines(issue.comment.split(/\r?\n/u), 5).map(
        (line) => `  ${line}`,
      ),
    );
  }

  lines.push("", `progress: ${completed}/${total} triaged`, "");
  return lines;
}

export function createTriageProgressReporter(options: {
  command: string;
  writeLine: (line: string) => void;
}) {
  return {
    onProgress(event: TriageProgressEvent) {
      if (event.type === "selected") {
        options.writeLine(`> ${options.command}`);
        options.writeLine("");
        options.writeLine(`issues: ${event.total}`);
        options.writeLine("");
        return;
      }

      for (const line of formatProgressIssueLines(
        event.issue,
        event.completed,
        event.total,
      )) {
        options.writeLine(line);
      }
    },
    onToolCall(event: TriageToolCallEvent) {
      options.writeLine(formatToolCallLine(event));
    },
    finish(result: TriageResult) {
      options.writeLine(`agent issue triage: ${result.status}`);
      options.writeLine(`log: ${result.logPath}`);
    },
  };
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
