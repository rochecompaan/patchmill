import type { IncomingMessage, ServerResponse } from "node:http";
import type { HubResult, SessionHub, SessionInput } from "./types.ts";

export type SessionAction =
  | "start"
  | "messages"
  | "answers"
  | "stop-reply"
  | "pause";
const ACTIONS = new Set<string>(["messages", "answers", "stop-reply", "pause"]);
const MAX_BODY = 64 * 1024;
const MAX_TEXT = 64 * 1024;
const MAX_FIELD = 2000;
const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export function sessionRoute(
  path: string,
): { issue: string; action: SessionAction } | null {
  const match = /^\/api\/issues\/([^/]*)\/session(?:\/([^/]*))?$/.exec(path);
  if (!match) return null;
  const action = match[2];
  if (action === undefined) return { issue: match[1] ?? "", action: "start" };
  return ACTIONS.has(action)
    ? { issue: match[1] ?? "", action: action as SessionAction }
    : null;
}

class BadRequest extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(text));
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (!/^application\/json\s*(?:;\s*charset=[\w-]+\s*)?$/.test(type))
    throw new BadRequest(
      415,
      "unsupported_media_type",
      "Send the body as application/json.",
    );
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY)
    throw new BadRequest(413, "too_large", "The request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY)
      throw new BadRequest(413, "too_large", "The request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BadRequest(400, "invalid_request", "The body is not JSON.");
  }
}

const invalid = (message: string) =>
  new BadRequest(400, "invalid_request", message);
function field(body: Record<string, unknown>, name: string, max: number) {
  const value = body[name];
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw invalid(`Give ${name} as text of at most ${max} characters.`);
  return value;
}

function sessionInput(body: unknown): {
  body: Record<string, unknown>;
  input: SessionInput;
} {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw invalid("The body must be a JSON object.");
  const record = body as Record<string, unknown>;
  const raw = record.author;
  const author = typeof raw === "string" ? raw.trim() : "";
  if (
    !author ||
    Array.from(author).length > 80 ||
    CONTROL.test(author) ||
    author.startsWith("/")
  )
    throw new BadRequest(
      400,
      "invalid_author",
      "Give a name of 1 to 80 characters that does not start with /.",
    );
  const requestId = record.requestId;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId))
    throw invalid("Give requestId as 8 to 64 letters, digits or dashes.");
  return { body: record, input: { author, requestId } };
}

function respond(res: ServerResponse, result: HubResult) {
  if (result.ok)
    return json(res, 202, { accepted: true, duplicate: result.duplicate });
  json(res, result.code === "invalid_choice" ? 400 : 409, {
    error: { code: result.code, message: result.message },
  });
}

export async function serveSessionRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  route: NonNullable<ReturnType<typeof sessionRoute>>;
  sessions: SessionHub | undefined;
}): Promise<void> {
  const { req, res, method, route, sessions } = input;
  if (method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, {
      error: { code: "method_not_allowed", message: "Use POST." },
    });
  }
  const issue = Number(route.issue);
  if (!/^[1-9]\d*$/.test(route.issue) || !Number.isSafeInteger(issue))
    return json(res, 400, {
      error: { code: "invalid_issue", message: "Use a positive issue number." },
    });
  if (!sessions)
    return json(res, 404, {
      error: { code: "not_found", message: "This server has no Web sessions." },
    });
  try {
    const { body, input: person } = sessionInput(await readBody(req));
    switch (route.action) {
      case "start":
        return respond(res, await sessions.start(issue, person));
      case "messages":
        return respond(
          res,
          sessions.send(issue, {
            ...person,
            text: field(body, "text", MAX_TEXT),
          }),
        );
      case "answers":
        return respond(
          res,
          sessions.answer(issue, {
            ...person,
            questionId: field(body, "questionId", MAX_FIELD),
            choice: field(body, "choice", MAX_FIELD),
          }),
        );
      case "stop-reply":
        return respond(res, sessions.stopReply(issue, person));
      case "pause":
        return respond(res, sessions.pause(issue, person));
    }
  } catch (error) {
    if (!(error instanceof BadRequest)) throw error;
    // Unread body bytes would otherwise keep the connection busy.
    if (error.status === 413) res.setHeader("Connection", "close");
    json(res, error.status, {
      error: { code: error.code, message: error.message },
    });
  }
}
