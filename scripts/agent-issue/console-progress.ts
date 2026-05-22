import type { AgentIssueProgressEvent, ProgressReporter } from "./progress.ts";

export type AgentIssueConsoleProgressReporterOptions = {
  write?: (chunk: string) => void;
  writeLine?: (line: string) => void;
  startedAt?: Date;
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
  if (typeof task !== "object" || task === null || Array.isArray(task)) return undefined;
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

function formatSubagentCall(args: Record<string, unknown> | undefined): string | undefined {
  const agents = subagentLabels(args);
  if (agents.length === 1) return `🤖 subagent (agent=${agents[0]})`;
  if (agents.length > 1) return `🤖 subagent (agents=${agents.join(", ")})`;
  return undefined;
}

function formatToolCall(toolName: string | undefined, args: Record<string, unknown> | undefined): string {
  const name = toolName ?? "tool";
  const subagentCall = name === "subagent" ? formatSubagentCall(args) : undefined;
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

  constructor(options: AgentIssueConsoleProgressReporterOptions = {}) {
    this.write = options.write ?? ((chunk) => process.stderr.write(chunk));
    this.writeLine = options.writeLine ?? ((line) => this.write(`${line}\n`));
    this.startedAtMs = (options.startedAt ?? new Date()).getTime();
  }

  event(event: AgentIssueProgressEvent): void {
    if (event.level === "heartbeat") return;

    if (event.step?.type === "run-start") {
      this.writeLine(`issue #${event.step.issueNumber} · ${event.step.title}`);
      return;
    }

    if (event.observation?.type === "assistant-usage") {
      this.totalOutputTokens += event.observation.outputTokens;
      return;
    }

    if (event.observation?.type === "tool-call") {
      if (this.currentStep) {
        this.writeLine(`   ${formatToolCall(event.observation.toolName, event.observation.arguments)}`);
      }
      return;
    }

    if (event.step?.type === "step-start") {
      if (this.nextStepNumber > 1) this.writeLine("");
      this.currentStep = {
        number: this.nextStepNumber,
        label: event.step.label,
        startOutputTokens: this.totalOutputTokens,
      };
      this.nextStepNumber += 1;
      this.writeLine(`${String(this.currentStep.number).padStart(2, "0")} ${event.step.label}`);
      return;
    }

    if (event.step?.type === "step-complete") {
      this.completeCurrentStep(event);
    }
  }

  private completeCurrentStep(event: AgentIssueProgressEvent): void {
    const step = this.currentStep;
    if (!step) return;

    const taskTokens = event.step?.type === "step-complete" && event.step.taskOutputTokens !== undefined
      ? event.step.taskOutputTokens
      : this.totalOutputTokens - step.startOutputTokens;
    const totalTokens = event.step?.type === "step-complete" && event.step.totalOutputTokens !== undefined
      ? event.step.totalOutputTokens
      : this.totalOutputTokens;
    const elapsedSeconds = event.step?.type === "step-complete" && event.step.elapsedSeconds !== undefined
      ? event.step.elapsedSeconds
      : Math.max(0, Math.round((new Date(event.time).getTime() - this.startedAtMs) / 1000));
    this.writeLine(`   tokens: task ${formatTokens(taskTokens)} total ${formatTokens(totalTokens)}   time elapsed: ${formatElapsed(elapsedSeconds)}`);
    this.currentStep = undefined;
  }
}
