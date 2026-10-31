import type { TriageProgressEvent } from "../../../kernel/triage.ts";

const DIVIDER =
  "──────────────────────────────────────────────────────────────────────────────";

function formatLabels(labels: string[]): string {
  return labels.length > 0 ? labels.join(", ") : "(none)";
}

export function createTriageProgressReporter(options: {
  command: string;
  dryRun: boolean;
  writeLine: (line: string) => void;
}) {
  let total = 0;
  const write = options.writeLine;
  return {
    onProgress(event: TriageProgressEvent) {
      if (event.type === "selected") {
        total = event.total;
        write(`> ${options.command}`);
        write("");
        write(`issues: ${total}`);
        write("");
      } else if (event.type === "started") {
        write(DIVIDER);
        write(`#${event.issue.number} ${event.issue.title}`);
        if (event.issue.url) write(`  link: ${event.issue.url}`);
        write(`  log: ${event.logPath}`);
      } else {
        write(
          `  labels: ${formatLabels(event.previousLabels)} -> ${formatLabels(event.finalLabels)}`,
        );
        if (event.comment) {
          write(event.applied ? "  comment added:" : "  comment:");
          for (const line of event.comment.split(/\r?\n/u).slice(0, 5))
            write(`  ${line}`);
        }
        write("");
        write(`progress: ${event.completed}/${event.total} triaged`);
        write("");
      }
    },
    finish(completed: number, cancelled: boolean) {
      const status = cancelled
        ? "cancelled"
        : total === 0
          ? "no-issues"
          : completed < total
            ? "partial"
            : options.dryRun
              ? "dry-run"
              : "applied";
      write(`agent issue triage: ${status}`);
    },
  };
}
