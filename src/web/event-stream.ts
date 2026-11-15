import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunDataSource } from "./run-data.ts";

export function issueEventsPath(path: string): string | null {
  return /^\/api\/issues\/([^/]*)\/events$/.exec(path)?.[1] ?? null;
}
export async function serveIssueEvents(input: {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  rawNumber: string;
  source: RunDataSource;
  streams: Set<ServerResponse>;
  closing(): boolean;
  keepAliveMs: number;
}): Promise<void> {
  const { req, res, method, rawNumber, source, streams } = input;
  const fail = (status: number, code: string, message: string) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      method === "HEAD"
        ? undefined
        : JSON.stringify({ error: { code, message } }),
    );
  };
  if (method !== "GET") {
    res.setHeader("Allow", "GET");
    fail(405, "method_not_allowed", "Method not allowed.");
    return;
  }
  const issue = Number(rawNumber);
  if (!/^[1-9]\d*$/.test(rawNumber) || !Number.isSafeInteger(issue)) {
    fail(400, "invalid_issue", "Use a positive issue number.");
    return;
  }
  const snapshot = await source.snapshot({ issue });
  if (res.destroyed || req.destroyed) return;
  if (!snapshot.details[String(issue)]) {
    fail(404, "not_found", "Issue not found.");
    return;
  }
  if (input.closing()) {
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.flushHeaders();
  let stopped = false;
  let unsubscribe: (() => void) | undefined;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    streams.delete(res);
    unsubscribe?.();
  };
  const write = (text: string) => {
    if (stopped || res.destroyed || res.writableEnded) return;
    res.write(text);
    if (res.writableLength > 8 * 1024 * 1024) {
      cleanup();
      res.end();
    }
  };
  const timer = setInterval(() => write(": keep-alive\n\n"), input.keepAliveMs);
  timer.unref();
  streams.add(res);
  req.once("close", cleanup);
  res.once("close", cleanup);
  write("retry: 3000\n\n");
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === "last-event-id")
      values.push(req.rawHeaders[i + 1]!);
  const lastEventId =
    values.length === 1 && /^[0-9a-f]{8}-[0-9]{1,15}$/.test(values[0]!)
      ? values[0]!
      : null;
  try {
    unsubscribe = source.subscribe({ issue, lastEventId }, (u) =>
      write(`id: ${u.id}\nevent: ${u.kind}\ndata: ${JSON.stringify(u)}\n\n`),
    );
  } catch (error) {
    cleanup();
    res.destroy();
    throw error;
  }
  if (stopped) unsubscribe();
}
