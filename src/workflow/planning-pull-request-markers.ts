export const PLANNING_PR_WORKFLOW_VERSION = "planning-pr-v1" as const;

export type PlanningPhaseKind = "spec" | "plan" | "implementation";

export class PlanningPullRequestMarkerError extends Error {
  readonly reason: string;
  readonly marker: string;

  constructor(reason: string, marker: string) {
    super(`Planning pull request marker is invalid: ${reason}`);
    this.name = "PlanningPullRequestMarkerError";
    this.reason = reason;
    this.marker = marker;
  }
}

function assertPositiveIssueNumber(issueNumber: number): void {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new RangeError("Issue number must be a positive safe integer");
  }
}

export function renderPlanningPullRequestMarker(input: {
  issueNumber: number;
  phase: PlanningPhaseKind;
}): string {
  assertPositiveIssueNumber(input.issueNumber);
  return `<!-- patchmill:${PLANNING_PR_WORKFLOW_VERSION} issue=${input.issueNumber} phase=${input.phase} -->`;
}

const markerCandidatePattern = /<!--\s*patchmill:planning-pr-[\s\S]*?-->/gu;
const markerStartPattern = /<!--\s*patchmill:planning-pr-/gu;
const validMarkerPattern =
  /^<!-- patchmill:(planning-pr-v1) issue=([1-9]\d*) phase=(spec|plan|implementation) -->$/u;
const fencedCodeStartPattern = /^ {0,3}(`{3,}|~{3,})/u;
const fencedCodeEndPattern = /^ {0,3}(`+|~+)\s*$/u;
const indentedCodePattern = /^(?: {4}|\t)/u;
const containerPrefixPattern = /^(?: {0,3}> ?| {0,3}(?:[-+*]|\d+[.)])[ \t])/u;

function withoutMarkdownContainerPrefix(line: string): string {
  let prefix = containerPrefixPattern.exec(line);
  while (prefix !== null) {
    line = line.slice(prefix[0].length);
    prefix = containerPrefixPattern.exec(line);
  }
  return line;
}

function withoutMarkdownCodeBlocks(body: string): string {
  let fence: string | undefined;
  return body
    .split("\n")
    .map((line) => {
      const content = withoutMarkdownContainerPrefix(line);
      if (fence !== undefined) {
        const closingFence = content.match(fencedCodeEndPattern)?.[1];
        if (
          closingFence !== undefined &&
          closingFence[0] === fence[0] &&
          closingFence.length >= fence.length
        ) {
          fence = undefined;
        }
        return "";
      }
      const openingFence = content.match(fencedCodeStartPattern)?.[1];
      if (openingFence !== undefined) {
        fence = openingFence;
        return "";
      }
      return indentedCodePattern.test(content) ? "" : line;
    })
    .join("\n");
}

function isEscaped(value: string, index: number): boolean {
  let backslashCount = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && value[cursor] === "\\";
    cursor -= 1
  ) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}

function backtickRunEnd(value: string, start: number): number {
  let end = start;
  while (value[end] === "`") end += 1;
  return end;
}

function codeSpanEnd(
  value: string,
  start: number,
  delimiterLength: number,
): number | undefined {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (/^\r?\n[ \t]*\r?\n/u.test(value.slice(cursor))) return undefined;
    if (value[cursor] !== "`") continue;
    const end = backtickRunEnd(value, cursor);
    if (end - cursor === delimiterLength) return end;
    cursor = end - 1;
  }
  return undefined;
}

function withoutMarkdownCodeSpans(body: string): string {
  let visibleText = "";
  for (let cursor = 0; cursor < body.length; cursor += 1) {
    if (body[cursor] !== "`" || isEscaped(body, cursor)) {
      visibleText += body[cursor];
      continue;
    }
    const openerEnd = backtickRunEnd(body, cursor);
    const closerEnd = codeSpanEnd(body, openerEnd, openerEnd - cursor);
    if (closerEnd === undefined) {
      visibleText += body.slice(cursor, openerEnd);
      cursor = openerEnd - 1;
      continue;
    }
    visibleText += " ";
    cursor = closerEnd - 1;
  }
  return visibleText;
}

export function parsePlanningPullRequestMarker(body: string):
  | {
      workflowVersion: typeof PLANNING_PR_WORKFLOW_VERSION;
      issueNumber: number;
      phase: PlanningPhaseKind;
    }
  | undefined {
  const markerBody = withoutMarkdownCodeSpans(withoutMarkdownCodeBlocks(body));
  const candidates = markerBody.match(markerCandidatePattern) ?? [];
  const starts = markerBody.match(markerStartPattern) ?? [];
  if (starts.length === 0) return undefined;
  if (starts.length !== candidates.length) {
    throw new PlanningPullRequestMarkerError("malformed marker", markerBody);
  }
  if (candidates.length !== 1) {
    throw new PlanningPullRequestMarkerError(
      "multiple markers",
      candidates.join("\n"),
    );
  }
  const marker = candidates[0]!;
  const match = validMarkerPattern.exec(marker);
  if (!match) {
    throw new PlanningPullRequestMarkerError("unsupported marker", marker);
  }
  const issueNumber = Number(match[2]);
  if (!Number.isSafeInteger(issueNumber)) {
    throw new PlanningPullRequestMarkerError("invalid issue number", marker);
  }
  return {
    workflowVersion: PLANNING_PR_WORKFLOW_VERSION,
    issueNumber,
    phase: match[3] as PlanningPhaseKind,
  };
}
