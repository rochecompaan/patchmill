import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PI_TASK_CONTRACT,
  type PatchmillPiTaskContract,
} from "../../../policy/task-contract.ts";
import { piAgentEnv } from "../init/pi-agent-settings.ts";
import { issueTodoProgress } from "./issue-todos.ts";
import {
  createPiSessionMessageStreamer,
  createPiSessionObservationStreamer,
  type PiSessionObservation,
} from "./pi-session-stream.ts";
import type {
  AgentIssueBlockerQuestion,
  AgentIssueImplementationReadinessResult,
  AgentIssuePiResult,
  AgentIssueVisualEvidence,
  CommandResult,
  CommandRunner,
  ProgressReporter,
} from "./types.ts";

const require = createRequire(import.meta.url);
const PI_SUBAGENTS_PACKAGE_ROOT = dirname(
  require.resolve("pi-subagents/package.json"),
);
const PATCHMILL_PACKAGE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const PATCHMILL_TODOS_EXTENSION = join(
  PATCHMILL_PACKAGE_ROOT,
  "extensions",
  "todos.ts",
);

function piPromptArgs(
  promptPath: string,
  sessionDir?: string,
  skillPaths: string[] = [],
): string[] {
  const skillArgs = skillPaths.flatMap((path) => ["--skill", path]);
  const extensionArgs = [
    "-e",
    PI_SUBAGENTS_PACKAGE_ROOT,
    "-e",
    PATCHMILL_TODOS_EXTENSION,
  ];
  const baseArgs = [...extensionArgs, ...skillArgs, "-p"];
  return sessionDir
    ? [...baseArgs, "--session-dir", sessionDir, `@${promptPath}`]
    : [...baseArgs, `@${promptPath}`];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function questions(value: unknown): AgentIssueBlockerQuestion[] {
  return Array.isArray(value) ? (value as AgentIssueBlockerQuestion[]) : [];
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

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function finalJsonCandidates(stdout: string): Record<string, unknown>[] {
  const trimmed = stdout.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  const body = fenced ? fenced[1] : trimmed;
  const end = body.lastIndexOf("}");
  if (end < 0) throw new Error("Pi output did not include a final JSON object");

  const candidates: Record<string, unknown>[] = [];
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
      candidates.push(parsed);
    } catch {
      continue;
    }
  }

  return candidates;
}

export function parsePiResult(stdout: string): AgentIssuePiResult {
  for (const parsed of finalJsonCandidates(stdout)) {
    if (parsed.status === "blocked") {
      return {
        status: "blocked",
        reason:
          typeof parsed.reason === "string" ? parsed.reason : "Unknown blocker",
        questions: questions(parsed.questions),
        commits: stringArray(parsed.commits),
        validation: stringArray(parsed.validation),
      };
    }

    if (
      parsed.status === "spec-created" &&
      typeof parsed.specPath === "string"
    ) {
      return {
        status: "spec-created",
        specPath: parsed.specPath,
        commit: typeof parsed.commit === "string" ? parsed.commit : undefined,
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
  }

  throw new Error("Pi output did not include a supported final JSON status");
}

export function parseImplementationReadinessResult(
  stdout: string,
): AgentIssueImplementationReadinessResult {
  for (const parsed of finalJsonCandidates(stdout)) {
    if (parsed.status === "ready") {
      const environment = stringRecord(parsed.environment);
      return {
        status: "ready",
        summary: typeof parsed.summary === "string" ? parsed.summary : "Ready",
        evidence: stringArray(parsed.evidence),
        ...(environment ? { environment } : {}),
      };
    }

    if (parsed.status === "not-ready") {
      return {
        status: "not-ready",
        reason:
          typeof parsed.reason === "string"
            ? parsed.reason
            : "Implementation environment is not ready",
        evidence: stringArray(parsed.evidence),
        remediation: stringArray(parsed.remediation),
      };
    }
  }

  throw new Error(
    "Pi output did not include a supported implementation readiness JSON status",
  );
}

export type PiTaskProgress = {
  current: number;
  total: number;
  label?: string;
};

export type RunPiPromptStage =
  | "pi-plan"
  | "pi-implementation-ready"
  | "pi-implementation";

export type RunPiPromptOptions<Result = AgentIssuePiResult> = {
  progress?: ProgressReporter;
  stage: RunPiPromptStage;
  parseResult?: (stdout: string) => Result;
  skillPaths?: string[];
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
  piAgentDir?: string;
};

function stageStatus(stage: RunPiPromptStage): string {
  if (stage === "pi-plan") return "planning";
  if (stage === "pi-implementation-ready") return "implementation readiness";
  return "implementing";
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

export async function runPiPrompt<Result = AgentIssuePiResult>(
  runner: CommandRunner,
  cwd: string,
  prompt: string,
  options?: RunPiPromptOptions<Result>,
): Promise<Result> {
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
        piPromptArgs(promptPath, sessionDir, options?.skillPaths),
        {
          cwd,
          env: {
            ...(options?.piAgentDir ? piAgentEnv(options.piAgentDir) : {}),
            PI_TODO_PATH:
              options?.taskContract?.todoRoot ??
              DEFAULT_PI_TASK_CONTRACT.todoRoot,
          },
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

    const parseResult = options?.parseResult ?? parsePiResult;
    return parseResult(stdout) as Result;
  } finally {
    if (timer) clearInterval(timer);
    await Promise.all(pendingHeartbeats);
    await rm(dir, { recursive: true, force: true });
  }
}
