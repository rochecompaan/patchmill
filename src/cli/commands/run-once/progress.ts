import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PiSessionObservation } from "./pi-session-stream.ts";

export type AgentIssueStepEvent =
  | { type: "run-start"; issueNumber: number; title: string }
  | { type: "step-start"; label: string }
  | {
      type: "step-complete";
      label: string;
      taskOutputTokens?: number;
      totalOutputTokens?: number;
      toolCalls?: number;
      elapsedSeconds?: number;
    };

export type AgentIssueProgressEvent = {
  time: string;
  level: "info" | "heartbeat" | "error" | "debug";
  stage: string;
  message: string;
  consoleMessage?: string;
  issueNumber?: number;
  elapsedSeconds?: number;
  step?: AgentIssueStepEvent;
  observation?: PiSessionObservation;
  taskOutputTokens?: number;
  totalOutputTokens?: number;
  toolCalls?: number;
  data?: unknown;
};

export type ProgressReporter = {
  event(event: AgentIssueProgressEvent): void | Promise<void>;
};

function safeTimestamp(timestamp: string): string {
  return timestamp.replaceAll(":", "-").replaceAll(".", "-");
}

export function runLogPath(
  runStateDir: string,
  timestamp: string,
  issueNumber?: number,
): string {
  const fileName = `run-${safeTimestamp(timestamp)}.jsonl`;
  return issueNumber === undefined
    ? join(runStateDir, fileName)
    : join(runStateDir, `issue-${issueNumber}`, fileName);
}

export function runPiSessionPath(
  runStateDir: string,
  timestamp: string,
  issueNumber: number,
): string {
  return join(
    runStateDir,
    `issue-${issueNumber}`,
    `run-${safeTimestamp(timestamp)}-pi-sessions`,
  );
}

export class ConsoleProgressReporter implements ProgressReporter {
  private readonly writeLine: (line: string) => void;

  constructor(
    writeLine: (line: string) => void = (line) => console.error(line),
  ) {
    this.writeLine = writeLine;
  }

  event(event: AgentIssueProgressEvent): void {
    if (event.level === "debug") return;
    this.writeLine(event.consoleMessage ?? event.message);
  }
}

export class JsonlProgressReporter implements ProgressReporter {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async event(event: AgentIssueProgressEvent): Promise<void> {
    const { consoleMessage: _consoleMessage, ...logEvent } = event;
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(logEvent)}\n`, "utf8");
  }
}

export function compositeProgressReporter(
  reporters: ProgressReporter[],
): ProgressReporter {
  return {
    async event(event) {
      await Promise.all(reporters.map((reporter) => reporter.event(event)));
    },
  };
}

export const silentProgressReporter: ProgressReporter = { event() {} };
