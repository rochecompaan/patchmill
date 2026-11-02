import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { trustedAuthors, type PatchmillConfig } from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import type { RunOnceDeps } from "./run-once.ts";
import { derivePhase, type Phase } from "./phase.ts";
import { renderRunEnvelope } from "./envelope.ts";
import { resolvePhaseSkill } from "./phase-skill.ts";
import type { HumanChannel } from "./human-channel.ts";
import {
  printModeLauncher,
  type PhaseLaunch,
  type PhaseLauncher,
  type PhaseRun,
} from "./launch.ts";
import { closesIssue, type Outcome, type OutcomeLabel } from "./verify.ts";
import type { Facts } from "./facts.ts";
import { planningBranchName } from "./names.ts";
import { guidanceComment, planningGateComment } from "./comments.ts";

export async function continueGate(
  facts: Facts,
  human?: HumanChannel,
  onWait?: () => void,
): Promise<boolean> {
  if (human) onWait?.();
  return (
    !!human &&
    (await human.awaitContinue({
      kind: "gate",
      message: planningGateComment(facts),
    })) === "continue"
  );
}

/** Keep channel methods bound to their owner (Console channels hold state). */
export function launchPhase(
  launch: PhaseLaunch,
  fallback: PhaseLauncher,
  human?: HumanChannel,
  feedback?: string,
  guidance?: string,
): Promise<PhaseRun> {
  if (!human) return fallback(launch);
  if (guidance !== undefined)
    return human.resumeImplementation(launch, guidance);
  return launch.phase === "planning"
    ? human.runPlanning(launch, feedback)
    : human.runImplementation(launch);
}

export function phaseDecision(
  facts: Facts,
  feedback?: string,
  resuming = false,
) {
  if (resuming)
    return { kind: "phase" as const, phase: "implementation" as const };
  if (feedback !== undefined)
    return { kind: "phase" as const, phase: "planning" as const };
  return derivePhase(facts);
}

export function planningStopSummary(
  summary: string,
  before: Facts,
  after: Facts,
): string {
  if (!after.specPath)
    return `${summary}\nExpected artifact: ${after.expectedSpecPath}`;
  if (before.stage !== "spec" && !after.planPath)
    return `${summary}\nExpected artifact: ${after.expectedPlanPath}`;
  return summary;
}

export function planningFeedback(
  phase: PhaseLaunch["phase"],
  run: PhaseRun,
  verified: Outcome,
  human?: HumanChannel,
): string | undefined {
  if (
    human &&
    phase === "planning" &&
    !run.session.aborted &&
    verified.kind === "stop" &&
    verified.label === "needsInfo"
  )
    return verified.comment;
  return undefined;
}

/** Preserve the non-interactive stop explanation before considering a gate wait. */
export function derivedStop(
  facts: Facts,
  issue: number,
  repository: Pick<import("../host/types.ts").Repository, "owner" | "repo">,
  initialLabel: OutcomeLabel,
): { label: OutcomeLabel; summary: string } {
  let label = initialLabel;
  let summary =
    label === "done"
      ? "The pull request is merged."
      : planningGateComment(facts);
  const closing =
    facts.pullRequest && closesIssue(facts.pullRequest.body, issue, repository);
  if (label === "done" && !closing) {
    label = "needsInfo";
    summary = `The merged pull request does not close issue #${issue}; it cannot prove implementation completion.`;
  } else if (facts.stage !== "implementation" && closing) {
    label = "needsInfo";
    summary = `The planning pull request would close issue #${issue}. Replace its closing reference with Refs #${issue} before merging it.`;
  }
  return { label, summary };
}

/** Prepare the on-disk prompt shared by interactive and print launchers. */
export async function preparePhasePrompt(
  config: PatchmillConfig,
  deps: Pick<
    RunOnceDeps,
    "host" | "repoRoot" | "piCommand" | "extensionPaths" | "human"
  >,
  runDir: string,
  issue: Issue,
  phase: Phase,
  facts: Facts,
  sessionNumber: number,
  signal?: AbortSignal,
) {
  const { host, repoRoot } = deps;
  const skill = resolvePhaseSkill(config, repoRoot, phase);
  const promptPath = join(runDir, "prompt.md");
  const envelope = renderRunEnvelope({
    repository: await host.repository(),
    issue,
    phase,
    facts,
    skill,
    interactive: !!deps.human,
    timeoutMinutes: config.pi.timeoutMinutes,
    trusted: trustedAuthors(config, (await host.checkCli()).login),
  });
  await fs.writeFile(promptPath, envelope);
  const launcher = printModeLauncher({
    command: deps.piCommand,
    agentDir: resolve(repoRoot, config.pi.agentDir),
    extensionPaths: deps.extensionPaths,
  });
  const launch: PhaseLaunch = {
    phase,
    ...(deps.human && phase === "planning"
      ? {
          planningGate: {
            required: facts.stage !== "implementation",
            pullRequest:
              facts.stage !== "implementation" &&
              facts.branch === planningBranchName(issue.number, facts.stage),
          },
        }
      : {}),
    envelope,
    worktree: facts.worktree,
    sessionDir: join(runDir, "sessions", String(sessionNumber)),
    skillPath: skill.path,
    promptPath,
    logPath: join(runDir, `session-${sessionNumber}.log`),
    aggregateLogPath: join(runDir, "pi.log"),
    timeoutMs: config.pi.timeoutMinutes * 60_000,
    ...(signal ? { signal } : {}),
  };
  return { launch, launcher };
}

/** Only a completed needs-input implementation can be resumed upstream. */
export async function workerGuidance(
  phase: Phase,
  run: PhaseRun,
  verified: Outcome,
  deps: Pick<RunOnceDeps, "human" | "host">,
  issue: number,
  onBlocked: () => void,
): Promise<string | undefined> {
  const { human, host } = deps;
  if (
    !human ||
    phase !== "implementation" ||
    verified.kind !== "stop" ||
    !run.result.ok ||
    run.result.result.status !== "needs-input" ||
    run.session.aborted ||
    run.session.timedOut
  )
    return undefined;
  onBlocked();
  const answer = await human.awaitGuidance(run.result.result.summary);
  if (answer.kind === "quit") return undefined;
  await host.commentIssue(issue, guidanceComment(answer.text));
  return answer.text;
}
