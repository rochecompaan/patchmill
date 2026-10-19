import type { Repository } from "../host/types.ts";
import { planningGateComment } from "./comments.ts";
import type { Facts } from "./facts.ts";
import type { Phase } from "./phase.ts";
import type { PiSession } from "./pi-supervisor.ts";
import type { ParsedResult } from "./result.ts";

export type OutcomeLabel = "done" | "needsInfo" | "inProgress";
export type Outcome =
  | { kind: "advance" }
  | { kind: "stop"; label: OutcomeLabel; comment: string; warnings: string[] };
export type VerifyInput = {
  issue: number;
  repository: Pick<Repository, "owner" | "repo">;
  phase: Phase;
  result: ParsedResult;
  session: Pick<PiSession, "exitCode" | "timedOut" | "aborted">;
  facts: Facts;
  logPath: string;
  uncommitted: boolean;
  unpushed: number | "no-remote-branch";
};

export function closesIssue(
  body: string,
  issue: number,
  repository: Pick<Repository, "owner" | "repo">,
): boolean {
  const references = body.matchAll(
    new RegExp(
      `\\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\\s+(?:([\\w.-]+\\/[\\w.-]+))?#${issue}(?!\\d)`,
      "gi",
    ),
  );
  const slug = `${repository.owner}/${repository.repo}`.toLowerCase();
  return [...references].some(
    (match) => !match[2] || match[2].toLowerCase() === slug,
  );
}

export function verifyOutcome(input: VerifyInput): Outcome {
  const { result, session, facts } = input;
  const failures: string[] = [];
  if (session.timedOut) failures.push("The session timed out.");
  if (session.aborted) failures.push("The session was aborted.");
  if (!result.ok) failures.push(result.reason);

  let label: OutcomeLabel = "needsInfo";
  let reason: string;
  if (failures.length > 0) {
    reason = `${failures.join(" ")} Log: ${input.logPath}`;
  } else if (result.ok && result.result.status !== "done") {
    reason = `The agent reported ${result.result.status}.`;
  } else if (input.phase === "planning") {
    const missing: string[] = [];
    if (!facts.remoteBranchExists)
      missing.push("The remote branch does not exist.");
    if (!facts.specPath) missing.push("The spec path is missing.");
    if (facts.stage !== "spec" && !facts.planPath)
      missing.push("The plan path is missing.");
    if (facts.stage !== "implementation") {
      if (!facts.pullRequest)
        missing.push("No planning pull request exists for the branch.");
      else {
        if (facts.pullRequest.state === "closed")
          missing.push("The planning pull request is closed, not merged.");
        if (facts.pullRequest.headBranch !== facts.branch)
          missing.push(
            "The planning pull request head does not match the branch.",
          );
      }
    }
    if (
      facts.pullRequest?.state === "open" &&
      closesIssue(facts.pullRequest.body, input.issue, input.repository)
    ) {
      missing.push(
        `The planning pull request must not close #${input.issue}. Replace the closing reference with Refs #${input.issue} before merging it.`,
      );
    }
    if (missing.length > 0) {
      reason = `The claim was not verified. ${missing.join(" ")}`;
    } else if (facts.stage !== "implementation") {
      label = "inProgress";
      reason = planningGateComment(facts);
    } else {
      return { kind: "advance" };
    }
  } else {
    const pr = facts.pullRequest;
    const missing: string[] = [];
    if (!pr) {
      missing.push("No pull request exists for the branch.");
    } else {
      if (pr.state !== "open")
        missing.push(`The pull request is ${pr.state}, not open.`);
      if (pr.draft) missing.push("The pull request is a draft.");
      if (pr.headBranch !== facts.branch) {
        missing.push(
          `The pull request head does not match branch ${facts.branch}.`,
        );
      }
      if (!closesIssue(pr.body, input.issue, input.repository)) {
        missing.push(`The pull request body does not close #${input.issue}.`);
      }
    }
    if (missing.length > 0) {
      reason = `The claim was not verified. ${missing.join(" ")}`;
    } else {
      label = "done";
      reason = "The pull request was verified.";
    }
  }

  const warnings: string[] = [];
  if (input.uncommitted) warnings.push("uncommitted changes in the worktree");
  if (input.unpushed === "no-remote-branch" || input.unpushed > 0) {
    warnings.push("unpushed commits");
  }
  const summary = result.ok ? result.result.summary : "";
  return {
    kind: "stop",
    label,
    comment: [reason, summary, `Exit code: ${session.exitCode}`]
      .filter(Boolean)
      .join("\n\n"),
    warnings,
  };
}
