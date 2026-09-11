import { markdownTopLevelLines } from "./planning-markdown-top-level-lines.ts";

export class PlanningImplementationBodyError extends Error {
  readonly reason = "closing-reference" as const;

  constructor() {
    super(
      "Implementation pull request is missing an effective closing reference",
    );
    this.name = "PlanningImplementationBodyError";
  }
}

function thematicBreak(line: string): boolean {
  if (/^(?:[ ]{4}|\t)/u.test(line)) return false;
  const markers = line.replace(/^[ ]{0,3}/u, "").replace(/[ \t]/gu, "");
  return /^(?:\*{3,}|-{3,}|_{3,})$/u.test(markers);
}

function lazyContainer(line: string): boolean {
  if (thematicBreak(line)) return false;
  return /^(?:[ ]{0,3}>|[ ]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+)/u.test(line);
}

function effectiveTopLevelLines(body: string): readonly string[] {
  const output: string[] = [];
  let inLazyContainer = false;
  for (const { line } of markdownTopLevelLines(body)) {
    if (line.trim() === "") {
      inLazyContainer = false;
      output.push(line);
      continue;
    }
    if (/^(?:[ \t]{4}|\t)/u.test(line)) continue;
    if (lazyContainer(line)) {
      inLazyContainer = true;
      continue;
    }
    if (inLazyContainer) continue;
    output.push(line);
  }
  return output;
}

export function assertImplementationClosingReference(
  body: string,
  issueNumber: number,
): void {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
    throw new RangeError("Issue number must be a positive safe integer");
  if (!effectiveTopLevelLines(body).includes(`Closes #${issueNumber}`))
    throw new PlanningImplementationBodyError();
}
