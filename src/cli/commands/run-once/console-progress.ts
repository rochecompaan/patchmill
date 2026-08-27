import type { PersistedSubagentProgress } from "../../../pi/subagent-progress.ts";
import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";

export type FinalResultProgressSnapshot = {
  stepNumber: number;
  totalOutputTokens: number;
  elapsedSeconds: number;
};

export type AgentIssueConsoleProgressReporterOptions = {
  write?: (chunk: string) => void;
  writeLine?: (line: string) => void;
  startedAt?: Date;
  deferFinalResult?: boolean;
};

type CurrentStep = {
  number: number;
  label: string;
  startOutputTokens: number;
};

function formatTokens(tokens: number): string {
  return `${(tokens / 1000).toFixed(1)}k`;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${minutes}m00s`
    : `${minutes}m${String(remainingSeconds).padStart(2, "0")}s`;
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
  if (typeof task !== "object" || task === null || Array.isArray(task))
    return undefined;
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

function childProgressKey(progress: PersistedSubagentProgress): string {
  return progress.kind === "direct"
    ? JSON.stringify([
        "direct",
        progress.toolCallId,
        progress.runId,
        progress.childIndex,
      ])
    : JSON.stringify([
        "workflow",
        progress.toolCallId,
        progress.workflowRunId,
        progress.childId,
      ]);
}

function metadataTupleKey(progress: PersistedSubagentProgress): string {
  return JSON.stringify([
    progress.agent ?? null,
    progress.model ?? null,
    progress.thinking ?? null,
  ]);
}

function formatAuthoritativeSubagentProgress(
  progress: PersistedSubagentProgress,
): string | undefined {
  if (!progress.agent) return undefined;
  const fields = [`agent=${progress.agent}`];
  if (progress.model) fields.push(`model=${progress.model}`);
  if (progress.thinking) fields.push(`thinking=${progress.thinking}`);
  return `🤖 subagent (${fields.join(", ")})`;
}

function formatUnresolvedSubagentProgress(
  progress: PersistedSubagentProgress,
): string {
  return progress.kind === "workflow"
    ? `🤖 subagent (child=${progress.childId}, unresolved=true)`
    : `🤖 subagent (runId=${progress.runId}, childIndex=${progress.childIndex}, unresolved=true)`;
}

function formatToolCall(
  toolName: string | undefined,
  args: Record<string, unknown> | undefined,
): string {
  const name = toolName ?? "tool";
  const subagentCall =
    name === "subagent" ? formatSubagentCall(args) : undefined;
  if (subagentCall) return subagentCall;
  const argPairs = Object.entries(args ?? {})
    .map(([key, value]) => `${key}=${formatArgumentValue(value)}`)
    .join(", ");
  return argPairs ? `🔧 ${name} (${argPairs})` : `🔧 ${name}`;
}

export class AgentIssueConsoleProgressReporter implements ProgressReporter {
  private readonly write: (chunk: string) => void;
  private readonly writeLine: (line: string) => void;
  private readonly startedAtMs: number;
  private nextStepNumber = 1;
  private totalOutputTokens = 0;
  private currentStep: CurrentStep | undefined;
  private readonly deferFinalResult: boolean;
  private finalResult: FinalResultProgressSnapshot | undefined;
  private readonly subagentMetadataKeysByChild = new Map<string, Set<string>>();
  private readonly unresolvedSubagentChildren = new Set<string>();

  constructor(options: AgentIssueConsoleProgressReporterOptions = {}) {
    this.write = options.write ?? ((chunk) => process.stderr.write(chunk));
    this.writeLine = options.writeLine ?? ((line) => this.write(`${line}\n`));
    this.startedAtMs = (options.startedAt ?? new Date()).getTime();
    this.deferFinalResult = options.deferFinalResult ?? false;
  }

  finalResultSnapshot(): Readonly<FinalResultProgressSnapshot> | undefined {
    return this.finalResult ? { ...this.finalResult } : undefined;
  }

  event(event: AgentIssueProgressEvent): void {
    if (event.level === "heartbeat") return;

    if (event.consoleMessage) {
      this.writeLine(
        this.currentStep ? `   ${event.consoleMessage}` : event.consoleMessage,
      );
      return;
    }

    if (event.step?.type === "run-start") {
      this.writeLine(`issue #${event.step.issueNumber} · ${event.step.title}`);
      return;
    }

    if (event.observation?.type === "assistant-usage") {
      this.totalOutputTokens += event.observation.outputTokens;
      return;
    }

    if (event.observation?.type === "subagent-progress") {
      this.writeSubagentProgress(event.observation.progress);
      return;
    }

    if (event.observation?.type === "tool-call") {
      if (this.currentStep) {
        this.writeLine(
          `   ${formatToolCall(event.observation.toolName, event.observation.arguments)}`,
        );
      }
      return;
    }

    if (event.step?.type === "step-start") {
      const deferred =
        this.deferFinalResult && /^final result \S.*$/u.test(event.step.label);
      if (!deferred && this.nextStepNumber > 1) this.writeLine("");
      this.currentStep = {
        number: this.nextStepNumber,
        label: event.step.label,
        startOutputTokens: this.totalOutputTokens,
      };
      this.nextStepNumber += 1;
      if (!deferred)
        this.writeLine(
          `${String(this.currentStep.number).padStart(2, "0")} ${event.step.label}`,
        );
      return;
    }

    if (event.step?.type === "step-complete") {
      this.completeCurrentStep(event);
    }
  }

  private writeSubagentProgress(progress: PersistedSubagentProgress): void {
    const authoritativeLine = formatAuthoritativeSubagentProgress(progress);
    if (authoritativeLine) {
      const childKey = childProgressKey(progress);
      const tupleKey = metadataTupleKey(progress);
      const seen = this.subagentMetadataKeysByChild.get(childKey);
      if (seen?.has(tupleKey)) return;
      if (seen) seen.add(tupleKey);
      else this.subagentMetadataKeysByChild.set(childKey, new Set([tupleKey]));
      this.writeLine(
        this.currentStep ? `   ${authoritativeLine}` : authoritativeLine,
      );
      return;
    }
    if (!progress.unresolved) return;

    const childKey = childProgressKey(progress);
    if (
      this.subagentMetadataKeysByChild.has(childKey) ||
      this.unresolvedSubagentChildren.has(childKey)
    ) {
      return;
    }
    this.unresolvedSubagentChildren.add(childKey);
    const fallbackLine = formatUnresolvedSubagentProgress(progress);
    this.writeLine(this.currentStep ? `   ${fallbackLine}` : fallbackLine);
  }

  private completeCurrentStep(event: AgentIssueProgressEvent): void {
    const step = this.currentStep;
    if (!step) return;

    const taskTokens =
      event.step?.type === "step-complete" &&
      event.step.taskOutputTokens !== undefined
        ? event.step.taskOutputTokens
        : this.totalOutputTokens - step.startOutputTokens;
    const totalTokens =
      event.step?.type === "step-complete" &&
      event.step.totalOutputTokens !== undefined
        ? event.step.totalOutputTokens
        : this.totalOutputTokens;
    const elapsedSeconds =
      event.step?.type === "step-complete" &&
      event.step.elapsedSeconds !== undefined
        ? event.step.elapsedSeconds
        : Math.max(
            0,
            Math.round(
              (new Date(event.time).getTime() - this.startedAtMs) / 1000,
            ),
          );
    const deferred =
      this.deferFinalResult && /^final result \S.*$/u.test(step.label);
    if (deferred) {
      this.finalResult = {
        stepNumber: step.number,
        totalOutputTokens: totalTokens,
        elapsedSeconds,
      };
    } else {
      this.writeLine(
        `   tokens: task ${formatTokens(taskTokens)} total ${formatTokens(totalTokens)}   time elapsed: ${formatElapsed(elapsedSeconds)}`,
      );
    }
    this.currentStep = undefined;
  }
}
