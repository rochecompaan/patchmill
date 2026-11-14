import { createServer } from "node:http";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { createRequestPolicy, isLoopback } from "./request-policy.ts";
import { resolveWebRoot } from "./assets.ts";
import { createRequestHandler } from "./request.ts";
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
  /** Idempotent: repeated calls return the same shutdown promise. */
  close(): Promise<void>;
};
export async function startServeServer(
  options: ServeOptions,
): Promise<Serving> {
  const webRoot = options.webRoot ?? resolveWebRoot();
  const server = createServer();
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= new Promise<void>((resolve, reject) => {
      if (!server.listening) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections();
    }));
  try {
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
    const url = origin + "/?token=" + encodeURIComponent(options.auth.token);
    const closed = once(server, "close").then(() => {});
    server.on(
      "request",
      createRequestHandler({
        webRoot,
        source: options.source,
        auth: options.auth,
        policy,
      }),
    );
    server.on("upgrade", (_req, socket) => socket.destroy());
    server.on("connect", (_req, socket) => socket.destroy());
    return {
      origin,
      url,
      networkExposed: !isLoopback(address.address),
      closed,
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Server startup and cleanup failed.",
        { cause: cleanupError },
      );
    }
    throw error;
  }
}
