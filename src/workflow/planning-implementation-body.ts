export class PlanningImplementationBodyError extends Error {
  readonly reason = "closing-reference" as const;

  constructor() {
    super(
      "Implementation pull request is missing an effective closing reference",
    );
    this.name = "PlanningImplementationBodyError";
  }
}

function effectiveTopLevelLines(body: string): readonly string[] {
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const output: string[] = [];
  let fence: string | undefined;
  let lazyContainer = false;
  for (const line of lines) {
    const topLevel = line.replace(/^[ ]{0,3}/u, "");
    if (line.trim() === "") {
      lazyContainer = false;
      output.push(line);
      continue;
    }
    if (fence !== undefined) {
      const closing = /^(?<fence>`+|~+)[ \t]*$/u.exec(topLevel)?.groups?.fence;
      if (
        closing !== undefined &&
        closing[0] === fence[0] &&
        closing.length >= fence.length
      )
        fence = undefined;
      continue;
    }
    const openingMatch = /^(?<fence>`{3,}|~{3,})(?<info>.*)$/u.exec(topLevel);
    const opening = openingMatch?.groups?.fence;
    const info = openingMatch?.groups?.info;
    if (opening !== undefined && (opening[0] !== "`" || !info!.includes("`"))) {
      fence = opening;
      continue;
    }
    if (line.startsWith(">") || /^(?:[ \t]{4}|\t|[-*+]\s)/u.test(line)) {
      lazyContainer = line.startsWith(">") || /^(?:[-*+]\s)/u.test(line);
      continue;
    }
    if (lazyContainer) continue;
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
