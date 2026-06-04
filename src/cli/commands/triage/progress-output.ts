import type { TriageProgressEvent, TriageResult } from "./types.ts";

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
