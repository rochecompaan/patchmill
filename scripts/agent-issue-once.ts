#!/usr/bin/env node
import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import { loadPatchmillConfigState } from "../src/config/load.ts";
import { parseArgs } from "./agent-issue/args.ts";
import { AgentIssueConsoleProgressReporter } from "./agent-issue/console-progress.ts";
import { runOneIssue } from "./agent-issue/pipeline.ts";
import {
  JsonlProgressReporter,
  compositeProgressReporter,
  runLogPath,
} from "./agent-issue/progress.ts";
import { createCommandRunner } from "./agent-issue-triage/command.ts";
import type { AgentIssuePipelineResult, AgentIssueVisualEvidence } from "./agent-issue/types.ts";

export const HELP_TEXT = `Usage:
  node scripts/agent-issue-once.ts [options]
  just agent-issue-once -- [options]

Process one Forgejo issue labeled agent-ready. Defaults to showing this help when no options are provided.
Use --dry-run to preview the next eligible issue without mutating Forgejo or git.
Progress is written to stderr by default. Final JSON is written to stdout.
Run logs are written under the configured run state directory (default: .patchmill/runs/).

Options:
  --help, -h          Show this help and exit.
  --dry-run, --dryrun Preview the next eligible agent-ready issue without mutations.
  --execute           Claim and process one eligible issue.
  --plan-only         Create or find the issue plan, then stop before implementation.
  --quiet             Suppress terminal progress; still write JSONL run log.
  --verbose-pi-output Stream raw Pi assistant/tool text in addition to concise progress.
  --issue <number>    Process one specific open agent-ready issue.
  --host-login <name> Use a named host login for Forgejo issue updates.
  --tea-login <name>  Compatibility alias for --host-login.
  --agent-team <name> Use the named Pi agent-team preset for worker/reviewer subagents.

Environment:
  PATCHMILL_HOST_LOGIN               Override the default host login name.
  PATCHMILL_AGENT_TEAM               Override the default Pi agent-team preset.
  CROPRUN_AGENT_ISSUE_TEA_LOGIN      Compatibility override for the default tea login name.
  CROPRUN_TRIAGE_TEA_LOGIN           Compatibility fallback default tea login name.
  CROPRUN_AGENT_ISSUE_AGENT_TEAM     Compatibility override for implementation agent-team.
  CROPRUN_AGENT_ISSUE_FORGEJO_URL    Forgejo base URL for PR visual evidence uploads.
  CROPRUN_AGENT_ISSUE_FORGEJO_TOKEN  Forgejo API token for PR visual evidence uploads.
  CROPRUN_AGENT_ISSUE_FORGEJO_REPO   Optional owner/repo override when git remote parsing is insufficient.
`;

type Env = Record<string, string | undefined>;

type JsonResultLog = { logPath?: string };

type JsonResult = JsonResultLog &
  (
    | { status: "no-issue" }
    | { status: "dry-run"; issueNumber: number; title: string }
    | {
        status: "plan-created" | "plan-found";
        issueNumber: number;
        planPath: string;
      }
    | {
        status: "pr-created";
        issueNumber: number;
        planPath: string;
        branch: string;
        prUrl: string;
        worktreePath: string;
        commits: string[];
        validation: string[];
        reviewSummary?: string;
        landingDecision?: string;
        visualEvidence?: AgentIssueVisualEvidence[];
      }
    | {
        status: "merged";
        issueNumber: number;
        planPath: string;
        branch: string;
        mergeCommit: string;
        worktreePath: string;
        commits: string[];
        validation: string[];
        reviewSummary?: string;
        landingDecision?: string;
      }
    | {
        status: "blocked";
        issueNumber: number;
        reason: string;
        questions: string[];
      }
  );

function isHelpOnlyInvocation(args: string[]): boolean {
  return args.length === 0 || args.includes("--help") || args.includes("-h");
}

function questionText(
  question: string | { question: string; recommendedAnswer?: string },
): string {
  return typeof question === "string"
    ? question
    : question.recommendedAnswer
      ? `${question.question} (recommended: ${question.recommendedAnswer})`
      : question.question;
}

function issueNumberFromResult(
  result: AgentIssuePipelineResult,
): number | undefined {
  return "issue" in result ? result.issue.number : undefined;
}

async function finalLogPath(
  preliminaryLogPath: string,
  runStateDir: string,
  timestamp: string,
  result: AgentIssuePipelineResult,
): Promise<string> {
  const issueNumber = issueNumberFromResult(result);
  if (issueNumber === undefined) return preliminaryLogPath;

  const issueLogPath = runLogPath(runStateDir, timestamp, issueNumber);
  if (issueLogPath === preliminaryLogPath) return preliminaryLogPath;

  await mkdir(dirname(issueLogPath), { recursive: true });
  await rename(preliminaryLogPath, issueLogPath).catch(() => undefined);
  return issueLogPath;
}

export function summarizeResult(result: AgentIssuePipelineResult): JsonResult {
  const withLogPath = result.logPath ? { logPath: result.logPath } : {};

  switch (result.status) {
    case "no-issue":
      return { status: result.status, ...withLogPath };
    case "dry-run":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        title: result.issue.title,
        ...withLogPath,
      };
    case "plan-created":
    case "plan-found":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        planPath: result.planPath,
        ...withLogPath,
      };
    case "pr-created":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        planPath: result.planPath,
        branch: result.branch,
        prUrl: result.prUrl,
        worktreePath: result.worktreePath,
        commits: result.commits,
        validation: result.validation,
        reviewSummary: result.reviewSummary,
        landingDecision: result.landingDecision,
        visualEvidence: result.visualEvidence,
        ...withLogPath,
      };
    case "merged":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        planPath: result.planPath,
        branch: result.branch,
        mergeCommit: result.mergeCommit,
        worktreePath: result.worktreePath,
        commits: result.commits,
        validation: result.validation,
        reviewSummary: result.reviewSummary,
        landingDecision: result.landingDecision,
        ...withLogPath,
      };
    case "blocked":
      return {
        status: result.status,
        issueNumber: result.issue.number,
        reason: result.reason,
        questions: result.questions.map(questionText),
        ...withLogPath,
      };
  }
}

export async function loadCliConfig(
  args: string[],
  repoRoot = cwd(),
  env: Env = process.env,
) {
  if (isHelpOnlyInvocation(args)) {
    return parseArgs(args, repoRoot, env);
  }

  const { config: patchmillConfig, hasConfigFile } = await loadPatchmillConfigState(repoRoot, env, args);
  return parseArgs(args, repoRoot, env, hasConfigFile ? patchmillConfig : undefined);
}

async function main(): Promise<void> {
  const config = await loadCliConfig(process.argv.slice(2));
  if (config.showHelp) {
    console.log(HELP_TEXT);
    return;
  }

  const startedAt = new Date();
  const timestamp = startedAt.toISOString();
  const logPath = runLogPath(config.runStateDir, timestamp);
  const progress = compositeProgressReporter([
    new JsonlProgressReporter(logPath),
    ...(config.quiet ? [] : [new AgentIssueConsoleProgressReporter({ startedAt })]),
  ]);

  let result: AgentIssuePipelineResult;
  try {
    result = await runOneIssue(createCommandRunner(), config, {
      now: startedAt,
      progress,
      logPath,
      verbosePiOutput: config.verbosePiOutput,
      streamPiOutput: !config.quiet && config.verbosePiOutput
        ? (chunk) => {
            process.stderr.write(chunk);
          }
        : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await progress.event({
      time: new Date().toISOString(),
      level: "error",
      stage: "error",
      message: `blocked: ${message}`,
      data: { error: message },
    });
    console.log(JSON.stringify({ status: "error", error: message, logPath }));
    process.exitCode = 1;
    return;
  }

  const outputLogPath = await finalLogPath(
    logPath,
    config.runStateDir,
    timestamp,
    result,
  );
  console.log(
    JSON.stringify(summarizeResult({ ...result, logPath: outputLogPath })),
  );
  if (result.status === "blocked") {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify({ status: "error", error: message }));
    process.exitCode = 1;
  });
}
