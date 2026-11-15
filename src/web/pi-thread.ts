import type { ThreadEvent, TextBlock } from "./api-types.ts";
import { object, timestamp } from "./run-files.ts";

function text(content: unknown, attachmentNotice = false): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((b: unknown) => {
      if (!object(b)) return [];
      if (b.type === "text" && typeof b.text === "string") return [b.text];
      return attachmentNotice && b.type !== "thinking"
        ? ["[Nontext output not shown.]"]
        : [];
    })
    .join("\n");
}
function shortened(value: string): string {
  const chars = Array.from(value);
  return chars.length > 8000
    ? chars.slice(0, 8000).join("") + "\nOutput shortened."
    : value;
}
const blocks = (value: string): readonly TextBlock[] => [
  { kind: "paragraph", content: [{ kind: "text", text: value }] },
];

/** Normalize only the main session. Tool results attach at their call position. */
export function projectPiThread(input: {
  records: readonly unknown[];
  prefix: string;
  cutoff?: string;
  collapseFirstUser: boolean;
  active?: boolean;
  seen: Set<string>;
}): ThreadEvent[] {
  const header = input.records.find(
    (r) => object(r) && r.type === "session" && timestamp(r.timestamp),
  );
  const cutoff =
    input.cutoff ??
    (object(header) && timestamp(header.timestamp)
      ? header.timestamp
      : undefined);
  const records = input.records.filter(
    (r): r is Record<string, unknown> =>
      object(r) &&
      r.type === "message" &&
      object(r.message) &&
      !(
        cutoff &&
        timestamp(r.timestamp) &&
        Date.parse(r.timestamp) < Date.parse(cutoff)
      ),
  );
  const results = new Map<string, Record<string, unknown>>();
  for (const r of records) {
    const m = r.message as Record<string, unknown>;
    if (m.role === "toolResult" && typeof m.toolCallId === "string")
      results.set(m.toolCallId, m);
  }
  const events: ThreadEvent[] = [];
  let firstUser = true;
  for (const [index, r] of records.entries()) {
    const m = r.message as Record<string, unknown>;
    const key = typeof r.id === "string" ? JSON.stringify([r.id, m]) : null;
    if (key && input.seen.has(key)) continue;
    if (key) input.seen.add(key);
    const id = `${input.prefix}:${index}`;
    const at = timestamp(r.timestamp) ? r.timestamp : null;
    if (m.role === "user") {
      const value = text(m.content);
      if (!value) continue;
      const prompt =
        r.patchmillPrompt === true || (input.collapseFirstUser && firstUser);
      firstUser = false;
      events.push(
        prompt
          ? { id, at, kind: "prompt", text: value }
          : {
              id,
              at,
              kind: "message",
              author: "maintainer",
              role: "person",
              blocks: blocks(value),
              note: null,
            },
      );
    } else if (m.role === "assistant") {
      const content =
        typeof m.content === "string"
          ? [{ type: "text", text: m.content }]
          : m.content;
      if (!Array.isArray(content)) continue;
      for (const [blockIndex, b] of content.entries()) {
        if (!object(b)) continue;
        const blockId = `${id}:${blockIndex}`;
        if (b.type === "text" && typeof b.text === "string" && b.text)
          events.push({
            id: blockId,
            at,
            kind: "message",
            author: "agent",
            role: "agent",
            blocks: blocks(b.text),
            note: null,
          });
        else if (
          b.type === "toolCall" &&
          typeof b.id === "string" &&
          typeof b.name === "string" &&
          object(b.arguments)
        ) {
          const result = results.get(b.id);
          events.push({
            id: blockId,
            at,
            kind: "tool",
            name: b.name,
            arguments: b.arguments,
            result: result
              ? shortened(text(result.content, true))
              : input.active
                ? null
                : "Output not recorded.",
            state: result
              ? result.isError === true
                ? "failed"
                : "completed"
              : input.active
                ? "running"
                : "stopped",
          });
        }
      }
    }
  }
  return events;
}
