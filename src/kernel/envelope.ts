import { readFileSync } from "node:fs";
import type { RetroEnd, RetroScope } from "./retro-record.ts";
import { join } from "node:path";
import { findPackageRoot } from "../package-root.ts";
import type { LabelsConfig } from "../config/config.ts";
import type { CommandLimits } from "../pi/command-timeout-extension.ts";
import type {
  HostProviderId,
  Issue,
  IssueDependency,
  Repository,
} from "../host/types.ts";
import type { Facts } from "./facts.ts";
import { parsePlanningBranch } from "./names.ts";
import type { Phase } from "./phase.ts";
import { previousStallsFact } from "./stall-text.ts";
import type { Stall } from "./stall-watch.ts";

export type RunEnvelopeInput = {
  repository: Repository;
  issue: Issue;
  phase: Phase;
  facts: Facts;
  skill: { name: string; path: string };
  /** The Session cap in minutes, or null for no cap and no Time limit line. */
  timeoutMinutes: number | null;
  /** The Command timeout limits, stated in an implementation or unattended planning envelope. */
  commandLimits: CommandLimits;
  /**
   * The Stall policy of an unattended phase session. `minutes` 0
   * means Stall stops are off and only Command timeouts count.
   */
  stallStop?: { minutes: number; maxStalls: number };
  /** The Stalls of the last Run attempt that stopped at the Stall limit. */
  previousStalls?: Stall[];
  trusted: string[];
  interactive?: boolean;
  /** The session resolves only `facts.mergeConflict`; see merge-conflicts.ts. */
  conflictResolution?: boolean;
};
export type TriageEnvelopeInput = {
  repository: Repository;
  issue: Issue;
  dependencies: IssueDependency[];
  skill: { name: string; path: string };
  labels: LabelsConfig;
  trusted: string[];
};
export const UNTRUSTED_BEGIN = "<<<UNTRUSTED ISSUE CONTENT BEGIN>>>";
export const UNTRUSTED_END = "<<<UNTRUSTED ISSUE CONTENT END>>>";

export function renderIssue(
  issue: Issue,
  trusted: string[],
  dependencies?: IssueDependency[],
): string {
  const content = [
    `# Issue #${issue.number}: ${issue.title}`,
    `URL: ${issue.url}\nAuthor: ${issue.author}\nCreated: ${issue.createdAt}\nState: ${issue.state}\nLabels: ${issue.labels.join(", ")}`,
    ...(dependencies === undefined
      ? []
      : [
          `Dependencies: ${dependencies.length ? dependencies.map((dependency) => `${dependency.repository}#${dependency.number} (${dependency.state})`).join(", ") : "none"}`,
        ]),
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

function minutes(seconds: number): string {
  return String(Number((seconds / 60).toFixed(2)));
}

/** The Command timeout fact line, or "" when there is nothing to state. */
function commandTimeoutFact(limits: CommandLimits): string {
  const { defaultSeconds, maxSeconds } = limits;
  if (defaultSeconds <= 0 && maxSeconds <= 0) return "";
  const text =
    defaultSeconds > 0
      ? `bash calls get a ${minutes(defaultSeconds)}-minute timeout by default. ${
          maxSeconds > 0
            ? `Full builds or test suites can ask for up to ${minutes(maxSeconds)} minutes.`
            : "A call can ask for a longer timeout."
        }`
      : `bash calls have no default timeout. A call can ask for up to ${minutes(maxSeconds)} minutes.`;
  return `\n- Command timeout: ${text}`;
}

function stallFact(stall: RunEnvelopeInput["stallStop"]): string {
  if (!stall) return "";
  const count =
    stall.maxStalls > 0 ? `After ${stall.maxStalls} stalls, or a` : "A";
  if (stall.minutes > 0)
    return `\n- Stall stop: when the session and its subagents show no activity for ${minutes(stall.minutes * 60)} minutes, outside a running bash call, Patchmill stops the turn and asks you to continue another way. ${count} second stall of the same command${stall.maxStalls > 0 ? "," : ""} ${stall.maxStalls > 0 ? "the run stops" : "stops the run"} as blocked.`;
  return `\n- Stalls: a command that times out is a stall. ${count} second timeout of the same command${stall.maxStalls > 0 ? "," : ""} ${stall.maxStalls > 0 ? "the run stops" : "stops the run"} as blocked.`;
}

export function renderRunEnvelope(input: RunEnvelopeInput): string {
  const { facts } = input;
  const interactivePlanning = input.interactive && input.phase === "planning";
  const laterGate =
    interactivePlanning &&
    facts.stage !== "implementation" &&
    parsePlanningBranch(input.issue.number, facts.branch)?.stage !==
      facts.stage;
  // Pushed documents count as reviewed. Patchmill pushes them after the
  // maintainer confirms, so a pause before then cannot skip the review.
  const reviewed = interactivePlanning && facts.stage === "implementation";
  return renderTemplate("run-envelope.md", {
    commitRules: laterGate
      ? "Commit your work before submitting, but do not push. Only Patchmill pushes this gated document to the implementation branch, after recorded approval. This overrides the skill's push requirement."
      : reviewed
        ? "Commit your work before submitting, but do not push. Only Patchmill pushes the documents to the implementation branch, after the maintainer reviews them. This overrides the skill's push requirement."
        : "Commit and push your work before you finish.",
    waitRules: interactivePlanning
      ? ""
      : "\n- Do not end your turn while a subagent run that you started or resumed is still running. Wait for it in the same turn with `bg_wait({ id, stopOnAttention: false })`, then read its result.",
    humanRules: interactivePlanning
      ? "A maintainer is present in this chat. Ask them your questions here and wait for their answers. Do not return `needs-input` for questions."
      : "Put questions in the summary.\n- End with the JSON block. Do not put text after it.",
    resultRules: interactivePlanning
      ? `When the document is ready and committed${laterGate || reviewed ? " but not pushed" : " and pushed"}, call \`patchmill_submit_planning_result\` with \`status\`, \`summary\` and \`highlights\` (2–5 single lines of at most 72 characters each about the document’s main decisions; no file paths, branch, commit or check results). Its dialog asks the maintainer to approve, so do not ask for approval or review in the chat first. Do not end with a JSON block.`
      : 'Return only the fields `status` and `summary` in a final `json` block. Use\n`done`, `needs-input`, or `failed` for `status`. Use a string for `summary`.\n\nThis block is the required last step. Patchmill reads the result only from\nthis block. Write it after all other work and after every subagent has\nfinished. If the runtime asks you to write your findings to a file, still end\nyour last message with this block.\n\n```json\n{ "status": "done", "summary": "Describe the result." }\n```',
    planningRules: interactivePlanning
      ? "\n\nInteractive planning overrides the skill's PR-before-submit and merge-only rules. The submit tool's single select dialog is the only approval question: it records approval and the PR choice. Supply single-line highlights of decisions (at most 72 characters each), not file paths, branch, commit or check results; keep the full result in summary, which is not displayed in the dialog. If the maintainer declines, ask what to change. Do not open a planning PR before submitting. Open it only when feedback says the maintainer chose PR and the PR is missing, then submit again."
      : "",
    repository: `${input.repository.owner}/${input.repository.repo}`,
    phase: input.phase,
    skillName: input.skill.name,
    skillPath: input.skill.path,
    worktree: facts.worktree,
    branch: facts.branch,
    base: facts.baseBranch,
    parentSpec: facts.parentSpec
      ? `\n- Parent spec: ${facts.parentSpec.path} on origin/${facts.baseBranch} (from issue #${facts.parentSpec.issue}; approved and read-only; read it with \`git show '${`origin/${facts.baseBranch}:${facts.parentSpec.path}`.replaceAll("'", "'\\''")}'\`, because the worktree copy can be missing or old)`
      : "",
    parentSpecRules: facts.parentSpec
      ? input.phase === "planning"
        ? `\n\nThe parent spec is the approved design for this issue. Do not change it. If this issue has no spec yet, write it at the Spec path. Link to the parent spec, name the parent sections this issue delivers, and record only decisions the parent spec leaves open. If there are none, say so. If the parent spec is wrong or conflicts with this issue, ${interactivePlanning ? "ask the maintainer in this chat" : "stop and return `needs-input`"} instead of choosing.`
        : "\n\nIf the parent spec must change, do not change it; stop and return `needs-input`."
      : "",
    spec: facts.specPath ?? `expected: ${facts.expectedSpecPath}`,
    plan: facts.planPath ?? `expected: ${facts.expectedPlanPath}`,
    pullRequest: facts.pullRequest
      ? `${facts.pullRequest.url} (${facts.pullRequest.state})`
      : "none",
    mergeConflict: mergeConflictFact(input),
    stage: facts.stage,
    gate:
      facts.stage === "implementation"
        ? "not required; keep planning artifacts in the implementation PR"
        : interactivePlanning
          ? parsePlanningBranch(input.issue.number, facts.branch)?.stage ===
            facts.stage
            ? "required; submit for approval and the PR choice"
            : "required; submit for approval only, no PR option: a planning PR would carry the earlier unmerged document. Write later documents on this implementation branch"
          : `required; publish the ${facts.stage} PR and stop until it is merged`,
    timeLimit: timeLimitFact(input.timeoutMinutes),
    commandTimeout:
      (input.phase === "implementation" || !input.interactive
        ? commandTimeoutFact(input.commandLimits) +
          (input.interactive ? "" : stallFact(input.stallStop))
        : "") +
      (input.previousStalls?.length
        ? `\n${previousStallsFact(input.previousStalls)}`
        : ""),
    issue: renderIssue(input.issue, input.trusted),
  });
}

/** The Session cap line. A cap above the Cap warning lead also names it. */
function timeLimitFact(minutes: number | null): string {
  if (minutes === null) return "";
  return minutes > 5
    ? `\n- Time limit: ${minutes} minutes. About 5 minutes before the end, Patchmill asks you to stop new work and hand off.`
    : `\n- Time limit: ${minutes} minutes`;
}

function mergeConflictFact(input: RunEnvelopeInput): string {
  const conflict = input.facts.mergeConflict;
  if (!conflict || input.phase !== "implementation") return "";
  const fact = `the pull request conflicts with origin/${input.facts.baseBranch} at ${conflict.baseSha} in: ${conflict.files.join(", ")}.`;
  return input.conflictResolution
    ? `\n- Merge conflict: ${fact} This session is a Conflict resolution: resolve only this conflict, as the skill's Merge conflicts section says.`
    : `\n- Merge conflict: ${fact} Merge the base branch first, as the skill's Merge conflicts section says, then continue your normal work.`;
}

export function renderTriageEnvelope(input: TriageEnvelopeInput): string {
  return renderTemplate("triage-envelope.md", {
    repository: `${input.repository.owner}/${input.repository.repo}`,
    skillName: input.skill.name,
    skillPath: input.skill.path,
    ready: input.labels.ready,
    needsInfo: input.labels.needsInfo,
    unsuitable: input.labels.unsuitable,
    issue: renderIssue(input.issue, input.trusted, input.dependencies),
  });
}

export type RetroEnvelopeInput = {
  repository: { owner: string; repo: string };
  provider: HostProviderId;
  skillPath: string;
  issue: { number: number; url?: string };
  scope: RetroScope;
  sourceMap: string;
  /** Interactive Retros ask the maintainer before filing. */
  interactive: boolean;
};

function retroEndText(end: RetroEnd): string {
  return end.kind === "merged"
    ? `merged, implementation pull request #${end.pullRequest}`
    : `stopped with Needs Info in Run attempt ${end.runId}`;
}

/** The Retro instructions: the unattended prompt, or the interactive tool result. */
export function renderRetroEnvelope(input: RetroEnvelopeInput): string {
  const { scope } = input;
  const filing = scope.mode === "file-issues";
  return renderTemplate("retro-envelope.md", {
    repository: `${input.repository.owner}/${input.repository.repo}`,
    skillPath: input.skillPath,
    issue: String(input.issue.number),
    issueUrl: input.issue.url ?? "no URL",
    end: retroEndText(scope.end),
    runIds: scope.runIds.join(", "),
    retroId: scope.retroId,
    provider: input.provider,
    cli: input.provider === "forgejo-tea" ? "tea" : "gh",
    mode: scope.mode,
    findings: scope.findings,
    modeRules: filing
      ? input.interactive
        ? "Filing is allowed. Show the findings to the maintainer and ask before you file or comment. Host writes are limited to new `retro` issues, comments on open `retro` issues, and the `retro` label."
        : "Filing is allowed. File or comment only for findings worth a maintainer's time. Host writes are limited to new `retro` issues, comments on open `retro` issues, and the `retro` label."
      : "Mode findings-only: do not write to the host. Do not create issues, comments, or labels. Only write the findings file.",
    finish: input.interactive
      ? "When the Retro is done, confirm any issue URLs to the maintainer, then call `patchmill_finish_retro` with a one-line summary. In a Web session, then call `patchmill_end_session`."
      : 'Nobody answers questions in this session. End with a fenced `json` block with exactly the fields `status` (`done` or `failed`) and `summary`. Write no text after it.\n\n```json\n{ "status": "done", "summary": "Wrote the findings file." }\n```',
    sourceMap: input.sourceMap.trimEnd(),
  });
}
