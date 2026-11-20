// Real-browser check that an Issue document frame is isolated:
// CHROMIUM=/path/to/chromium node scripts/check-document-sandbox.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { startServeServer } from "../src/web/server.ts";
import { createServeAuth } from "../src/web/auth.ts";
import { createSampleRunDataSource } from "../src/web/sample-data.ts";

const ID = "mockup-0123456789ab";
const FILE = `/files/issues/210/${ID}`;
const MOCKUP = `<!doctype html><title>probe</title><p id="p">probe</p><script>
(async () => {
  const results = {};
  try { results.cookie = document.cookie; } catch { results.cookie = "threw"; }
  try { const r = await fetch("/api/board"); results.fetch = r.status; }
  catch { results.fetch = "threw"; }
  try { results.parent = parent.document.title; } catch { results.parent = "threw"; }
  results.origin = self.origin;
  window.results = results;
})();
</script>`;

const sample = createSampleRunDataSource();
const server = await startServeServer({
  host: "127.0.0.1",
  port: 0,
  auth: createServeAuth(),
  source: {
    ...sample,
    async snapshot(selection) {
      const snapshot = await sample.snapshot(selection);
      const detail = snapshot.details["210"];
      if (!detail) return snapshot;
      return {
        ...snapshot,
        details: {
          ...snapshot.details,
          210: {
            ...detail,
            artifacts: [
              ...detail.artifacts.filter((a) => a.kind !== "mockup"),
              {
                id: ID,
                kind: "mockup",
                title: "Probe mockup",
                path: "docs/mockups/probe.html",
                commit: "0123456",
                location: "On local branch agent/issue-210-x. Not pushed yet.",
                draft: true,
                sourceUrl: null,
                preview: { kind: "page", url: FILE },
              },
            ],
          },
        },
      };
    },
    async documentFile(issue, id) {
      return issue === 210 && id === ID
        ? {
            body: Buffer.from(MOCKUP),
            contentType: "text/html; charset=utf-8",
          }
        : null;
    },
  },
});
const profile = await fs.mkdtemp("/tmp/patchmill-sandbox-chrome-");
const browser = spawn(
  process.env.CHROMIUM ?? "chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Chromium startup timed out")),
      15000,
    );
    let output = "";
    browser.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    browser.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    browser.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Chromium exited"));
    });
  });
  socket = new WebSocket(endpoint);
  await once(socket, "open", { signal: AbortSignal.timeout(15000) });
  let id = 0;
  const pending = new Map();
  /** Execution contexts by session, with their frame IDs and origins. */
  const contexts = [];
  /** Sessions of out-of-process frames (sandboxed frames may get their own). */
  const children = [];
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
    if (message.method === "Runtime.executionContextCreated")
      contexts.push({
        sessionId: message.sessionId,
        ...message.params.context,
      });
    if (
      message.method === "Target.attachedToTarget" &&
      message.params.targetInfo.type === "iframe"
    )
      children.push(message.params.sessionId);
  });
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => {
        pending.delete(n);
        reject(Error(`${method} timed out`));
      }, 15000);
      pending.set(n, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          id: n,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  }
  async function open(url) {
    const { targetId } = await command("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await command("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    for (const method of ["Page.enable", "Runtime.enable"])
      await command(method, {}, sessionId);
    await command(
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      sessionId,
    );
    await command("Page.navigate", { url }, sessionId);
    return sessionId;
  }
  async function evaluate(sessionId, expression, contextId) {
    const response = await command(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        ...(contextId ? { contextId } : {}),
      },
      sessionId,
    );
    if (response.exceptionDetails)
      throw Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async function until(check, message) {
    const end = Date.now() + 10000;
    for (;;) {
      const value = await check().catch(() => undefined);
      if (value) return value;
      if (Date.now() > end) throw Error(`Timed out: ${message}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  // The token link sets the cookie and redirects to the page.
  const page = await open(server.url);
  await until(
    () => evaluate(page, "document.readyState === 'complete'"),
    "page load",
  );
  await evaluate(
    page,
    "localStorage.setItem('patchmill-name','Checker'); location.hash='#/issue/210'; true",
  );
  await until(
    () =>
      evaluate(
        page,
        `Boolean(document.querySelector('button[data-artifact-id="${ID}"]'))`,
      ),
    "mockup chip",
  );
  await evaluate(
    page,
    `document.querySelector('button[data-artifact-id="${ID}"]').click(); true`,
  );
  const sandbox = await until(
    () =>
      evaluate(
        page,
        "document.querySelector('iframe.art-frame')?.getAttribute('sandbox')",
      ),
    "mockup frame",
  );
  assert.equal(sandbox, "allow-scripts", "frame sandbox attribute");
  // The page itself can call the API under the cookie; the frame must not.
  assert.equal(
    await evaluate(page, "fetch('/api/board').then((r) => r.status)"),
    200,
    "page API access",
  );
  const frame = await until(async () => {
    for (const child of children) {
      const results = await evaluate(
        child,
        "location.pathname === " + JSON.stringify(FILE) + " && window.results",
      ).catch(() => null);
      if (results) return results;
    }
    for (const context of contexts) {
      if (context.sessionId !== page || context.name) continue;
      const results = await evaluate(
        page,
        "location.pathname === " + JSON.stringify(FILE) + " && window.results",
        context.id,
      ).catch(() => null);
      if (results) return results;
    }
    return null;
  }, "frame results");
  assert.ok(
    frame.cookie === "threw" || frame.cookie === "",
    `frame cookie: ${frame.cookie}`,
  );
  assert.equal(frame.fetch, "threw", "frame fetch");
  assert.equal(frame.parent, "threw", "frame parent access");
  assert.equal(frame.origin, "null", "frame origin");

  // Opened as its own tab, the file still has an opaque origin.
  const tab = await open(server.origin + FILE);
  const top = await until(
    () => evaluate(tab, "window.results"),
    "top-level results",
  );
  assert.equal(top.origin, "null", "top-level origin");
  assert.ok(top.cookie === "threw" || top.cookie === "", "top-level cookie");
  assert.equal(top.fetch, "threw", "top-level fetch");
  console.log(
    "Document sandbox check passed: frame sandbox allow-scripts, opaque origin, no cookie, no API, no parent access, also as a top-level tab.",
  );
} finally {
  socket?.close();
  const closed = once(browser, "close");
  browser.kill("SIGTERM");
  await closed;
  await server.close();
  await fs.rm(profile, { recursive: true, force: true });
}
