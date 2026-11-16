/** Status key that the background-work extension reports through `setStatus`. */
export const BACKGROUND_WORK_STATUS = "patchmill-background-work";

export const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

export type RpcContent = { type: string; text?: string };
export type RpcMessage = {
  role: string;
  content?: RpcContent[] | string;
  stopReason?: string;
  errorMessage?: string;
};
export type RpcRecord =
  | {
      type: "response";
      id?: string;
      command: string;
      success: boolean;
      data?: unknown;
      error?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: string;
      statusKey?: string;
      statusText?: string;
    }
  | { type: "extension_error"; extensionPath: string; error: string }
  | { type: "message_end"; message: RpcMessage }
  | { type: "agent_start" }
  | { type: "agent_settled" }
  | { type: string };

/**
 * Split a stream into JSONL records. Only `\n` ends a record, so U+2028 and
 * U+2029 inside JSON strings stay intact. Lines that are not JSON objects go to
 * `onText`.
 */
export function jsonlRecords(
  onRecord: (record: RpcRecord) => void,
  onText: (line: string) => void,
): (chunk: string) => void {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      let line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length > 0) {
        let record: unknown;
        try {
          record = JSON.parse(line);
        } catch {
          record = undefined;
        }
        if (record && typeof record === "object" && !Array.isArray(record))
          onRecord(record as RpcRecord);
        else onText(line);
      }
      end = buffer.indexOf("\n");
    }
  };
}

export function parseBackgroundReport(
  text: string | undefined,
): { settle: number; count: number } | undefined {
  const match = /^(\d+):(\d+)$/.exec(text ?? "");
  if (!match) return undefined;
  return { settle: Number(match[1]), count: Number(match[2]) };
}

/** The prompt text that print mode builds from an `@file` argument. */
export function promptFileText(absolutePath: string, contents: string): string {
  const text = contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
  return `<file name="${absolutePath}">\n${text}\n</file>\n`;
}

export const TRUNCATED_MESSAGE =
  "Response was truncated: the model reached its output token limit.";

/** Assistant text as print mode writes it: each text block followed by `\n`. */
export function assistantText(message: RpcMessage | undefined): string {
  if (message?.role !== "assistant" || !Array.isArray(message.content))
    return "";
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => `${part.text ?? ""}\n`)
    .join("");
}

/**
 * Print-mode result for the last message of a session: what goes to stdout,
 * what goes to stderr, and whether print mode exits with code 1.
 */
export function printModeResult(message: RpcMessage | undefined): {
  stdout: string;
  stderr: string;
  failed: boolean;
} {
  if (message?.role !== "assistant")
    return { stdout: "", stderr: "", failed: false };
  if (message.stopReason === "error" || message.stopReason === "aborted")
    return {
      stdout: "",
      stderr: `${message.errorMessage || `Request ${message.stopReason}`}\n`,
      failed: true,
    };
  const stdout = assistantText(message);
  if (message.stopReason === "length")
    return { stdout, stderr: `${TRUNCATED_MESSAGE}\n`, failed: true };
  return { stdout, stderr: "", failed: false };
}
