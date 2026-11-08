import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { trustedAuthors, type PatchmillConfig } from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import type { RunOnceDeps } from "./run-once.ts";
import { renderTriageEnvelope } from "./envelope.ts";
import { newRunId } from "./names.ts";
import { supervisePi } from "./pi-supervisor.ts";
import { parseJsonBlock } from "./result.ts";
import { LabelWorkflowState } from "./label-workflow.ts";
import type { TrackedIssue } from "./workflow-state.ts";
import type { WorkflowStatus } from "../state/store.ts";

export type TriageResult = {
  label: string;
  comment: string;
  blockedBy: number[];
};
export type TriageDeps = Pick<
  RunOnceDeps,
  "workflow" | "host" | "piCommand" | "repoRoot" | "now" | "output"
>;
export type TriageProgressEvent =
  | { type: "selected"; total: number }
  | {
      type: "started";
      issue: Pick<Issue, "number" | "title" | "url">;
      logPath: string;
    }
  | {
      type: "triaged";
      previousStatus: TrackedIssue["status"];
      finalStatus: TrackedIssue["status"];
      comment: string;
      asked: boolean;
      blockedBy: number[];
      applied: boolean;
      completed: number;
      total: number;
    };
export type TriageOptions = {
  issue?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: TriageProgressEvent) => void;
};

export function hasReply(issue: TrackedIssue, trusted: string[]): boolean {
  const latest = issue.comments.reduce<
    TrackedIssue["comments"][number] | undefined
  >(
    (last, comment) =>
      !last || Date.parse(comment.createdAt) >= Date.parse(last.createdAt)
        ? comment
        : last,
    undefined,
  );
  return (
    latest !== undefined &&
    trusted.includes(latest.author) &&
    !latest.fromPatchmill &&
    (issue.statusSince === undefined ||
      Date.parse(latest.createdAt) > Date.parse(issue.statusSince))
  );
}

export function selectTriageCandidates(
  issues: TrackedIssue[],
  trusted: string[],
): TrackedIssue[] {
  return issues.filter(
    (issue) =>
      issue.state === "open" &&
      (issue.status === "untriaged" ||
        (issue.status === "needsInfo" && hasReply(issue, trusted))),
  );
}

function validateResult(
  value: unknown,
  allowed: string[],
  issue: number,
  ready: string,
): TriageResult | string {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return "result must be an object";
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).some(
      (key) => !["label", "comment", "blockedBy"].includes(key),
    )
  )
    return "unexpected result field";
  if (typeof result.label !== "string" || !allowed.includes(result.label))
    return "label must be a configured triage outcome";
  if (typeof result.comment !== "string") return "comment must be a string";
  if (
    !Array.isArray(result.blockedBy) ||
    result.blockedBy.some(
      (number) =>
        !Number.isSafeInteger(number) || number <= 0 || number === issue,
    ) ||
    new Set(result.blockedBy).size !== result.blockedBy.length
  )
    return "blockedBy must contain distinct positive issue numbers other than the target";
  if (result.blockedBy.length && result.label !== ready)
    return "only a ready result can propose blockers";
  return {
    label: result.label,
    comment: result.comment,
    blockedBy: result.blockedBy,
  };
}

export async function runTriage(
  config: PatchmillConfig,
  deps: TriageDeps,
  options: TriageOptions,
): Promise<Array<{ issue: number; label: string; applied: boolean }>> {
  const { host, repoRoot, output } = deps;
  const workflow = deps.workflow ?? new LabelWorkflowState(host, config.labels);
  await workflow.sync(options.issue);
  const trusted = trustedAuthors(config, (await host.checkCli()).login);
  const warn = (issue: number, message: string) =>
    output.stderr(`Warning: Issue #${issue}: ${message}`);
  const candidates: number[] = [];
  if (options.issue !== undefined) candidates.push(options.issue);
  else {
    for (const listed of await workflow.openIssues()) {
      if (options.signal?.aborted) break;
      try {
        // List responses may omit comments; needsInfo eligibility requires them.
        const issue =
          listed.status === "needsInfo"
            ? await workflow.issue(listed.number)
            : listed;
        if (selectTriageCandidates([issue], trusted).length)
          candidates.push(issue.number);
      } catch (error) {
        warn(
          listed.number,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  options.onProgress?.({ type: "selected", total: candidates.length });
  const allowed = [
    config.labels.ready,
    config.labels.unsuitable,
    config.labels.needsInfo,
  ];
  const outcomes: Array<{ issue: number; label: string; applied: boolean }> =
    [];
  for (const number of candidates.sort((a, b) => a - b)) {
    if (options.signal?.aborted) break;
    try {
      const issue = await workflow.issue(number);
      if (
        options.issue === undefined &&
        !selectTriageCandidates([issue], trusted).length
      )
        continue;
      const dependencies = await host.listIssueDependencies(number);
      const repository = await host.repository();
      const runDir = resolve(
        repoRoot,
        config.paths.runsDir,
        "triage",
        newRunId(deps.now()),
      );
      await fs.mkdir(runDir, { recursive: true });
      const promptPath = join(runDir, "prompt.md");
      const skill = {
        name: "triage",
        path: resolve(repoRoot, config.skills.triage),
      };
      await fs.writeFile(
        promptPath,
        renderTriageEnvelope({
          repository,
          dependencies,
          issue,
          skill,
          labels: config.labels,
          trusted,
        }),
      );
      const logPath = join(runDir, "session-1.log");
      options.onProgress?.({ type: "started", issue, logPath });
      const session = await supervisePi({
        command: deps.piCommand,
        cwd: repoRoot,
        agentDir: resolve(repoRoot, config.pi.agentDir),
        sessionDir: join(runDir, "sessions", "1"),
        skillPath: skill.path,
        promptPath,
        logPath,
        // Keep raw model output in the session log, not in the CLI display.
        onOutput: () => {},
        extensionPaths: [],
        timeoutMs: config.pi.timeoutMinutes * 60_000,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      if (
        session.aborted ||
        options.signal?.aborted ||
        session.timedOut ||
        session.exitCode !== 0
      ) {
        warn(
          number,
          "Pi session failed, timed out, or was cancelled; skipping.",
        );
        continue;
      }
      const parsed = parseJsonBlock(session.stdout, (value) =>
        validateResult(value, allowed, number, config.labels.ready),
      );
      if (!parsed.ok) {
        warn(number, `${parsed.reason}; skipping.`);
        continue;
      }
      const { label, comment } = parsed.value;
      const slug = `${repository.owner}/${repository.repo}`.toLowerCase();
      const blockedBy = parsed.value.blockedBy.filter(
        (blocker) =>
          !dependencies.some(
            (dependency) =>
              dependency.number === blocker &&
              dependency.repository.toLowerCase() === slug,
          ),
      );
      const status = (
        ["ready", "unsuitable", "needsInfo"] as WorkflowStatus[]
      ).find((status) => config.labels[status] === label)!;
      const asked = status === "needsInfo" && comment !== "";
      if (!options.dryRun) {
        for (const [index, blocker] of blockedBy.entries()) {
          try {
            await host.addIssueDependency(number, blocker);
          } catch (error) {
            throw new Error(
              `Cannot add blockers ${blockedBy
                .slice(index)
                .map((n) => `#${n}`)
                .join(
                  ", ",
                )}: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
        }
        const warnings = await workflow.setStatus(number, {
          status,
          ...(comment ? { summary: comment } : {}),
          ask: asked,
        });
        for (const warning of warnings) warn(number, warning);
      }
      outcomes.push({ issue: number, label, applied: !options.dryRun });
      options.onProgress?.({
        type: "triaged",
        previousStatus: issue.status,
        finalStatus: status,
        comment,
        asked,
        blockedBy,
        applied: !options.dryRun,
        completed: outcomes.length,
        total: candidates.length,
      });
    } catch (error) {
      warn(number, error instanceof Error ? error.message : String(error));
    }
  }
  return outcomes;
}
