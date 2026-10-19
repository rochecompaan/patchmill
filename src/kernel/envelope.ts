import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot } from "../package-root.ts";
import type { LabelsConfig } from "../config/config.ts";
import type { Issue, Repository } from "../host/types.ts";
import type { Facts } from "./facts.ts";
import type { Phase } from "./phase.ts";

export type RunEnvelopeInput = {
  repository: Repository;
  issue: Issue;
  phase: Phase;
  facts: Facts;
  skill: { name: string; path: string };
  timeoutMinutes: number;
  trusted: string[];
};
export type TriageEnvelopeInput = {
  repository: Repository;
  issue: Issue;
  skill: { name: string; path: string };
  labels: LabelsConfig;
  trusted: string[];
};
export const UNTRUSTED_BEGIN = "<<<UNTRUSTED ISSUE CONTENT BEGIN>>>";
export const UNTRUSTED_END = "<<<UNTRUSTED ISSUE CONTENT END>>>";

export function renderIssue(issue: Issue, trusted: string[]): string {
  const content = [
    `# Issue #${issue.number}: ${issue.title}`,
    `URL: ${issue.url}\nAuthor: ${issue.author}\nCreated: ${issue.createdAt}\nState: ${issue.state}\nLabels: ${issue.labels.join(", ")}`,
    issue.body,
    ...issue.comments.map(
      (comment) =>
        `### Comment by ${comment.author} (${trusted.includes(comment.author) ? "trusted" : "untrusted"}, ${comment.createdAt})\n\n${comment.body}`,
    ),
  ].join("\n\n");
  const escaped = content
    .replaceAll(UNTRUSTED_BEGIN, `\\${UNTRUSTED_BEGIN}`)
    .replaceAll(UNTRUSTED_END, `\\${UNTRUSTED_END}`);
  return `${UNTRUSTED_BEGIN}\n${escaped}\n${UNTRUSTED_END}`;
}

function renderTemplate(file: string, values: Record<string, string>): string {
  const root = findPackageRoot(import.meta.dirname);
  const template = readFileSync(join(root, "src", "kernel", file), "utf8");
  return template.replace(/\{\{(\w+)\}\}/g, (_token, name: string) => {
    const value = values[name];
    if (value === undefined)
      throw new Error(`Unknown envelope placeholder: ${name}`);
    return value;
  });
}

export function renderRunEnvelope(input: RunEnvelopeInput): string {
  const { facts } = input;
  return renderTemplate("run-envelope.md", {
    repository: `${input.repository.owner}/${input.repository.repo}`,
    phase: input.phase,
    skillName: input.skill.name,
    skillPath: input.skill.path,
    worktree: facts.worktree,
    branch: facts.branch,
    base: facts.baseBranch,
    spec: facts.specPath ?? `expected: ${facts.expectedSpecPath}`,
    plan: facts.planPath ?? `expected: ${facts.expectedPlanPath}`,
    pullRequest: facts.pullRequest
      ? `${facts.pullRequest.url} (${facts.pullRequest.state})`
      : "none",
    stage: facts.stage,
    gate:
      facts.stage === "implementation"
        ? "not required; keep planning artifacts in the implementation PR"
        : `required; publish the ${facts.stage} PR and stop until it is merged`,
    timeoutMinutes: String(input.timeoutMinutes),
    issue: renderIssue(input.issue, input.trusted),
  });
}

export function renderTriageEnvelope(input: TriageEnvelopeInput): string {
  return renderTemplate("triage-envelope.md", {
    repository: `${input.repository.owner}/${input.repository.repo}`,
    skillName: input.skill.name,
    skillPath: input.skill.path,
    ready: input.labels.ready,
    needsInfo: input.labels.needsInfo,
    unsuitable: input.labels.unsuitable,
    blocked: input.labels.blocked,
    issue: renderIssue(input.issue, input.trusted),
  });
}
