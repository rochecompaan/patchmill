import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, type OutgoingHttpHeaders } from "node:http";
import { connect } from "node:net";
import type { TestContext } from "node:test";
import { startServeServer, type ServeOptions } from "../src/web/server.ts";
import { createServeAuth } from "../src/web/auth.ts";
import { createSampleRunDataSource } from "../src/web/sample-data.ts";
export async function startWebFixture(
  t: TestContext,
  overrides: Partial<ServeOptions> = {},
) {
  const root = await mkdtemp(join(tmpdir(), "serve-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "samples"));
  await writeFile(join(root, "index.html"), "<title>Fixture</title>");
  await writeFile(join(root, "app.js"), "export {};");
  await writeFile(join(root, "samples/board.html"), "<title>Preview</title>");
  const auth = overrides.auth ?? createServeAuth("test-token");
  const serving = await startServeServer({
    host: "127.0.0.1",
    port: 0,
    source: createSampleRunDataSource(),
    auth,
    webRoot: root,
    ...overrides,
  });
  t.after(() => serving.close());
  const cookie = "patchmill_serve=" + encodeURIComponent(auth.token);
  return {
    ...serving,
    root,
    cookie,
    request(
      path: string,
      options: {
        method?: string;
        headers?: OutgoingHttpHeaders;
        cookie?: string;
      } = {},
    ) {
      return new Promise<{
        status: number;
        headers: import("node:http").IncomingHttpHeaders;
        body: string;
        bytes: Buffer;
      }>((resolve, reject) => {
        const req = request(
          serving.origin,
          {
            path,
            method: options.method ?? "GET",
            headers: {
              Connection: "close",
              ...options.headers,
              ...(options.cookie ? { Cookie: options.cookie } : {}),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const bytes = Buffer.concat(chunks);
              resolve({
                status: res.statusCode!,
                headers: res.headers,
                body: bytes.toString(),
                bytes,
              });
            });
          },
        );
        req.setTimeout(3000, () => req.destroy(new Error("HTTP timeout")));
        req.on("error", reject);
        req.end();
      });
    },
    rawRequest(text: string) {
      return new Promise<string>((resolve, reject) => {
        const url = new URL(serving.origin),
          socket = connect(Number(url.port), url.hostname);
        let received = "";
        socket.setTimeout(3000, () =>
          socket.destroy(new Error("Raw HTTP timeout")),
        );
        socket.on("connect", () => socket.end(text));
        socket.on("data", (c) => (received += c));
        socket.on("end", () => resolve(received));
        socket.on("error", reject);
      });
    },
  };
}
