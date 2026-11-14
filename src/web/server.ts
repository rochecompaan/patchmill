import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { createRequestPolicy, isLoopback } from "./request-policy.ts";
import { setResponseHeaders } from "./response-headers.ts";
import { readWebAsset, resolveWebRoot, publicPath } from "./assets.ts";
import { apiResponse } from "./api.ts";
import type { RunDataSource } from "./run-data.ts";
import type { ServeAuth } from "./auth.ts";
export type ServeOptions = {
  host: string;
  port: number;
  source: RunDataSource;
  auth: ServeAuth;
  webRoot?: string;
};
export type Serving = {
  origin: string;
  url: string;
  networkExposed: boolean;
  closed: Promise<void>;
  close(): Promise<void>;
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
export async function startServeServer(
  options: ServeOptions,
): Promise<Serving> {
  const webRoot = options.webRoot ?? resolveWebRoot();
  const server = createServer((req, res) => {
    const method = req.method ?? "GET",
      target = req.url ?? "/";
    setResponseHeaders(res);
    void (async () => {
      const host = policy.authority(req.rawHeaders);
      if (!host) {
        send(res, method, 421, "Misdirected request.");
        return;
      }
      if (!policy.originAllowed(method, req.rawHeaders, host)) {
        send(res, method, 403, "Forbidden origin.");
        return;
      }
      const exchange = options.auth.exchange(method, target);
      if (exchange.kind === "invalid") {
        send(res, method, 401, "Open the link printed by patchmill serve.");
        return;
      }
      if (exchange.kind === "redirect") {
        res.setHeader("Set-Cookie", exchange.cookie);
        res.setHeader("Location", exchange.location);
        send(res, method, 303, "");
        return;
      }
      if (!options.auth.authenticated(req.headers.cookie)) {
        send(res, method, 401, "Open the link printed by patchmill serve.");
        return;
      }
      if (method !== "GET" && method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        send(res, method, 405, "Method not allowed.");
        return;
      }
      const path = publicPath(target);
      if (path === null) {
        send(res, method, 404, "Not found.");
        return;
      }
      const api = await apiResponse(path, options.source);
      if (api) {
        send(
          res,
          method,
          api.status,
          JSON.stringify(api.body),
          "application/json; charset=utf-8",
        );
        return;
      }
      const asset = await readWebAsset(webRoot, target);
      if (!asset) {
        send(res, method, 404, "Not found.");
        return;
      }
      if (asset.preview) setResponseHeaders(res, true);
      send(res, method, 200, asset.body, asset.contentType);
    })().catch(() => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
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
  });
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("connect", (_req, socket) => socket.destroy());
  server.listen(options.port, options.host);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Server did not bind to TCP.");
  const policy = createRequestPolicy({
    host: options.host,
    address: address.address,
    port: address.port,
    interfaces: Object.values(networkInterfaces()).flatMap(
      (items) => items?.map((i) => i.address) ?? [],
    ),
  });
  const host = ["0.0.0.0", "::"].includes(options.host)
    ? address.family === "IPv6"
      ? "::1"
      : "127.0.0.1"
    : options.host;
  const origin = `http://${isIP(host) === 6 ? "[" + host + "]" : host}:${address.port}`;
  let resolveClosed: () => void, rejectClosed: (reason: Error) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });
  server.once("close", () => resolveClosed());
  server.on("error", (error) => rejectClosed(error));
  let closing: Promise<void> | undefined;
  return {
    origin,
    url: origin + "/?token=" + encodeURIComponent(options.auth.token),
    networkExposed: !isLoopback(address.address),
    closed,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      return closing;
    },
  };
}
