import type { IncomingMessage, ServerResponse } from "node:http";

/** A request error that maps to one JSON error answer. */
export class BadRequest extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(text));
  res.end(text);
}

/** Answer a BadRequest as JSON; a 413 closes the connection. */
export function badRequest(res: ServerResponse, error: BadRequest) {
  // Unread body bytes would otherwise keep the connection busy.
  if (error.status === 413) res.setHeader("Connection", "close");
  json(res, error.status, {
    error: { code: error.code, message: error.message },
  });
}

/** Read a JSON body of at most `maxBytes` bytes. */
export async function readBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const type = (req.headers["content-type"] ?? "").toLowerCase();
  if (!/^application\/json\s*(?:;\s*charset=[\w-]+\s*)?$/.test(type))
    throw new BadRequest(
      415,
      "unsupported_media_type",
      "Send the body as application/json.",
    );
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new BadRequest(413, "too_large", "The request body is too large.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxBytes)
      throw new BadRequest(413, "too_large", "The request body is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new BadRequest(400, "invalid_request", "The body is not JSON.");
  }
}
