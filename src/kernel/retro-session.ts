import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PatchmillConfig } from "../config/config.ts";
import { renderRetroEnvelope } from "./envelope.ts";
import { costLine, sumSessionUsage } from "./pi-cost.ts";
import { supervisePi } from "./pi-supervisor.ts";
import { parseJsonBlock } from "./result.ts";
import {
  claimRetro,
  finishRetro,
  type RetroEnd,
  type RetroScope,
} from "./retro-record.ts";
import { collectRetroSources, renderRetroSourceMap } from "./retro-sources.ts";
import type { RunOnceDeps } from "./run-once.ts";
import { triageTimeoutMs } from "./triage.ts";

export type RetroSessionDeps = Pick<
  RunOnceDeps,
  "host" | "piCommand" | "repoRoot" | "now" | "output"
>;

type RetroResult = { status: "done" | "failed"; summary: string };

function validate(value: unknown): RetroResult | string {
  if (!value || typeof value !== "object") return "invalid result";
  const { status, summary } = value as Record<string, unknown>;
  if (status !== "done" && status !== "failed") return "invalid status";
  if (typeof summary !== "string") return "invalid summary";
  return { status, summary };
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** The issue folder below the runs folder. */
export function issueRunsDir(
  config: PatchmillConfig,
  repoRoot: string,
  issue: number,
): string {
  return resolve(repoRoot, config.paths.runsDir, `issue-${issue}`);
}

/** The Retro instructions and source map of a claimed Retro. */
export async function retroInstructions(input: {
  config: PatchmillConfig;
  host: RunOnceDeps["host"];
  repoRoot: string;
  issue: number;
  issueDir: string;
  scope: RetroScope;
  interactive: boolean;
}): Promise<string> {
  const sources = await collectRetroSources(input.scope, input.issueDir);
  const repository = await input.host.repository();
  const issue = await input.host.viewIssue(input.issue).catch(() => undefined);
  return renderRetroEnvelope({
    repository,
    provider: input.config.host.provider,
    skillPath: resolve(input.repoRoot, input.config.skills.retro),
    issue: { number: input.issue, ...(issue?.url ? { url: issue.url } : {}) },
    scope: input.scope,
    sourceMap: renderRetroSourceMap(sources, {
      issueDir: input.issueDir,
      since: input.scope.since,
    }),
    interactive: input.interactive,
  });
}

/**
 * Runs the unattended Retro of one Issue run end in a print-mode Pi session.
 * The caller holds the issue lock. Never throws: a failure only warns, and the
 * outcome of the source issue never changes.
 */
export async function runUnattendedRetro(
  config: PatchmillConfig,
  deps: RetroSessionDeps,
  input: { issue: number; end: RetroEnd; signal?: AbortSignal },
): Promise<void> {
  const mode = config.retro.unattended;
  if (mode === "off" || input.signal?.aborted) return;
  const warn = (text: string) =>
    deps.output.stderr(`Warning: Issue #${input.issue} Retro: ${text}`);
  let scope: RetroScope | undefined;
  try {
    const issueDir = issueRunsDir(config, deps.repoRoot, input.issue);
    scope = await claimRetro({ issueDir, end: input.end, mode, now: deps.now });
    if (!scope) return;
    const promptPath = join(scope.dir, "prompt.md");
    const logPath = join(scope.dir, "session.log");
    const sessionDir = join(scope.dir, "sessions");
    await fs.writeFile(
      promptPath,
      await retroInstructions({
        config,
        host: deps.host,
        repoRoot: deps.repoRoot,
        issue: input.issue,
        issueDir,
        scope,
        interactive: false,
      }),
    );
    const session = await supervisePi({
      command: deps.piCommand,
      cwd: deps.repoRoot,
      agentDir: resolve(deps.repoRoot, config.pi.agentDir),
      sessionDir,
      skillPath: resolve(deps.repoRoot, config.skills.retro),
      promptPath,
      logPath,
      onOutput: () => {},
      extensionPaths: [],
      timeoutMs: triageTimeoutMs(config.pi.timeoutMinutes),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const failure =
      session.aborted || input.signal?.aborted
        ? "cancelled"
        : session.timedOut
          ? "timed out"
          : session.exitCode !== 0
            ? `Pi exited with ${session.exitCode ?? session.signal}`
            : undefined;
    const parsed = failure
      ? undefined
      : parseJsonBlock(session.stdout, validate);
    const reason =
      failure ??
      (parsed && !parsed.ok
        ? parsed.reason
        : parsed?.ok && parsed.value.status === "failed"
          ? parsed.value.summary || "failed"
          : undefined);
    if (reason !== undefined || !parsed?.ok) {
      await finishRetro(scope, "failed", reason ?? "failed", deps.now);
      warn(`${reason ?? "failed"}. Log: ${logPath}`);
      return;
    }
    await finishRetro(scope, "done", parsed.value.summary, deps.now);
    deps.output.stdout(
      `Retro: ${scope.findings}. ${costLine(await sumSessionUsage(sessionDir))}`,
    );
  } catch (error) {
    if (scope)
      await finishRetro(scope, "failed", message(error), deps.now).catch(
        () => {},
      );
    warn(`failed: ${message(error)}`);
  }
}
