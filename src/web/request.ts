import type { IncomingMessage, ServerResponse } from "node:http";
import { setResponseHeaders } from "./response-headers.ts";
import { readWebAsset, publicPath } from "./assets.ts";
import { apiResponse } from "./api.ts";
import { issueEventsPath, serveIssueEvents } from "./event-stream.ts";
import type { RunDataSource } from "./run-data.ts";
import type { ServeAuth } from "./auth.ts";
import type { RequestPolicy } from "./request-policy.ts";
import { serveSessionRoute, sessionRoute } from "./session/routes.ts";
import { issueFilePath, serveIssueFile } from "./issue-file-route.ts";
import type { SessionHub } from "./session/types.ts";

type RequestContext = {
  webRoot: string;
  source: RunDataSource;
  auth: ServeAuth;
  policy: RequestPolicy;
  streams: Set<ServerResponse>;
  closing(): boolean;
  keepAliveMs: number;
  /** Absent for `--sample`: the session routes answer 404. */
  sessions?: SessionHub;
};
function send(
  res: ServerResponse,
  method: string,
  status: number,
  body: string | Buffer,
  type = "text/html; charset=utf-8",
) {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(method === "HEAD" ? undefined : body);
}

/** The policy is fully initialized before this handler is attached. */
export function createRequestHandler({
  webRoot,
  source,
  auth,
  policy,
  streams,
  closing,
  keepAliveMs,
  sessions,
}: RequestContext) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET",
      target = req.url ?? "/";
    setResponseHeaders(res);
    void (async () => {
      const host = policy.authority(req.rawHeaders);
      if (!host) return send(res, method, 421, "Misdirected request.");
      if (!policy.originAllowed(method, req.rawHeaders, host))
        return send(res, method, 403, "Forbidden origin.");
      const exchange = auth.exchange(method, target);
      if (exchange.kind === "invalid")
        return send(
          res,
          method,
          401,
          "Open the link printed by patchmill serve.",
        );
      if (exchange.kind === "redirect") {
        res.setHeader("Set-Cookie", exchange.cookie);
        res.setHeader("Location", exchange.location);
        return send(res, method, 303, "");
      }
      if (!auth.authenticated(req.headers.cookie))
        return send(
          res,
          method,
          401,
          "Open the link printed by patchmill serve.",
        );
      const path = publicPath(target);
      if (path === null) return send(res, method, 404, "Not found.");
      const rawNumber = issueEventsPath(path);
      if (rawNumber !== null)
        return serveIssueEvents({
          req,
          res,
          method,
          rawNumber,
          source,
          streams,
          closing,
          keepAliveMs,
        });
      const session = sessionRoute(path);
      if (session)
        return serveSessionRoute({
          req,
          res,
          method,
          route: session,
          sessions,
        });
      const file = issueFilePath(path);
      if (file)
        return serveIssueFile({
          res,
          method,
          route: file,
          source,
          send: (status, body, type) => send(res, method, status, body, type),
        });
      if (method !== "GET" && method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        return send(res, method, 405, "Method not allowed.");
      }
      const api = await apiResponse(path, source);
      if (api)
        return send(
          res,
          method,
          api.status,
          JSON.stringify(api.body),
          "application/json; charset=utf-8",
        );
      const asset = await readWebAsset(webRoot, path);
      if (!asset) return send(res, method, 404, "Not found.");
      if (asset.preview) setResponseHeaders(res, "sample");
      send(res, method, 200, asset.body, asset.contentType);
    })().catch(() => {
      if (res.headersSent) return res.destroy();
      const api = target.startsWith("/api/");
      send(
        res,
        method,
        500,
        api
          ? JSON.stringify({
              error: {
                code: "internal_error",
                message: "Could not load data.",
              },
            })
          : "Could not load the page.",
        api ? "application/json; charset=utf-8" : "text/html; charset=utf-8",
      );
    });
  };
}
