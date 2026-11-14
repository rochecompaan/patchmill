import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function get(url, cookie, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { method, headers: cookie ? { Cookie: cookie } : {} },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.setTimeout(5000, () =>
      req.destroy(new Error("Serve smoke HTTP timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}
/** Run the real installed CLI from an unrelated directory, without logging its token.
 * @param {string} command @param {readonly string[]} args
 * @param {{cwd:string,env?:NodeJS.ProcessEnv}} options
 */
export async function smokeServe(command, args, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort();
    const env = { ...process.env, ...options.env };
    delete env.PATCHMILL_SERVE_TOKEN;
    const child = spawn(
      command,
      [...args, "serve", "--host", "127.0.0.1", "--port", String(port)],
      { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    const exit = new Promise((resolve) =>
      child.once("close", (code, signal) => resolve({ code, signal })),
    );
    let errors = "";
    child.stderr.on("data", (chunk) => (errors += chunk));
    try {
      const link = await new Promise((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(
          () => reject(new Error("Serve did not become ready")),
          15000,
        );
        const cleanup = () => clearTimeout(timeout);
        child.stdout.on("data", (chunk) => {
          output += chunk;
          const match = output.match(/Patchmill sample data: (http:\/\/\S+)/);
          if (match) {
            cleanup();
            resolve(match[1]);
          }
        });
        child.once("error", (error) => {
          cleanup();
          reject(error);
        });
        child.once("close", () => {
          cleanup();
          reject(new Error(errors || "Serve exited before readiness"));
        });
      });
      const url = new URL(link),
        origin = url.origin;
      assert.equal((await get(origin + "/")).status, 401);
      const login = await get(link);
      assert.equal(login.status, 303);
      assert.equal(login.headers.location, "/");
      assert.match(
        login.headers["set-cookie"][0],
        /HttpOnly; SameSite=Strict; Path=\//,
      );
      const cookie = login.headers["set-cookie"][0].split(";")[0];
      const page = await get(origin + "/", cookie);
      assert.equal(page.status, 200, "installed web shell");
      assert.match(page.body.toString(), /<html/);
      assert.equal((await get(origin + "/", cookie, "HEAD")).body.length, 0);
      const board = JSON.parse(
        (await get(origin + "/api/board", cookie)).body.toString(),
      );
      assert.equal(board.schemaVersion, 1);
      assert.equal(board.source, "sample");
      assert.ok(board.issues.some((i) => i.number === 227));
      const detail = JSON.parse(
        (await get(origin + "/api/issues/227", cookie)).body.toString(),
      );
      assert.equal(detail.issue.summary.number, 227);
      for (const [path, type] of [
        ["/app.js", "text/javascript"],
        ["/styles/base.css", "text/css"],
        ["/fonts/atkinson-hyperlegible-next.woff2", "font/woff2"],
        ["/samples/board-columns.png", "image/png"],
        ["/samples/design-review.html", "text/html"],
        ["/samples/preview.css", "text/css"],
      ]) {
        const response = await get(origin + path, cookie);
        assert.equal(response.status, 200, path);
        assert.ok(response.headers["content-type"].startsWith(type), path);
        assert.ok(response.body.length > 0);
        if (path.endsWith(".html"))
          assert.match(
            response.headers["content-security-policy"],
            /script-src 'none'.*sandbox allow-same-origin/,
          );
      }
      child.kill("SIGTERM");
      const ended = await exit;
      assert.equal(ended.code, 0);
      assert.equal(ended.signal, null);
      console.log(
        "Installed serve smoke passed: auth, API, local assets, preview policy, HEAD, and shutdown.",
      );
      return;
    } catch (error) {
      if (attempt < 2 && errors.includes("EADDRINUSE")) continue;
      throw error;
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      await exit;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const cwd = await mkdtemp(join(tmpdir(), "patchmill-serve-smoke-"));
  try {
    if (!args[0])
      throw Error("Usage: node scripts/smoke-serve.mjs -- COMMAND [ARGS...]");
    await smokeServe(args[0], args.slice(1), { cwd });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
