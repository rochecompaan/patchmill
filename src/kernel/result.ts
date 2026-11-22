export type AgentStatus = "done" | "needs-input" | "failed";
export type AgentResult = { status: AgentStatus; summary: string };
export type ParsedResult =
  | { ok: true; result: AgentResult }
  | { ok: false; reason: string; missing?: true };

export const RESULT_REMINDER =
  "Your last message has no final result block. Do not do more work. Reply with only the final fenced `json` block, with the fields `status` and `summary`, as the run envelope describes.";
export const MISSING_RESULT_REASON = "The worker ended without a result block.";
export const REMINDED_RESULT_REASON =
  "The worker ended without a result block, also after a reminder.";

export function lastJsonBlock(text: string): string | undefined {
  const lines = text.replace(/\r\n?|\n/g, "\n").split("\n");
  let last: string | undefined;

  for (let start = 0; start < lines.length; start += 1) {
    const opening = lines[start];
    if (opening === undefined || !/^```[ \t]*json[ \t]*$/i.test(opening)) {
      continue;
    }
    for (let end = start + 1; end < lines.length; end += 1) {
      const closing = lines[end];
      if (closing !== undefined && /^```[ \t]*$/.test(closing)) {
        last = lines.slice(start + 1, end).join("\n");
        start = end;
        break;
      }
    }
  }

  return last;
}

export function hasResultBlock(text: string): boolean {
  return lastJsonBlock(text) !== undefined;
}

export function parseJsonBlock<T>(
  stdout: string,
  validate: (value: unknown) => T | string,
): { ok: true; value: T } | { ok: false; reason: string } {
  const block = lastJsonBlock(stdout);
  if (block === undefined) return { ok: false, reason: "no result" };

  let value: unknown;
  try {
    value = JSON.parse(block);
  } catch (error) {
    return {
      ok: false,
      reason: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const result = validate(value);
  return typeof result === "string"
    ? { ok: false, reason: result }
    : { ok: true, value: result };
}

function validateAgentResult(value: unknown): AgentResult | string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "result is not a JSON object";
  }

  const result = value as Record<string, unknown>;
  const unexpected = Object.keys(result).filter(
    (key) => key !== "status" && key !== "summary",
  );
  if (unexpected.length > 0) {
    return `unexpected field ${unexpected.map((key) => JSON.stringify(key)).join(", ")}`;
  }
  if (
    result.status !== "done" &&
    result.status !== "needs-input" &&
    result.status !== "failed"
  ) {
    return "status must be one of done, needs-input, failed";
  }
  if (typeof result.summary !== "string") return "summary must be a string";

  return { status: result.status, summary: result.summary };
}

/**
 * Parse the final result block. `reminded` says that the worker already got
 * the Result reminder, so a missing block gets the reminded reason.
 */
export function parseAgentResult(
  stdout: string,
  options: { reminded?: boolean } = {},
): ParsedResult {
  if (!hasResultBlock(stdout)) {
    return {
      ok: false,
      reason: options.reminded ? REMINDED_RESULT_REASON : MISSING_RESULT_REASON,
      missing: true,
    };
  }
  const parsed = parseJsonBlock(stdout, validateAgentResult);
  return parsed.ok ? { ok: true, result: parsed.value } : parsed;
}
