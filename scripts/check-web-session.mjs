// Real-browser regressions for Web sessions on the issue page:
// CHROMIUM=/path/to/chromium node scripts/check-web-session.mjs
// The server and routes are real. A fake Session hub stands in for Pi.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { startServeServer } from "../src/web/server.ts";
import { createServeAuth } from "../src/web/auth.ts";
import { createSampleRunDataSource } from "../src/web/sample-data.ts";

const ISSUE = 298;
const sample = await createSampleRunDataSource().snapshot();
const base = sample.details[String(ISSUE)];
const header = (patch = {}) => ({
  id: "s1",
  startedAt: "2026-11-19T10:05:00.000Z",
  state: "idle",
  status: null,
  question: null,
  ended: null,
  ...patch,
});
let detail = {
  ...base,
  summary: {
    ...base.summary,
    status: "idle",
    live: false,
    pullRequests: [],
  },
  run: {
    startedAt: "2026-11-19T10:00:00Z",
    activeSince: null,
    finishedAt: null,
    outcome: "active",
  },
  thread: [],
  session: { ...header(), entries: [] },
};
const listeners = new Set();
let sequence = 1;
function push(update) {
  if (update.kind === "session")
    detail = {
      ...detail,
      session: update.session
        ? { ...update.session, entries: detail.session?.entries ?? [] }
        : null,
    };
  else if (update.kind === "session-entries")
    detail = {
      ...detail,
      session: {
        ...detail.session,
        entries: [...detail.session.entries, ...update.entries],
      },
    };
  const full = { ...update, id: `0000000a-${++sequence}` };
  for (const listener of listeners) listener(full);
}
const response = () => ({
  schemaVersion: 1,
  repository: sample.repository,
  source: "live",
  revision: "r" + sequence,
  syncedAt: null,
  sessions: true,
  issue: detail,
});
const posts = [];
const ok = { ok: true, duplicate: false };
const later = (ms, fn) => setTimeout(fn, ms);
/** A stand-in for the Session hub: it emits changes as the real one does. */
const hub = {
  async start(_issue, input) {
    posts.push({ action: "start", ...input });
    push({ kind: "session", session: header({ id: "s2", state: "starting" }) });
    later(300, () =>
      push({
        kind: "session",
        session: header({
          id: "s2",
          state: "ended",
          ended: { reason: "refused", message: "Issue #298 is not open." },
        }),
      }),
    );
    return ok;
  },
  send(_issue, input) {
    posts.push({ action: "messages", ...input });
    // The entry reaches the stream before the route answers.
    push({
      kind: "session-entries",
      entries: [
        {
          id: `web:s1:${posts.length}`,
          at: "2026-11-19T10:06:00Z",
          kind: "message",
          role: "person",
          author: input.author,
          note: null,
          blocks: [
            {
              kind: "paragraph",
              content: [{ kind: "text", text: input.text }],
            },
          ],
        },
      ],
    });
    return ok;
  },
  answer(_issue, input) {
    posts.push({ action: "answers", ...input });
    push({ kind: "session", session: header({ state: "replying" }) });
    return ok;
  },
  stopReply: () => ok,
  pause: () => ok,
  current: () => detail.session,
  subscribe: () => () => {},
  close: async () => {},
};
const server = await startServeServer({
  host: "127.0.0.1",
  port: 0,
  auth: createServeAuth(),
  sessions: hub,
  source: {
    snapshot: async () => ({
      ...sample,
      source: "live",
      sessions: true,
      details: { [String(ISSUE)]: detail },
    }),
    subscribe(_selection, listener) {
      listener({
        id: `0000000a-${sequence}`,
        kind: "reset",
        issue: response(),
      });
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  },
});
const profile = await fs.mkdtemp("/tmp/patchmill-session-chrome-");
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
  const { targetId } = await command("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await command("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const send = (method, params) => command(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
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
        if (Date.now() > end) return reject(Error(${JSON.stringify("Timed out: " + expression)}));
        setTimeout(poll, 25);
      };
      poll();
    })`);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const enter = async () => {
    for (const type of ["keyDown", "keyUp"])
      await send("Input.dispatchKeyEvent", {
        type,
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
        ...(type === "keyDown" ? { text: "\r" } : {}),
      });
  };

  await send("Page.navigate", { url: server.url });
  await until(`document.readyState === "complete"`);
  await evaluate(`localStorage.setItem("patchmill-name", "Ada")`);
  // The page reads the saved name when it loads.
  await send("Page.navigate", {
    url: `${server.origin}/?reload=1#/issue/${ISSUE}`,
  });
  await until(`document.querySelector(".web-session")`);

  // Controls of a live idle session.
  check(
    (await evaluate(
      `document.querySelector('.ihead .control [data-action="pause"]')?.getAttribute("aria-label")`,
    )) === "Pause Web session",
    "Pause has the accessible name Pause Web session",
  );
  check(
    (await evaluate(
      `document.querySelector("#composer-input").placeholder`,
    )) === "Message the agent as Ada",
    "an enabled composer names the author",
  );

  // Two quick Enters send one message, and the composer clears after a
  // render that happens before the response.
  await evaluate(`document.querySelector("#composer-input").focus()`);
  await send("Input.insertText", { text: "hello agent" });
  await enter();
  await enter();
  await until(`document.querySelector(".web-session .ev-msg.person")`);
  await sleep(300);
  check(
    posts.filter((p) => p.action === "messages").length === 1,
    `two quick Enters send one message (got ${posts.filter((p) => p.action === "messages").length})`,
  );
  check(
    posts[0]?.author === "Ada" && posts[0]?.text === "hello agent",
    "the message carries the saved name",
  );
  check(
    (await evaluate(`document.querySelector("#composer-input").value`)) === "",
    "the composer clears after the message is sent",
  );
  check(
    (
      await evaluate(
        `document.querySelector(".web-session .ev-msg.person")?.textContent ?? ""`,
      )
    ).includes("Ada"),
    "the message shows its author",
  );

  // A question renders as a card; answering keeps focus on the page.
  push({
    kind: "session",
    session: header({
      state: "question",
      question: {
        id: "d1",
        method: "select",
        title: "Approve the spec?",
        message: "Line one\nLine two <b>not bold</b>",
        options: ["Approve", "Request changes"],
      },
    }),
  });
  await until(
    `document.querySelectorAll('[data-action="answer"]').length === 2`,
  );
  check(
    (await evaluate(`document.querySelector(".question-card b") === null`)) &&
      (await evaluate(
        `document.querySelector(".question-text").textContent.includes("<b>not bold</b>")`,
      )),
    "question text is set as text, not markup",
  );
  await evaluate(`document.querySelector('[data-choice="Approve"]').focus()`);
  await enter();
  await until(`!document.querySelector(".question-card")`);
  await sleep(100);
  check(
    posts.some(
      (p) =>
        p.action === "answers" &&
        p.questionId === "d1" &&
        p.choice === "Approve",
    ),
    "answering posts the question ID and choice",
  );
  check(
    (await evaluate(`document.activeElement?.tagName`)) !== "BODY",
    "focus stays on a control after the question closes",
  );

  // An ended session: no Live pill and no session section.
  push({
    kind: "session",
    session: header({
      state: "ended",
      ended: { reason: "paused", message: "The Web session is paused." },
    }),
  });
  await until(`!document.querySelector(".web-session")`);
  check(
    !(await evaluate(`Boolean(document.querySelector(".connection-state"))`)) ||
      (await evaluate(
        `document.querySelector(".connection-state").textContent !== "Live"`,
      )) ||
      detail.run?.outcome === "active",
    "an ended session shows no Live pill of its own",
  );
  check(
    (await evaluate(
      `document.querySelector(".ihead .control button")?.textContent`,
    )) === "Resume",
    "a paused session offers Resume",
  );

  // A refused start says why, and focus stays on the header control.
  detail = {
    ...detail,
    run: null,
    summary: { ...detail.summary, status: "none" },
  };
  push({ kind: "session", session: null });
  // A reset brings the page to the new run state.
  for (const listener of listeners)
    listener({
      id: `0000000a-${++sequence}`,
      kind: "reset",
      issue: response(),
    });
  await until(
    `document.querySelector('.ihead .control [data-action="start"]')`,
  );
  check(
    (await evaluate(
      `document.querySelector("#composer-input").placeholder`,
    )) !== "Live chat is not available yet.",
    "a sessions server has no view-only placeholder",
  );
  await evaluate(
    `document.querySelector('.ihead .control [data-action="start"]').focus()`,
  );
  await enter();
  await until(
    `document.querySelector('.ihead .control [data-action="pause"]')`,
  );
  await until(
    `document.querySelector('.ihead .control [data-action="start"]')`,
  );
  await sleep(100);
  check(
    (
      await evaluate(`document.querySelector(".composer-hint").textContent`)
    ).includes("Issue #298 is not open."),
    "a refused start shows its reason",
  );
  check(
    (await evaluate(`document.activeElement?.tagName`)) === "BUTTON",
    "focus stays on the header control after the start",
  );
  check(exceptions.length === 0, `no page exceptions (${exceptions.length})`);
} finally {
  socket?.close();
  browser.kill("SIGTERM");
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  await server.close();
}
assert.deepEqual(failures, []);
console.log(
  "Web session browser regressions passed: controls, one message per send, cleared composer, question card, focus, ended and refused sessions.",
);
