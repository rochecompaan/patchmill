import type { IssueCommentSummary } from "../issue/types.ts";
import type { IssueHostProvider } from "../host/types.ts";
import type { PatchmillIssueStateConfig } from "../config/types.ts";
import { isIssueWorkflowRole, uniqueWorkflowRoles } from "./roles.ts";
import type {
  IssueStateProvider,
  IssueStateTransition,
  IssueWorkflowRole,
} from "./types.ts";

function parseScalarPatchmillValue(
  line: string,
): IssueWorkflowRole[] | undefined {
  const match = line.match(/^Patchmill:\s*(\S+)\s*$/u);
  if (!match) return undefined;
  const role = match[1];
  return role && isIssueWorkflowRole(role) ? [role] : undefined;
}

function parsePatchmillList(lines: string[]): IssueWorkflowRole[] | undefined {
  if (lines[0] !== "Patchmill:") return undefined;
  const roles: IssueWorkflowRole[] = [];
  for (const line of lines.slice(1)) {
    const match = line.match(/^ {2}-\s*(\S+)\s*$/u);
    if (!match) return undefined;
    const role = match[1];
    if (!role || !isIssueWorkflowRole(role)) return undefined;
    roles.push(role);
  }
  return roles.length > 0 ? roles : undefined;
}

export function parsePatchmillStateComment(
  body: string,
): IssueWorkflowRole[] | undefined {
  const normalized = body.replace(/\r\n/gu, "\n");
  if (!normalized.startsWith("---\n")) return undefined;
  const closing = normalized.indexOf("\n---", 4);
  if (closing === -1) return undefined;
  const afterClosing = normalized.slice(closing + "\n---".length);
  if (afterClosing.length > 0 && !afterClosing.startsWith("\n")) {
    return undefined;
  }

  const frontmatter = normalized.slice(4, closing);
  const lines = frontmatter.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;

  let roles: IssueWorkflowRole[] | undefined;
  if (lines.length === 1) {
    roles = parseScalarPatchmillValue(lines[0]!);
  } else {
    roles = parsePatchmillList(lines);
  }
  if (!roles) return undefined;

  const unique = uniqueWorkflowRoles(roles);
  return unique.length === roles.length ? unique : undefined;
}

function createdMillis(comment: IssueCommentSummary): number | undefined {
  if (!comment.created) return undefined;
  const millis = Date.parse(comment.created);
  return Number.isFinite(millis) ? millis : undefined;
}

export function resolveCommentIssueWorkflowRoles(
  comments: readonly IssueCommentSummary[] | undefined,
  trustedAuthors: readonly string[],
): IssueWorkflowRole[] {
  const trusted = new Set(trustedAuthors);
  const candidates = (comments ?? []).flatMap((comment, index) => {
    if (!comment.authorLogin || !trusted.has(comment.authorLogin)) return [];
    const roles = parsePatchmillStateComment(comment.body);
    return roles ? [{ index, comment, roles }] : [];
  });
  if (candidates.length === 0) return [];

  const allHaveCreated = candidates.every(
    (candidate) => createdMillis(candidate.comment) !== undefined,
  );
  const selected = allHaveCreated
    ? candidates.reduce((latest, candidate) =>
        createdMillis(candidate.comment)! >= createdMillis(latest.comment)!
          ? candidate
          : latest,
      )
    : candidates[candidates.length - 1]!;
  return selected.roles;
}

export function formatPatchmillStateComment(
  roles: readonly IssueWorkflowRole[],
  message?: string | undefined,
): string {
  const unique = uniqueWorkflowRoles(roles);
  const frontmatter =
    unique.length === 1
      ? `---\nPatchmill: ${unique[0]}\n---`
      : `---\nPatchmill:\n${unique.map((role) => `  - ${role}`).join("\n")}\n---`;
  return message === undefined || message.length === 0
    ? frontmatter
    : `${frontmatter}\n\n${message}`;
}

export async function createCommentIssueStateProvider(
  host: Pick<IssueHostProvider, "commentIssue" | "trustedTriageCommentAuthors">,
  config: Extract<PatchmillIssueStateConfig, { provider: "comments" }>,
): Promise<IssueStateProvider> {
  const trustedAuthors =
    config.trustedAuthors ?? (await host.trustedTriageCommentAuthors());
  if (trustedAuthors.length === 0) {
    throw new Error(
      "Comment issue state requires a trusted author. Set issueState.trustedAuthors or authenticate the host CLI.",
    );
  }

  return {
    resolveRoles(issue) {
      return {
        roles: resolveCommentIssueWorkflowRoles(issue.comments, trustedAuthors),
      };
    },
    async setRoles(transition: IssueStateTransition) {
      await host.commentIssue(
        transition.issue.number,
        formatPatchmillStateComment(transition.roles, transition.message),
      );
    },
  };
}
