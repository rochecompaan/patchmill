import type { BoardResponse, IssueResponse, ApiError } from "./api-types.ts";
import type { RunDataSource } from "./run-data.ts";
export async function apiResponse(
  path: string,
  source: RunDataSource,
): Promise<{
  status: number;
  body: BoardResponse | IssueResponse | ApiError;
} | null> {
  if (!path.startsWith("/api/")) return null;
  const error = (
    status: number,
    code: ApiError["error"]["code"],
    message: string,
  ) => ({ status, body: { error: { code, message } } });
  const issueMatch = /^\/api\/issues\/([^/]*)$/.exec(path);
  if (path !== "/api/board" && !issueMatch)
    return error(404, "not_found", "Not found.");
  const number = issueMatch ? Number(issueMatch[1]) : null;
  if (
    issueMatch &&
    (!/^[1-9]\d*$/.test(issueMatch[1]!) || !Number.isSafeInteger(number))
  )
    return error(400, "invalid_issue", "Use a positive issue number.");
  const snapshot = await source.snapshot();
  const meta = {
    schemaVersion: 1 as const,
    repository: snapshot.repository,
    source: snapshot.source,
    revision: snapshot.revision,
    syncedAt: snapshot.syncedAt,
  };
  if (path === "/api/board")
    return { status: 200, body: { ...meta, issues: snapshot.issues } };
  const issue = snapshot.details[String(number)];
  return issue
    ? { status: 200, body: { ...meta, issue } }
    : error(404, "not_found", "Issue not found.");
}
