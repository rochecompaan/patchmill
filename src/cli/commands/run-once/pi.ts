import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PI_TASK_CONTRACT,
  type PatchmillPiTaskContract,
} from "../../../policy/task-contract.ts";
import {
  PI_TODO_DONE_STATUSES_ENV,
  serializeTodoDoneStatuses,
} from "../../../policy/todo-statuses.ts";
import { localPiAgentDir } from "../init/pi-agent-settings.ts";
import {
  piAgentCommandEnv,
  piCommandArgs,
  resolveBundledPiCommand,
  type PiCommandSpec,
} from "../../pi-cli.ts";
import { finalJsonCandidates } from "./final-json.ts";
import { issueTodoProgress } from "./issue-todos.ts";
import {
  createExactPiSessionObservationStreamer,
  createExactPiSessionProgressState,
  createPiSessionMessageStreamer,
  type PiSessionObservation,
} from "./pi-session-stream.ts";
import {
  createPiSessionAllocation,
  type PiSessionAllocation,
} from "./pi-session-allocation.ts";
import { aggregatePiErrors, type PiErrorCause } from "./pi-errors.ts";
import {
  readPiRepairFacts,
  type PiRepairPromptInput,
} from "./pi-session-repair.ts";
import type {
  AgentIssueBlockerQuestion,
  AgentIssueDevelopmentEnvironmentResult,
  AgentIssuePiResult,
  AgentIssueVisualEvidence,
  CommandResult,
  CommandRunner,
  ProgressReporter,
} from "./types.ts";

function piPromptArgs(
  promptPath: string,
  session: PiSessionAllocation | undefined,
  skillPaths: string[] = [],
  extensionArgs: string[] = [],
): string[] {
  const skillArgs = skillPaths.flatMap((path) => ["--skill", path]);
  const baseArgs = [...extensionArgs, ...skillArgs, "-p"];
  if (session?.sessionPath) {
    return [...baseArgs, "--session", session.sessionPath, `@${promptPath}`];
  }
  if (session?.sessionDir) {
    return [...baseArgs, "--session-dir", session.sessionDir, `@${promptPath}`];
  }
  return [...baseArgs, `@${promptPath}`];
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

function requiredString(
  value: unknown,
  field: string,
  context: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must include a non-empty ${field} string`);
  }
  return value;
}

function requiredStringArray(
  value: unknown,
  field: string,
  context: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (entry): entry is string =>
        typeof entry === "string" && entry.trim().length > 0,
    )
  ) {
    throw new Error(
      `${context} must include a non-empty ${field} string array`,
    );
  }
  return value;
}

function optionalStringRecord(
  value: unknown,
  field: string,
  context: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} ${field} must be an object of string values`);
  }

  const entries = Object.entries(value);
  if (
    !entries.every(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    )
  ) {
    throw new Error(`${context} ${field} must be an object of string values`);
  }
  return Object.fromEntries(entries);
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

export function parseDevelopmentEnvironmentResult(
  stdout: string,
): AgentIssueDevelopmentEnvironmentResult {
  for (const parsed of finalJsonCandidates(stdout)) {
    if (parsed.status === "ready") {
      const context = "Development environment ready result";
      const environment = optionalStringRecord(
        parsed.environment,
        "environment",
        context,
      );
      return {
        status: "ready",
        summary: requiredString(parsed.summary, "summary", context),
        evidence: requiredStringArray(parsed.evidence, "evidence", context),
        ...(environment ? { environment } : {}),
      };
    }

    if (parsed.status === "not-ready") {
      const context = "Development environment not-ready result";
      return {
        status: "not-ready",
        reason: requiredString(parsed.reason, "reason", context),
        evidence: requiredStringArray(parsed.evidence, "evidence", context),
        remediation: requiredStringArray(
          parsed.remediation,
          "remediation",
          context,
        ),
      };
    }
  }

  throw new Error(
    "Pi output did not include a supported development environment JSON status",
  );
}

export type PiTaskProgress = {
  current: number;
  total: number;
  label?: string;
};

export type RunPiPromptStage =
  | "pi-artifact-extraction"
  | "pi-plan"
  | "pi-development-environment"
  | "pi-implementation";

export type PiRepairOptions = {
  maxAttempts: number;
  buildPrompt: (input: PiRepairPromptInput) => string;
};

export type RunPiPromptOptions<Result = AgentIssuePiResult> = {
  progress?: ProgressReporter;
  stage: RunPiPromptStage;
  parseResult?: (stdout: string) => Result;
  skillPaths?: string[];
  extensionArgs?: string[];
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
  sessionRoot?: string;
  sessionDir?: string;
  onObservation?: (observation: PiSessionObservation) => void | Promise<void>;
  verbosePiOutput?: boolean;
  taskContract?: PatchmillPiTaskContract;
  piAgentDir?: string;
  piCommand?: PiCommandSpec;
  cleanupPromptTempDir?: (dir: string) => Promise<void>;
  repair?: PiRepairOptions;
};

function stageStatus(stage: RunPiPromptStage): string {
  if (stage === "pi-artifact-extraction") return "extracting artifact sources";
  if (stage === "pi-plan") return "planning";
  if (stage === "pi-development-environment") return "development environment";
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
  const causes: PiErrorCause[] = [];
  const record = (label: string, error: unknown) => {
    causes.push({ label, error });
  };
  let parsedResult: { value: Result } | undefined;
  let latestTokenUsage: string | undefined;
  const pendingHeartbeats: Promise<void>[] = [];
  const heartbeatMs = options?.heartbeatMs ?? 60_000;
  const started = Date.now();
  const timer = options?.progress
    ? setInterval(() => {
        const elapsedSeconds = Math.round((Date.now() - started) / 1000);
        const heartbeat = heartbeatStatusLine(
          options,
          elapsedSeconds,
          latestTokenUsage,
        )
          .then((message) =>
            options.progress?.event({
              time: new Date().toISOString(),
              level: "heartbeat",
              stage: options.stage,
              message,
              elapsedSeconds,
            }),
          )
          .then(() => undefined)
          .catch((error: unknown) => {
            record("heartbeat", error);
          });
        pendingHeartbeats.push(heartbeat);
      }, heartbeatMs)
    : undefined;

  try {
    await writeFile(promptPath, prompt, "utf8");
    await options?.progress?.event({
      time: new Date().toISOString(),
      level: "debug",
      stage: options.stage,
      message: "started pi",
    });
    const session = options
      ? await createPiSessionAllocation({ ...options, promptTempDir: dir })
      : undefined;
    if (session?.sessionDir) {
      await options?.progress?.event({
        time: new Date().toISOString(),
        level: "debug",
        stage: options.stage,
        message: "pi session dir",
        data: session.sessionDir,
      });
    }
    if (session?.sessionPath) {
      await options?.progress?.event({
        time: new Date().toISOString(),
        level: "debug",
        stage: options.stage,
        message: "pi session path",
        data: session.sessionPath,
      });
    }

    const parseResult = options?.parseResult ?? parsePiResult;
    const exactSessionProgressState = session?.sessionPath
      ? createExactPiSessionProgressState()
      : undefined;
    const runPiProcessAttempt = async (
      attemptPromptPath: string,
      startOffset?: number,
    ): Promise<CommandResult | undefined> => {
      const controller = session?.sessionPath
        ? new AbortController()
        : undefined;
      const sessionStreamer = session?.sessionPath
        ? createExactPiSessionObservationStreamer(
            session.sessionPath,
            async (observation) => {
              if (observation.type === "assistant-usage") {
                latestTokenUsage = `tok: task=${observation.outputTokens} total=?`;
                if (options?.tokenUsageState)
                  options.tokenUsageState.total += observation.outputTokens;
              }
              await options?.onObservation?.(observation);
            },
            {
              startOffset,
              progressState: exactSessionProgressState,
              verboseOutput: options?.verbosePiOutput
                ? options.streamOutput
                : undefined,
            },
          )
        : session?.sessionDir
          ? createPiSessionMessageStreamer(
              session.sessionDir,
              options?.streamOutput ?? (() => undefined),
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
      let observationFailure: Promise<void> | undefined;
      if (sessionStreamer && "failure" in sessionStreamer) {
        observationFailure = sessionStreamer.failure.catch((error) => {
          record("observation", error);
          controller?.abort(error);
        });
      }
      sessionStreamer?.start();
      let attemptResult: CommandResult | undefined;
      try {
        const piCommand = options?.piCommand ?? resolveBundledPiCommand();
        attemptResult = await runner.run(
          piCommand.command,
          piCommandArgs(
            piCommand,
            piPromptArgs(
              attemptPromptPath,
              session,
              options?.skillPaths,
              options?.extensionArgs,
            ),
          ),
          {
            cwd,
            env: piAgentCommandEnv(
              options?.piAgentDir ?? localPiAgentDir(cwd),
              {
                PI_TODO_PATH:
                  options?.taskContract?.todoRoot ??
                  DEFAULT_PI_TASK_CONTRACT.todoRoot,
                [PI_TODO_DONE_STATUSES_ENV]: serializeTodoDoneStatuses(
                  options?.taskContract?.doneStatuses ??
                    DEFAULT_PI_TASK_CONTRACT.doneStatuses,
                ),
              },
            ),
            signal: controller?.signal,
          },
        );
      } catch (error) {
        record("runner", error);
      }
      void observationFailure;
      try {
        await sessionStreamer?.stop();
      } catch (error) {
        if (!causes.some((cause) => cause.error === error))
          record("streamer shutdown", error);
      }
      if (!attemptResult) return undefined;
      try {
        await emitPiOutput(attemptResult, options);
      } catch (error) {
        record("progress", error);
      }
      if (attemptResult.code !== 0) {
        record(
          "runner",
          new Error(
            `pi failed: ${attemptResult.stderr || attemptResult.stdout}`,
          ),
        );
      }
      return attemptResult;
    };

    const repair = options?.repair;
    const repairSessionPath = session?.sessionPath;
    let attemptPromptPath = promptPath;
    let startOffset: number | undefined;
    let parseError: unknown;
    let repairAttempts = 0;

    for (let attempt = 0; ; attempt += 1) {
      const result = await runPiProcessAttempt(attemptPromptPath, startOffset);
      if (!result || causes.length > 0) break;

      try {
        parsedResult = { value: parseResult(result.stdout) as Result };
        break;
      } catch (error) {
        parseError = error;
      }

      if (!repair || attempt >= repair.maxAttempts || !repairSessionPath) break;

      const repairAttempt = attempt + 1;
      const facts = await readPiRepairFacts({
        sessionPath: repairSessionPath,
        parseError,
      });
      await options?.progress?.event({
        time: new Date().toISOString(),
        level: "info",
        stage: options.stage,
        message: `repairing invalid pi final result (${repairAttempt}/${repair.maxAttempts})`,
        data: facts.unresolvedSummary,
      });
      const repairPromptPath = join(dir, `repair-${repairAttempt}.md`);
      await writeFile(
        repairPromptPath,
        repair.buildPrompt({
          attempt: repairAttempt,
          maxAttempts: repair.maxAttempts,
          facts,
        }),
        "utf8",
      );
      attemptPromptPath = repairPromptPath;
      startOffset = facts.sessionByteSize;
      repairAttempts = repairAttempt;
    }

    if (!parsedResult && parseError !== undefined && causes.length === 0) {
      if (repairAttempts > 0 && repairSessionPath) {
        const facts = await readPiRepairFacts({
          sessionPath: repairSessionPath,
          parseError,
        });
        record(
          "result parsing",
          new Error(
            [
              `Pi repair attempts exhausted after ${repairAttempts} attempts`,
              `Unresolved async subagent summary: ${facts.unresolvedSummary}`,
              `Last assistant prose: ${facts.lastAssistantTextExcerpt ?? "not detected"}`,
              `Last parse error: ${facts.parseErrorMessage}`,
            ].join("; "),
          ),
        );
      } else {
        record("result parsing", parseError);
      }
    }
  } catch (error) {
    record("pi prompt", error);
  } finally {
    if (timer) clearInterval(timer);
    try {
      await Promise.all(pendingHeartbeats);
    } catch (error) {
      record("heartbeat", error);
    }
    try {
      await (
        options?.cleanupPromptTempDir ??
        ((path: string) => rm(path, { recursive: true, force: true }))
      )(dir);
    } catch (error) {
      record("cleanup", error);
    }
  }

  const combined = aggregatePiErrors("pi prompt failed", causes);
  if (combined) throw combined;
  if (parsedResult) return parsedResult.value;
  throw new Error("pi prompt finished without a result");
}
