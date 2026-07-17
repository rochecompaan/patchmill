import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";
import type { AgentIssuePipelineResult } from "./types.ts";

export type PipelineProgressOptions = {
  now?: Date;
  progress?: ProgressReporter;
  logPath?: string;
  piSessionPath?: string;
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
  return {
    ...result,
    ...(options.logPath ? { logPath: options.logPath } : {}),
    ...(options.piSessionPath ? { piSessionPath: options.piSessionPath } : {}),
  };
}

export function createStepAccounting(options: {
  progress?: ProgressReporter;
  issueNumber: number;
  runStartedAtMs?: number;
}) {
  type ActiveStep = {
    label: string;
    startOutputTokens: number;
    toolCalls: number;
  };

  let activeStep: ActiveStep | undefined;
  let totalOutputTokens = 0;
  const runStartedAtMs = options.runStartedAtMs ?? Date.now();

  const start = async (label: string): Promise<void> => {
    if (activeStep) await complete(activeStep.label);
    activeStep = { label, startOutputTokens: totalOutputTokens, toolCalls: 0 };
    await options.progress?.event({
      time: new Date().toISOString(),
      level: "info",
      stage: "step",
      message: label,
      issueNumber: options.issueNumber,
      data: { stepLabel: label },
      step: { type: "step-start", label },
    });
  };

  const complete = async (label = activeStep?.label): Promise<void> => {
    if (!label) return;
    const current = activeStep?.label === label ? activeStep : undefined;
    const taskOutputTokens = current
      ? totalOutputTokens - current.startOutputTokens
      : 0;
    const toolCalls = current?.toolCalls ?? 0;
    const elapsedSeconds = Math.max(
      0,
      Math.round((Date.now() - runStartedAtMs) / 1000),
    );
    await options.progress?.event({
      time: new Date().toISOString(),
      level: "info",
      stage: "step",
      message: label,
      issueNumber: options.issueNumber,
      elapsedSeconds,
      taskOutputTokens,
      totalOutputTokens,
      toolCalls,
      step: {
        type: "step-complete",
        label,
        taskOutputTokens,
        totalOutputTokens,
        toolCalls,
        elapsedSeconds,
      },
    });
    if (current) activeStep = undefined;
  };

  return {
    start,
    complete,
    async run<T>(label: string, fn: () => Promise<T>): Promise<T> {
      await start(label);
      try {
        return await fn();
      } finally {
        await complete(label);
      }
    },
    async observe(
      stage: string,
      observation: AgentIssueProgressEvent["observation"],
    ): Promise<void> {
      if (!observation) return;
      if (observation.type === "assistant-usage")
        totalOutputTokens += observation.outputTokens;
      if (observation.type === "tool-call" && activeStep)
        activeStep.toolCalls += 1;
      await options.progress?.event({
        time: new Date().toISOString(),
        level: "debug",
        stage,
        message: observation.type,
        issueNumber: options.issueNumber,
        observation,
      });
    },
    activeLabel(): string | undefined {
      return activeStep?.label;
    },
  };
}

export async function recordPiObservation(options: {
  progress?: ProgressReporter;
  issueNumber: number;
  stage: string;
  observation?: AgentIssueProgressEvent["observation"];
  data?: unknown;
}): Promise<void> {
  await options.progress?.event({
    time: new Date().toISOString(),
    level: "debug",
    stage: options.stage,
    message: options.observation?.type ?? "pi observation",
    issueNumber: options.issueNumber,
    observation: options.observation,
    data: options.data,
  });
}
