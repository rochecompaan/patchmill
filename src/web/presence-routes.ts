import type { IncomingMessage, ServerResponse } from "node:http";
import { BadRequest, badRequest, json, readBody } from "./json-request.ts";
import { PERSON_NAME_RULE, parsePersonName } from "./person-name.ts";
import type { Presence } from "./presence.ts";

const MAX_BODY = 4096;

/** The raw issue segment of `/api/issues/:number/typing`, or null. */
export function typingRoute(path: string): string | null {
  return /^\/api\/issues\/([^/]*)\/typing$/.exec(path)?.[1] ?? null;
}

function typingInput(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new BadRequest(
      400,
      "invalid_request",
      "The body must be a JSON object.",
    );
  const record = body as Record<string, unknown>;
  const author = parsePersonName(record.author);
  if (!author) throw new BadRequest(400, "invalid_author", PERSON_NAME_RULE);
  if (typeof record.typing !== "boolean")
    throw new BadRequest(
      400,
      "invalid_request",
      "Give typing as true or false.",
    );
  return { author, typing: record.typing };
}

/** `POST /api/issues/:number/typing`. Cookie and Origin are checked first. */
export async function serveTypingRoute(input: {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  rawIssue: string;
  presence: Presence | undefined;
}): Promise<void> {
  const { req, res, method, rawIssue, presence } = input;
  if (method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, {
      error: { code: "method_not_allowed", message: "Use POST." },
    });
  }
  const issue = Number(rawIssue);
  if (!/^[1-9]\d*$/.test(rawIssue) || !Number.isSafeInteger(issue))
    return json(res, 400, {
      error: { code: "invalid_issue", message: "Use a positive issue number." },
    });
  if (!presence)
    return json(res, 404, {
      error: { code: "not_found", message: "This server has no presence." },
    });
  try {
    const { author, typing } = typingInput(await readBody(req, MAX_BODY));
    if (!presence.typing(issue, author, typing))
      return json(res, 409, {
        error: {
          code: "not_present",
          message: "Open the issue page under this name first.",
        },
      });
    json(res, 202, { accepted: true });
  } catch (error) {
    if (!(error instanceof BadRequest)) throw error;
    badRequest(res, error);
  }
}
