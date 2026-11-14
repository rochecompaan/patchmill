import type { BoardResponse, IssueResponse, ApiError } from "./api-types.ts";
import type { RunDataSource, RunDataSnapshot } from "./run-data.ts";

function error(
  status: number,
  code: ApiError["error"]["code"],
  message: string,
) {
  return { status, body: { error: { code, message } } };
}
function metadata(snapshot: RunDataSnapshot) {
  return {
    schemaVersion: 1 as const,
    repository: snapshot.repository,
    source: snapshot.source,
    revision: snapshot.revision,
    syncedAt: snapshot.syncedAt,
  };
}
export async function apiResponse(
  path: string,
  source: RunDataSource,
): Promise<{
  status: number;
  body: BoardResponse | IssueResponse | ApiError;
} | null> {
  if (!path.startsWith("/api/")) return null;
  if (path === "/api/board") {
    const snapshot = await source.snapshot();
    return {
      status: 200,
      body: { ...metadata(snapshot), issues: snapshot.issues },
    };
  }
  const match = /^\/api\/issues\/([^/]*)$/.exec(path);
  if (!match) return error(404, "not_found", "Not found.");
  const rawNumber = match[1] ?? "";
  const number = Number(rawNumber);
  if (!/^[1-9]\d*$/.test(rawNumber) || !Number.isSafeInteger(number))
    return error(400, "invalid_issue", "Use a positive issue number.");
  const snapshot = await source.snapshot();
  const issue = snapshot.details[String(number)];
  return issue
    ? { status: 200, body: { ...metadata(snapshot), issue } }
    : error(404, "not_found", "Issue not found.");
}
