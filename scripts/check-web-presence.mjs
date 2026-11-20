// Real-browser regressions for presence and typing on the issue page:
// CHROMIUM=/path/to/chromium node scripts/check-web-presence.mjs
// The server, routes and presence are real. A fake Session hub stands in
// for Pi. Each person has a separate browser context, so names differ.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { startServeServer } from "../src/web/server.ts";
import { createServeAuth } from "../src/web/auth.ts";
import { createSampleRunDataSource } from "../src/web/sample-data.ts";
import { createPresence } from "../src/web/presence.ts";

const ISSUE = 298;
const sample = await createSampleRunDataSource().snapshot();
const base = sample.details[String(ISSUE)];
const detail = {
  ...base,
  summary: { ...base.summary, status: "idle", live: false, pullRequests: [] },
  run: null,
  thread: Array.from({ length: 30 }, (_, i) => ({
    id: `r${i}`,
    at: "2026-11-19T09:00:00Z",
    kind: "progress",
    text: `Progress ${i} `.repeat(20),
  })),
  session: {
    id: "s1",
    startedAt: "2026-11-19T10:05:00.000Z",
    state: "idle",
    status: null,
    question: null,
    ended: null,
    entries: [],
  },
};
const ok = { ok: true, duplicate: false };
const hub = {
  start: async () => ok,
  send: () => ok,
  answer: () => ok,
  stopReply: () => ok,
  pause: () => ok,
  current: () => detail.session,
  subscribe: () => () => {},
  close: async () => {},
};
const presence = createPresence({
  clock: {
    after(ms, fn) {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  },
});
const server = await startServeServer({
  host: "127.0.0.1",
  port: 0,
  auth: createServeAuth(),
  sessions: hub,
  presence,
  source: {
    snapshot: async () => ({
      ...sample,
      source: "live",
      sessions: true,
      details: { [String(ISSUE)]: detail },
    }),
    subscribe(_selection, listener) {
      listener({
        id: "0000000a-1",
        kind: "reset",
        issue: {
          schemaVersion: 1,
          repository: sample.repository,
          source: "live",
          revision: "r1",
          syncedAt: null,
          sessions: true,
          issue: detail,
        },
      });
      return () => {};
    },
  },
});
const profile = await fs.mkdtemp("/tmp/patchmill-presence-chrome-");
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
const failures = [];
const exceptions = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};
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
    browser.once("error", reject);
  });
  socket = new WebSocket(endpoint);
  await once(socket, "open", { signal: AbortSignal.timeout(15000) });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      if (message.error) waiter.reject(Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown")
      exceptions.push(message.params.exceptionDetails);
  });
  const command = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      socket.send(
        JSON.stringify({
          id: n,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }),
      );
    });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Open the issue page as `name` in a new browser context. */
  async function openAs(name) {
    const { browserContextId } = await command("Target.createBrowserContext");
    const { targetId } = await command("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const { sessionId } = await command("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const send = (method, params) => command(method, params, sessionId);
    await send("Page.enable");
    await send("Runtime.enable");
    // A background tab would throttle timers.
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = (expression, ms = 5000) =>
      evaluate(`new Promise((resolve, reject) => {
        const end = Date.now() + ${ms};
        const poll = () => {
          if (${expression}) return resolve(true);
          if (Date.now() > end) return reject(Error(${JSON.stringify(name + " timed out: " + expression)}));
          setTimeout(poll, 25);
        };
        poll();
      })`);
    await send("Page.navigate", { url: server.url });
    await until(`document.readyState === "complete"`);
    await evaluate(
      `localStorage.setItem("patchmill-name", ${JSON.stringify(name)})`,
    );
    await send("Page.navigate", {
      url: `${server.origin}/?reload=1#/issue/${ISSUE}`,
    });
    await until(`document.querySelector("#composer-input:not([disabled])")`);
    return { targetId, browserContextId, send, evaluate, until };
  }
  const text = (selector) =>
    `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? "")`;

  const ana = await openAs("Ana");
  await ana.evaluate(`window.scrollTo(0, 600)`);
  await ana.evaluate(`document.querySelector("#composer-input").focus()`);
  await ana.send("Input.insertText", { text: "draft" });
  const threadTop = () =>
    ana.evaluate(
      `Math.round(document.querySelector(".thread").getBoundingClientRect().top)`,
    );
  const caret = () =>
    ana.evaluate(
      `[document.activeElement?.id, document.activeElement?.selectionStart]`,
    );
  const top = await threadTop();
  const ben = await openAs("Ben");

  await ana.until(`${text(".presence-text")}.includes("Ben")`, 3000);
  await ben.until(`${text(".presence-text")}.includes("Ana")`, 3000);
  check(
    (await ana.evaluate(text(".presence-text"))) === "Here now: you and Ben",
    "Ana's hidden presence text lists Ben",
  );

  await ben.evaluate(`document.querySelector("#composer-input").focus()`);
  await ben.send("Input.insertText", { text: "hi" });
  await ana.until(`${text(".typing")} === "Ben is typing"`, 4000);
  // Ana typed a draft before Ben joined, so Ben can still see her.
  const own = await ben.evaluate(text(".typing"));
  check(!own.includes("Ben"), `Ben does not see his own typing (${own})`);
  check(
    (await ana.evaluate(
      `document.querySelector(".typing").getAttribute("aria-hidden")`,
    )) === "true",
    "typing is hidden from screen readers",
  );
  await ana.until(`${text(".typing")} === ""`, 7500);

  check(
    JSON.stringify(await caret()) === JSON.stringify(["composer-input", 5]),
    "Ana keeps focus and caret in the composer",
  );
  check((await threadTop()) === top, "the thread does not move for Ana");

  await command("Target.closeTarget", { targetId: ben.targetId });
  await ana.until(`!${text(".presence-text")}.includes("Ben")`, 3000);
  check(
    (await ana.evaluate(
      `[...document.querySelectorAll('[role="status"]')].some((n) => n.textContent === "Ben left the page.")`,
    )) === true,
    "a polite status element says Ben left the page",
  );
  check(
    (await ana.evaluate(
      `document.querySelector(".presence-text").closest("[aria-live],[role=status]") === null`,
    )) === true,
    "the presence text itself is not a live region",
  );
  check(
    JSON.stringify(await caret()) === JSON.stringify(["composer-input", 5]),
    "Ana keeps focus after Ben leaves",
  );
  check((await threadTop()) === top, "the thread does not move on a leave");
  await sleep(50);
  check(exceptions.length === 0, `no page exceptions (${exceptions.length})`);
} finally {
  socket?.close();
  browser.kill("SIGTERM");
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  await server.close();
}
assert.deepEqual(failures, []);
console.log(
  "Web presence browser regressions passed: names within 3 s, typing shown and cleared, focus and thread kept, leave announced.",
);
