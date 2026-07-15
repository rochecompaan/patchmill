import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type { AgentIssuePipelineResult } from "./types.ts";

export type PipelineProgressOptions = {
  now?: Date;
  progress?: ProgressReporter;
  logPath?: string;
};

export async function progress(
  options: PipelineProgressOptions,
  level: AgentIssueProgressEvent["level"],
  stage: string,
  message: string,
  extras: Partial<
    Pick<
      AgentIssueProgressEvent,
      "issueNumber" | "elapsedSeconds" | "data" | "consoleMessage"
    >
  > = {},
): Promise<void> {
  await options.progress?.event({
    time: (options.now ?? new Date()).toISOString(),
    level,
    stage,
    message,
    ...extras,
  });
}

export async function emitSimpleStep(
  options: PipelineProgressOptions,
  issueNumber: number,
  label: string,
): Promise<void> {
  const time = new Date().toISOString();
  await options.progress?.event({
    time,
    level: "info",
    stage: "step",
    message: label,
    issueNumber,
    step: { type: "step-start", label },
  });
  await options.progress?.event({
    time: new Date().toISOString(),
    level: "info",
    stage: "step",
    message: label,
    issueNumber,
    step: { type: "step-complete", label },
  });
}

export function withLogPath<T extends AgentIssuePipelineResult>(
  result: T,
  options: PipelineProgressOptions,
): T {
  return options.logPath ? { ...result, logPath: options.logPath } : result;
}

export function createStepAccounting(options: {
  progress?: ProgressReporter;
  issueNumber: number;
}) {
  let activeLabel: string | undefined;
  return {
    async start(label: string): Promise<void> {
      if (activeLabel) await this.complete(activeLabel);
      activeLabel = label;
      await options.progress?.event({
        time: new Date().toISOString(),
        level: "info",
        stage: "step",
        message: label,
        issueNumber: options.issueNumber,
        step: { type: "step-start", label },
      });
    },
    async complete(label = activeLabel): Promise<void> {
      if (!label) return;
      await options.progress?.event({
        time: new Date().toISOString(),
        level: "info",
        stage: "step",
        message: label,
        issueNumber: options.issueNumber,
        step: { type: "step-complete", label },
      });
      if (activeLabel === label) activeLabel = undefined;
    },
    activeLabel(): string | undefined {
      return activeLabel;
    },
  };
}

export async function recordPiObservation(options: {
  progress?: ProgressReporter;
  issueNumber: number;
  stage: string;
  data: unknown;
}): Promise<void> {
  await options.progress?.event({
    time: new Date().toISOString(),
    level: "debug",
    stage: options.stage,
    message: "pi observation",
    issueNumber: options.issueNumber,
    data: options.data,
  });
}
