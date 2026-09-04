import { JsonlProgressReporter } from "./progress.ts";
import type { FinalResultProgressSnapshot } from "./console-progress.ts";
import type { RunOnceResultSummary } from "./result-summary.ts";
import {
  formatTerminalResult,
  terminalResultSeverity,
} from "./terminal-result.ts";

export type RunOnceResultStream = {
  isTTY?: boolean;
  columns?: number;
  write(chunk: string): unknown;
};
export type WriteRunOnceResultOptions = {
  stdout: RunOnceResultStream;
  env: Record<string, string | undefined>;
  logPath?: string | undefined;
  progress?: FinalResultProgressSnapshot | undefined;
  elapsedSeconds?: number | undefined;
  time?: Date | undefined;
};
export function exitCodeForRunOnceResult(summary: RunOnceResultSummary): 0 | 1 {
  return summary.status === "approval-required" ||
    summary.status === "development-environment-not-ready" ||
    summary.status === "blocked" ||
    summary.status === "error"
    ? 1
    : 0;
}

export async function writeRunOnceResult(
  summary: RunOnceResultSummary,
  options: WriteRunOnceResultOptions,
): Promise<void> {
  const severity = terminalResultSeverity(summary.status);
  if (options.logPath)
    await new JsonlProgressReporter(options.logPath).event({
      time: (options.time ?? new Date()).toISOString(),
      level:
        severity === "success"
          ? "info"
          : severity === "warning"
            ? "warning"
            : "error",
      stage: "result",
      message: `final result ${summary.status}`,
      data: summary,
    });
  const interactive = options.stdout.isTTY === true;
  const width =
    Number.isFinite(options.stdout.columns) &&
    Number(options.stdout.columns) > 0
      ? Math.floor(Number(options.stdout.columns))
      : 80;
  const color =
    interactive &&
    options.env.NO_COLOR === undefined &&
    options.env.TERM !== "dumb";
  const output = interactive
    ? formatTerminalResult(summary, {
        width,
        color,
        stepNumber: options.progress?.stepNumber,
        totalOutputTokens: options.progress?.totalOutputTokens,
        elapsedSeconds:
          options.progress?.elapsedSeconds ?? options.elapsedSeconds,
      })
    : JSON.stringify(summary);
  options.stdout.write(`${output}\n`);
}
