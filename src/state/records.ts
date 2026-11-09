import type { Issue } from "../host/types.ts";
import type { StatusChange, SyncCursor } from "./store.ts";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isCursor(value: unknown): value is SyncCursor {
  return (
    record(value) &&
    ["repository", "fullSyncAt", "syncedUpTo"].every(
      (key) => typeof value[key] === "string" && value[key].length > 0,
    )
  );
}

export function isIssue(value: unknown, number: number): value is Issue {
  return (
    record(value) &&
    Number.isSafeInteger(value.number) &&
    typeof value.number === "number" &&
    value.number > 0 &&
    value.number === number &&
    ["title", "body", "url", "author", "createdAt"].every(
      (key) => typeof value[key] === "string",
    ) &&
    strings(value.labels) &&
    (value.state === "open" || value.state === "closed") &&
    Array.isArray(value.comments) &&
    value.comments.every(
      (comment: unknown) =>
        record(comment) &&
        ["author", "body", "createdAt"].every(
          (key) => typeof comment[key] === "string",
        ) &&
        (comment.url === undefined || typeof comment.url === "string"),
    )
  );
}

export function isStatusChange(value: unknown): value is StatusChange {
  return (
    record(value) &&
    typeof value.at === "string" &&
    ["ready", "inProgress", "needsInfo", "done", "unsuitable"].includes(
      value.status as string,
    ) &&
    ["runId", "summary", "cost", "questionUrl"].every(
      (key) => value[key] === undefined || typeof value[key] === "string",
    ) &&
    (value.warnings === undefined || strings(value.warnings))
  );
}
