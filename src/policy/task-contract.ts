import { isAbsolute, join } from "node:path";

export type PatchmillPiTaskContract = {
  todoRoot: string;
  todoTitlePattern: string;
  todoTags: string[];
  planTodoBodyRequirements: string[];
  implementationTodoBodyRequirements: string[];
  doneStatuses: string[];
  planTaskHeadingPattern: string;
  openTaskTodosBlockFinalHandoff: boolean;
};

export const DEFAULT_PI_TASK_CONTRACT: PatchmillPiTaskContract = {
  todoRoot: ".pi/todos",
  todoTitlePattern: "issue-<number>-task-<two-digit-number>-<slug>",
  todoTags: ["agent-issue", "issue-<number>"],
  planTodoBodyRequirements: [
    "purpose",
    "the source plan checklist item",
    "checkpoint details",
    "any last error or validation notes known at planning time",
  ],
  implementationTodoBodyRequirements: [
    "purpose",
    "the source plan checklist item",
    "checkpoint details",
    "the latest last error or validation notes",
  ],
  doneStatuses: ["closed", "completed", "done"],
  planTaskHeadingPattern: "## Task <number>: <label>",
  openTaskTodosBlockFinalHandoff: true,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacePlaceholderCapture(
  pattern: string,
  placeholder: string,
  groupName: string,
  capturePattern: string,
): string {
  let namedCaptureInserted = false;
  return pattern.replace(new RegExp(escapeRegExp(placeholder), "g"), () => {
    if (namedCaptureInserted) return `\\k<${groupName}>`;
    namedCaptureInserted = true;
    return `(?<${groupName}>${capturePattern})`;
  });
}

export function resolveTodoRoot(repoRoot: string, contract: PatchmillPiTaskContract): string {
  return isAbsolute(contract.todoRoot) ? contract.todoRoot : join(repoRoot, contract.todoRoot);
}

export function renderIssueTodoTitlePattern(
  contract: PatchmillPiTaskContract,
  issueNumber: number,
): string {
  return contract.todoTitlePattern
    .replaceAll("<issue-number>", String(issueNumber))
    .replaceAll("<number>", String(issueNumber));
}

export function renderIssueTodoTags(
  contract: PatchmillPiTaskContract,
  issueNumber: number,
): string[] {
  return contract.todoTags.map((tag) =>
    tag.replaceAll("<issue-number>", String(issueNumber)).replaceAll("<number>", String(issueNumber)),
  );
}

export function todoTitlePatternIncludesIssueNumber(contract: PatchmillPiTaskContract): boolean {
  return contract.todoTitlePattern.includes("<issue-number>") || contract.todoTitlePattern.includes("<number>");
}

export function renderIssueTodoTitleGlob(
  contract: PatchmillPiTaskContract,
  issueNumber: number,
): string {
  const titlePattern = renderIssueTodoTitlePattern(contract, issueNumber);
  const firstPlaceholderIndex = [titlePattern.indexOf("<two-digit-number>"), titlePattern.indexOf("<slug>")]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  if (firstPlaceholderIndex === undefined) return titlePattern;
  return `${titlePattern.slice(0, firstPlaceholderIndex)}*`;
}

export function compileIssueTodoTitlePattern(
  contract: PatchmillPiTaskContract,
  issueNumber: number,
): RegExp {
  let pattern = escapeRegExp(renderIssueTodoTitlePattern(contract, issueNumber));
  pattern = replacePlaceholderCapture(pattern, "<two-digit-number>", "taskNumber", "\\d{2}");
  pattern = replacePlaceholderCapture(pattern, "<slug>", "taskSlug", ".+");
  return new RegExp(`^${pattern}$`);
}

export function issueTodoStatusDone(
  contract: PatchmillPiTaskContract,
  status: string | undefined,
): boolean {
  return status !== undefined && contract.doneStatuses.includes(status);
}

export function compilePlanTaskHeadingPattern(contract: PatchmillPiTaskContract): RegExp {
  const pattern = contract.planTaskHeadingPattern.trim();
  if (pattern === DEFAULT_PI_TASK_CONTRACT.planTaskHeadingPattern) {
    return /^#{2,}\s+Task\s+(?<taskNumber>\d+)\s*:\s*(?<taskLabel>.+)$/gim;
  }

  const headingMatch = pattern.match(/^(#+)\s+/);
  const minHeadingLevel = headingMatch?.[1].length ?? 0;
  const template = headingMatch ? pattern.slice(headingMatch[0].length) : pattern;
  let bodyPattern = escapeRegExp(template);
  bodyPattern = replacePlaceholderCapture(bodyPattern, "<number>", "taskNumber", "\\d+");
  bodyPattern = replacePlaceholderCapture(bodyPattern, "<label>", "taskLabel", ".+");
  const prefix = minHeadingLevel > 0 ? `^#{${minHeadingLevel},}\\s+` : "^";
  return new RegExp(`${prefix}${bodyPattern}$`, "gim");
}
