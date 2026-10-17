import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  trustedAuthors,
  type PatchmillConfig,
  type LabelsConfig,
} from "../config/config.ts";
import type { Issue } from "../host/types.ts";
import type { RunOnceDeps } from "./run-once.ts";
import { renderTriageEnvelope } from "./envelope.ts";
import { newRunId } from "./names.ts";
import { supervisePi } from "./pi-supervisor.ts";
import { KERNEL_COMMENT } from "./comments.ts";
import { parseJsonBlock } from "./result.ts";

export type TriageResult = { label: string; comment: string };
export type TriageDeps = Pick<
  RunOnceDeps,
  "host" | "piCommand" | "repoRoot" | "now" | "output"
>;
export type TriageOptions = {
  issue?: number;
  dryRun?: boolean;
  signal?: AbortSignal;
};

export function selectTriageCandidates(
  issues: Issue[],
  labels: LabelsConfig,
  trusted: string[],
): Issue[] {
  return issues.filter((issue) => {
    if (issue.state !== "open") return false;
    const classified = issue.labels.filter((label) =>
      Object.values(labels).includes(label),
    );
    if (!classified.length) return true;
    if (classified.some((label) => label !== labels.needsInfo)) return false;
    const latest = issue.comments.reduce<Issue["comments"][number] | undefined>(
      (last, comment) =>
        !last || Date.parse(comment.createdAt) >= Date.parse(last.createdAt)
          ? comment
          : last,
      undefined,
    );
    return (
      issue.labels.includes(labels.needsInfo) &&
      latest !== undefined &&
      trusted.includes(latest.author) &&
      !latest.body.startsWith(KERNEL_COMMENT)
    );
  });
}

function validateResult(
  value: unknown,
  allowed: string[],
): TriageResult | string {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return "result must be an object";
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some((key) => key !== "label" && key !== "comment"))
    return "unexpected result field";
  if (typeof result.label !== "string" || !allowed.includes(result.label))
    return "label must be a configured triage outcome";
  if (typeof result.comment !== "string") return "comment must be a string";
  return { label: result.label, comment: result.comment };
}

export async function runTriage(
  config: PatchmillConfig,
  deps: TriageDeps,
  options: TriageOptions,
): Promise<Array<{ issue: number; label: string; applied: boolean }>> {
  const { host, repoRoot, output } = deps;
  const trusted = trustedAuthors(config, (await host.checkCli()).login);
  const warn = (issue: number, message: string) =>
    output.stderr(`Warning: Issue #${issue}: ${message}`);
  const candidates: number[] = [];
  if (options.issue !== undefined) candidates.push(options.issue);
  else {
    for (const listed of await host.listOpenIssues()) {
      if (options.signal?.aborted) break;
      try {
        // List responses may omit comments; needsInfo eligibility requires them.
        const issue = listed.labels.includes(config.labels.needsInfo)
          ? await host.viewIssue(listed.number)
          : listed;
        if (selectTriageCandidates([issue], config.labels, trusted).length)
          candidates.push(issue.number);
      } catch (error) {
        warn(
          listed.number,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
  const allowed = [
    config.labels.ready,
    config.labels.unsuitable,
    config.labels.blocked,
    config.labels.needsInfo,
  ];
  const outcomes: Array<{ issue: number; label: string; applied: boolean }> =
    [];
  for (const number of candidates) {
    if (options.signal?.aborted) break;
    try {
      const issue = await host.viewIssue(number);
      if (
        options.issue === undefined &&
        !selectTriageCandidates([issue], config.labels, trusted).length
      )
        continue;
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
          repository: await host.repository(),
          issue,
          skill,
          labels: config.labels,
          trusted,
        }),
      );
      const session = await supervisePi({
        command: deps.piCommand,
        cwd: repoRoot,
        agentDir: resolve(repoRoot, config.pi.agentDir),
        sessionDir: join(runDir, "sessions", "1"),
        skillPath: skill.path,
        promptPath,
        logPath: join(runDir, "session-1.log"),
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
        validateResult(value, allowed),
      );
      if (!parsed.ok) {
        warn(number, `${parsed.reason}; skipping.`);
        continue;
      }
      const { label, comment } = parsed.value;
      if (options.dryRun)
        output.stdout(JSON.stringify({ issue: number, label, comment }));
      else {
        await host.setLabels(
          number,
          [label],
          allowed.filter((value) => value !== label),
        );
        if (comment !== "")
          await host.commentIssue(number, `${KERNEL_COMMENT}\n${comment}`);
      }
      outcomes.push({ issue: number, label, applied: !options.dryRun });
    } catch (error) {
      warn(number, error instanceof Error ? error.message : String(error));
    }
  }
  return outcomes;
}
