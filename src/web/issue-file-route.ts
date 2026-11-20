import type { ServerResponse } from "node:http";
import { fileIdPattern } from "./issue-documents.ts";
import { setResponseHeaders } from "./response-headers.ts";
import type { RunDataSource } from "./run-data.ts";

/**
 * Parses `/files/issues/<number>/<id>`. Returns null for other paths, and
 * "invalid" for a `/files/` path of any other shape.
 */
export function issueFilePath(
  path: string,
): { issue: number; id: string } | "invalid" | null {
  if (path !== "/files" && !path.startsWith("/files/")) return null;
  const match = /^\/files\/issues\/([1-9]\d{0,8})\/([^/]+)$/.exec(path);
  if (!match || !fileIdPattern.test(match[2]!)) return "invalid";
  return { issue: Number(match[1]), id: match[2]! };
}

/** Serves one HTML Issue document by its server-issued ID, or 404. */
export async function serveIssueFile(input: {
  res: ServerResponse;
  method: string;
  route: { issue: number; id: string } | "invalid";
  source: RunDataSource;
  send(status: number, body: string | Buffer, type?: string): void;
}): Promise<void> {
  if (input.method !== "GET" && input.method !== "HEAD") {
    input.res.setHeader("Allow", "GET, HEAD");
    return input.send(405, "Method not allowed.");
  }
  const file =
    input.route === "invalid" || !input.source.documentFile
      ? null
      : await input.source.documentFile(input.route.issue, input.route.id);
  if (!file) return input.send(404, "Not found.");
  setResponseHeaders(input.res, "document");
  input.send(200, file.body, file.contentType);
}
