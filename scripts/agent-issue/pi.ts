import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PI_TASK_CONTRACT,
  type PatchmillPiTaskContract,
} from "../../src/policy/task-contract.ts";
import { issueTodoProgress } from "./issue-todos.ts";
import {
  createPiSessionMessageStreamer,
  createPiSessionObservationStreamer,
  type PiSessionObservation,
} from "./pi-session-stream.ts";
import type {
  AgentIssuePiResult,
  AgentIssueQuestion,
  AgentIssueVisualEvidence,
  CommandResult,
  CommandRunner,
  ProgressReporter,
} from "./types.ts";

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function questions(value: unknown): AgentIssueQuestion[] {
  return Array.isArray(value) ? (value as AgentIssueQuestion[]) : [];
}

function visualEvidence(
  value: unknown,
): AgentIssueVisualEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (
      typeof record.screenshotPath !== "string" ||
      record.screenshotPath.trim().length === 0
    )
      return [];
    const evidence: AgentIssueVisualEvidence = {
      screenshotPath: record.screenshotPath,
    };
    if (
      typeof record.caption === "string" &&
      record.caption.trim().length > 0
    ) {
      evidence.caption = record.caption;
    }
    const referencePaths = stringArray(record.referencePaths);
    if (referencePaths.length > 0) evidence.referencePaths = referencePaths;
    if (typeof record.url === "string" && record.url.trim().length > 0) {
      evidence.url = record.url;
    }
    return [evidence];
  });
  return entries.length > 0 ? entries : undefined;
}

export function parsePiResult(stdout: string): AgentIssuePiResult {
  const trimmed = stdout.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  const body = fenced ? fenced[1] : trimmed;
  const end = body.lastIndexOf("}");
  if (end < 0) throw new Error("Pi output did not include a final JSON object");

  for (
    let start = body.lastIndexOf("{", end);
    start >= 0;
    start = start === 0 ? -1 : body.lastIndexOf("{", start - 1)
  ) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
      if (parsed.status === "blocked") {
        return {
          status: "blocked",
          reason:
            typeof parsed.reason === "string"
              ? parsed.reason
              : "Unknown blocker",
          questions: questions(parsed.questions),
          commits: stringArray(parsed.commits),
          validation: stringArray(parsed.validation),
        };
      }

      if (
        parsed.status === "plan-created" &&
        typeof parsed.planPath === "string"
      ) {
        return {
          status: "plan-created",
          planPath: parsed.planPath,
          commit: typeof parsed.commit === "string" ? parsed.commit : undefined,
        };
      }

      if (
        parsed.status === "pr-created" &&
        typeof parsed.prUrl === "string" &&
        typeof parsed.branch === "string"
      ) {
        return {
          status: "pr-created",
          prUrl: parsed.prUrl,
          branch: parsed.branch,
          commits: stringArray(parsed.commits),
          validation: stringArray(parsed.validation),
          reviewSummary:
            typeof parsed.reviewSummary === "string"
              ? parsed.reviewSummary
              : undefined,
          landingDecision:
            typeof parsed.landingDecision === "string"
              ? parsed.landingDecision
              : undefined,
          visualEvidence: visualEvidence(parsed.visualEvidence),
        };
      }

      if (
        parsed.status === "merged" &&
        typeof parsed.branch === "string" &&
        typeof parsed.mergeCommit === "string"
      ) {
        return {
          status: "merged",
          branch: parsed.branch,
          mergeCommit: parsed.mergeCommit,
          commits: stringArray(parsed.commits),
          validation: stringArray(parsed.validation),
          reviewSummary:
            typeof parsed.reviewSummary === "string"
              ? parsed.reviewSummary
              : undefined,
          landingDecision:
            typeof parsed.landingDecision === "string"
              ? parsed.landingDecision
              : undefined,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error("Pi output did not include a supported final JSON status");
}

export type PiTaskProgress = {
  current: number;
  total: number;
  label?: string;
};

export type RunPiPromptOptions = {
  progress?: ProgressReporter;
  stage: "pi-plan" | "pi-implementation";
  heartbeatMs?: number;
  streamOutput?: (chunk: string) => void;
  issueNumber?: number;
  repoRoot?: string;
  taskProgress?: () =>
    | PiTaskProgress
    | undefined
    | Promise<PiTaskProgress | undefined>;
  onTaskProgress?: (progress: PiTaskProgress) => void | Promise<void>;
  tokenUsage?: () => string | undefined;
  tokenUsageState?: { total: number };
  observeSession?: boolean;
  onObservation?: (observation: PiSessionObservation) => void | Promise<void>;
  verbosePiOutput?: boolean;
  taskContract?: PatchmillPiTaskContract;
};

function stageStatus(stage: RunPiPromptOptions["stage"]): string {
  return stage === "pi-plan" ? "planning" : "implementing";
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.max(1, Math.round(seconds / 60))}m`;
}

function statusLine(
  options: RunPiPromptOptions,
  elapsedSeconds: number,
  tokenUsage: string | undefined,
  taskProgress: PiTaskProgress | undefined,
): string {
  const issue =
    options.issueNumber === undefined
      ? "issue ?"
      : `issue #${options.issueNumber}`;
  const task =
    options.stage === "pi-implementation" && taskProgress !== undefined
      ? ` task ${taskProgress.current}/${taskProgress.total}`
      : "";
  return `[${issue}] ${stageStatus(options.stage)}${task} | ${tokenUsage ?? "tok: task=? total=?"} | elapsed ${formatElapsed(elapsedSeconds)}`;
}

async function heartbeatStatusLine(
  options: RunPiPromptOptions,
  elapsedSeconds: number,
  latestTokenUsage: string | undefined,
): Promise<string> {
  const taskProgress =
    (await options.taskProgress?.()) ??
    (options.repoRoot !== undefined && options.issueNumber !== undefined
      ? await issueTodoProgress(
          options.repoRoot,
          options.issueNumber,
          options.taskContract ?? DEFAULT_PI_TASK_CONTRACT,
        )
      : undefined);
  if (taskProgress) await options.onTaskProgress?.(taskProgress);
  return statusLine(
    options,
    elapsedSeconds,
    options.tokenUsage?.() ?? latestTokenUsage,
    taskProgress,
  );
}

async function emitPiOutput(
  result: CommandResult,
  options?: RunPiPromptOptions,
): Promise<void> {
  if (!options?.progress) return;
  const time = new Date().toISOString();
  await options.progress.event({
    time,
    level: "debug",
    stage: options.stage,
    message: "pi stdout",
    data: result.stdout,
  });
  await options.progress.event({
    time,
    level: "debug",
    stage: options.stage,
    message: "pi stderr",
    data: result.stderr,
  });
}

export async function runPiPrompt(
  runner: CommandRunner,
  cwd: string,
  prompt: string,
  options?: RunPiPromptOptions,
): Promise<AgentIssuePiResult> {
  const dir = await mkdtemp(join(tmpdir(), "agent-issue-prompt-"));
  const promptPath = join(dir, "prompt.md");
  await writeFile(promptPath, prompt, "utf8");
  const heartbeatMs = options?.heartbeatMs ?? 60_000;
  const started = Date.now();
  let latestTokenUsage: string | undefined;
  const pendingHeartbeats: Promise<void>[] = [];
  const timer = options?.progress
    ? setInterval(() => {
        const elapsedSeconds = Math.round((Date.now() - started) / 1000);
        pendingHeartbeats.push(
          heartbeatStatusLine(options, elapsedSeconds, latestTokenUsage)
            .then((message) =>
              options.progress?.event({
                time: new Date().toISOString(),
                level: "heartbeat",
                stage: options.stage,
                message,
                elapsedSeconds,
              }),
            )
            .then(() => undefined),
        );
      }, heartbeatMs)
    : undefined;

  try {
    await options?.progress?.event({
      time: new Date().toISOString(),
      level: "debug",
      stage: options.stage,
      message: "started pi",
    });
    const streamOutput = options?.streamOutput;
    const shouldCreateSession = options?.observeSession || streamOutput;
    const sessionDir = shouldCreateSession ? join(dir, "sessions") : undefined;
    if (sessionDir) await mkdir(sessionDir, { recursive: true });
    const pendingObservations: Promise<void>[] = [];
    const sessionStreamer = sessionDir
      ? options?.observeSession
        ? createPiSessionObservationStreamer(
            sessionDir,
            (observation) => {
              if (observation.type === "assistant-usage") {
                latestTokenUsage = `tok: task=${observation.outputTokens} total=?`;
                if (options?.tokenUsageState) {
                  options.tokenUsageState.total += observation.outputTokens;
                }
              }
              if (options?.onObservation) {
                pendingObservations.push(
                  Promise.resolve(options.onObservation(observation)).then(
                    () => undefined,
                  ),
                );
              }
            },
            {
              verboseOutput: options.verbosePiOutput ? streamOutput : undefined,
            },
          )
        : createPiSessionMessageStreamer(
            sessionDir,
            streamOutput ?? (() => undefined),
            {
              totalTokensSoFar: options?.tokenUsageState?.total ?? 0,
              onTokenUsage: (usage) => {
                latestTokenUsage = usage.text;
                if (options?.tokenUsageState)
                  options.tokenUsageState.total = usage.total;
              },
            },
          )
      : undefined;
    sessionStreamer?.start();
    let result: CommandResult;
    try {
      result = await runner.run(
        "pi",
        sessionDir
          ? ["-p", "--session-dir", sessionDir, `@${promptPath}`]
          : ["-p", `@${promptPath}`],
        {
          cwd,
        },
      );
    } finally {
      await sessionStreamer?.stop();
      await Promise.all(pendingObservations);
    }
    await emitPiOutput(result, options);
    const stdout = result.stdout;
    if (result.code !== 0) {
      throw new Error(`pi failed: ${result.stderr || stdout || result.stdout}`);
    }

    return parsePiResult(stdout);
  } finally {
    if (timer) clearInterval(timer);
    await Promise.all(pendingHeartbeats);
    await rm(dir, { recursive: true, force: true });
  }
}
