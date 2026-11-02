import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findPackageRoot } from "../package-root.ts";
import type { LabelsConfig } from "../config/config.ts";
import type { Issue, Repository } from "../host/types.ts";
import type { Facts } from "./facts.ts";
import { planningBranchName } from "./names.ts";
import type { Phase } from "./phase.ts";

export type RunEnvelopeInput = {
  repository: Repository;
  issue: Issue;
  phase: Phase;
  facts: Facts;
  skill: { name: string; path: string };
  timeoutMinutes: number;
  trusted: string[];
  interactive?: boolean;
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
  const interactivePlanning = input.interactive && input.phase === "planning";
  const laterGate =
    interactivePlanning &&
    facts.stage !== "implementation" &&
    facts.branch !== planningBranchName(input.issue.number, facts.stage);
  return renderTemplate("run-envelope.md", {
    commitRules: laterGate
      ? "Commit your work before submitting, but do not push. Only Patchmill pushes this gated document to the implementation branch, after recorded approval. This overrides the skill's push requirement."
      : "Commit and push your work before you finish.",
    humanRules: interactivePlanning
      ? "A maintainer is present in this chat. Ask them your questions here and wait for their answers. Do not return `needs-input` for questions."
      : "Put questions in the summary.\n- End with the JSON block. Do not put text after it.",
    resultRules: interactivePlanning
      ? `When the maintainer agrees and your work is committed${laterGate ? " but not pushed" : " and pushed"}, call \`patchmill_submit_planning_result\` with \`status\` and \`summary\`. Do not end with a JSON block.`
      : 'Return only the fields `status` and `summary` in a final `json` block. Use\n`done`, `needs-input`, or `failed` for `status`. Use a string for `summary`.\n\n```json\n{ "status": "done", "summary": "Describe the result." }\n```',
    planningRules: interactivePlanning
      ? "\n\nInteractive planning overrides the skill's PR-before-submit and merge-only rules. Ask whether the maintainer approves a required gate document, or has reviewed ungated documents. The submit tool records approval and the PR choice. Do not open a planning PR before submitting. Open it only when feedback says the maintainer chose PR and the PR is missing, then submit again."
      : "",
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
        : interactivePlanning
          ? facts.branch === planningBranchName(input.issue.number, facts.stage)
            ? "required; ask for approval in the chat, then submit for approval and the PR choice"
            : "required; chat approval only, no PR option: a planning PR would carry the earlier unmerged document. Write later documents on this implementation branch"
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
