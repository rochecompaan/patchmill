import { appendFile, mkdir, open } from "node:fs/promises";
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
  level: "info" | "warning" | "heartbeat" | "error" | "debug";
  stage: string;
  message: string;
  consoleMessage?: string;
  issueNumber?: number;
  attemptId?: string;
  phase?: string;
  runId?: string;
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

function evidenceAttemptId(attemptId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(attemptId))
    throw new Error("Invalid Run attempt ID for evidence allocation");
  return attemptId;
}

export function runLogPath(
  runStateDir: string,
  timestamp: string,
  attemptId: string,
  issueNumber?: number,
): string {
  const fileName = `run-${safeTimestamp(timestamp)}-${evidenceAttemptId(attemptId)}.jsonl`;
  return issueNumber === undefined
    ? join(runStateDir, fileName)
    : join(runStateDir, `issue-${issueNumber}`, fileName);
}

export function runPiSessionPath(
  runStateDir: string,
  timestamp: string,
  attemptId: string,
  issueNumber: number,
): string {
  return join(
    runStateDir,
    `issue-${issueNumber}`,
    `run-${safeTimestamp(timestamp)}-${evidenceAttemptId(attemptId)}-pi-sessions`,
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
  private initialized?: Promise<void>;
  private readonly mode: "create" | "append-owned";

  constructor(path: string, mode: "create" | "append-owned" = "create") {
    this.path = path;
    this.mode = mode;
  }

  async event(event: AgentIssueProgressEvent): Promise<void> {
    const { consoleMessage: _consoleMessage, ...logEvent } = event;
    this.initialized ??= this.initialize();
    await this.initialized;
    await appendFile(this.path, `${JSON.stringify(logEvent)}\n`, "utf8");
  }

  private async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Only the terminal result adapter appends after placement of its owned log.
    const handle = await open(
      this.path,
      this.mode === "create" ? "wx" : "a",
      0o600,
    );
    await handle.close();
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
