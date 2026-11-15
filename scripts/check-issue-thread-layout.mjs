// Browser behavior over real file-backed snapshots. Optional sanitized repository replay.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  issueThreadFixture,
  piEntry,
} from "../test-support/issue-thread-fixture.ts";
import { createFileRunDataSource } from "../src/web/file-run-data.ts";
import { startServeServer } from "../src/web/server.ts";
import { createServeAuth } from "../src/web/auth.ts";
import { boardIssue, boardProgress } from "../test-support/board-fixture.ts";
import { acquireLock } from "../src/kernel/lock.ts";
import { writeRunProgress } from "../src/kernel/run-progress.ts";
import { replayIssueRun } from "./issue-run-replay.mjs";
const cleanups = [];
const f = await issueThreadFixture({ after: (fn) => cleanups.push(fn) });
const attack = '<img src=x onerror="window.issueHtmlExecuted=true">';
const first = await f.attempt({
  messages: [
    piEntry("prompt", "user", "Patchmill prompt " + attack),
    piEntry("a", "assistant", [
      { type: "text", text: "I inspected the run files. " + attack },
      {
        type: "toolCall",
        id: "call",
        name: "read",
        arguments: { path: attack },
      },
    ]),
    {
      type: "message",
      id: "output",
      message: {
        role: "toolResult",
        toolCallId: "call",
        content: [{ type: "text", text: attack + "\n" + "x".repeat(8100) }],
      },
    },
  ],
});
await f.attempt({
  id: "20261114-130000-bbbb",
  start: "2026-11-14T13:00:00Z",
  finish: "2026-11-14T13:01:00Z",
  phase: "implementation",
  messages: [
    piEntry(
      "b",
      "assistant",
      [
        {
          type: "toolCall",
          id: "bash",
          name: "bash",
          arguments: { command: "npm test" },
        },
      ],
      "2026-11-14T13:00:01Z",
    ),
  ],
});
const identity = {
  schemaVersion: 1,
  issue: 9,
  runId: "20261114-120000-abcd",
  at: "2026-11-14T12:00:00Z",
};
await fs.writeFile(
  join(first.dir, "history.jsonl"),
  [
    {
      ...identity,
      sequence: 1,
      kind: "session",
      number: 1,
      phase: "planning",
      stage: "implementation",
    },
    {
      ...identity,
      sequence: 2,
      at: "2026-11-14T12:00:20Z",
      kind: "progress",
      stream: "stderr",
      text: "tokens: task 2.4k total 2.4k   time elapsed: 30s",
    },
  ]
    .map((r) => JSON.stringify(r))
    .join("\n"),
);
const blocked = join(
  f.repoRoot,
  f.config.paths.runsDir,
  "issue-10/20261114-120000-abcd",
);
await fs.mkdir(blocked, { recursive: true });
await fs.writeFile(
  join(blocked, "result.json"),
  JSON.stringify({
    issue: 10,
    runId: "20261114-120000-abcd",
    startedAt: "2026-11-14T12:00:00Z",
    finishedAt: "2026-11-14T12:00:30Z",
    sessions: [],
    outcome: {
      issue: 10,
      status: "stopped",
      label: "needsInfo",
      summary: "Which branch contains the approved plan? " + attack,
    },
  }),
);
const activeDir = join(f.repoRoot, f.config.paths.runsDir, "issue-11");
const activeStart = new Date().toISOString();
await writeRunProgress(
  activeDir,
  boardProgress({
    issue: 11,
    startedAt: activeStart,
    updatedAt: activeStart,
    interactive: false,
  }),
);
const activeRun = join(activeDir, boardProgress().runId);
const activeSession = join(activeRun, "sessions/1");
await fs.mkdir(activeSession, { recursive: true });
await fs.writeFile(
  join(activeSession, "main.jsonl"),
  JSON.stringify(
    piEntry(
      "initial",
      "assistant",
      "Earlier work retained for scroll verification. ".repeat(200),
      activeStart,
    ),
  ) + "\n",
);
const lock = await acquireLock(join(activeDir, "lock"), {
  now: () => new Date(activeStart),
});
let liveSequence = 0;
const latencies = [];
cleanups.push(() => lock.release());
const issues = [
  {
    ...f.issue,
    title: "Show finished Issue runs on the web issue page",
    labels: [f.config.labels.done],
  },
  { ...boardIssue(10), title: "Resolve the plan branch" },
  { ...boardIssue(11), title: "Active Issue run" },
  { ...boardIssue(12), title: "An issue without a run", body: attack },
];
let replay = null;
if (process.env.PATCHMILL_REPLAY_ISSUE) {
  const issue = Number(process.env.PATCHMILL_REPLAY_ISSUE);
  assert.ok(Number.isSafeInteger(issue) && issue > 12);
  replay = await replayIssueRun(
    process.env.PATCHMILL_REPLAY_DIRECTORY,
    join(f.repoRoot, f.config.paths.runsDir, `issue-${issue}`),
    issue,
  );
  issues.push({
    ...boardIssue(issue),
    title: "Retained repository Issue run (sanitized replay)",
    body: "Read-only replay of retained run files.",
  });
}
const source = createFileRunDataSource({
  ...f,
  host: {
    listOpenIssues: async () => issues,
    listOpenPullRequests: async () => [],
  },
  metadata: {
    repository: {
      name: "rochecompaan/patchmill",
      url: "https://github.com/rochecompaan/patchmill",
    },
    baseBranch: "main",
    pushRepository: {
      slug: "rochecompaan/patchmill",
      url: "https://github.com/rochecompaan/patchmill",
    },
  },
  runner: async (_cmd, args) => ({
    code: 0,
    stdout:
      args[0] === "rev-parse"
        ? "a".repeat(40)
        : `100644 blob ${"a".repeat(40)}\t${args.at(-1)}2026-11-14-issue-9-thread-${String(args.at(-1)).includes("specs") ? "design" : "plan"}.md\0`,
    stderr: "",
  }),
  now: () => new Date("2026-11-14T14:00:00Z"),
});
const server = await startServeServer({
  host: "127.0.0.1",
  port: 0,
  auth: createServeAuth(),
  source,
});
cleanups.push(() => server.close());
const profile = await fs.mkdtemp("/tmp/patchmill-thread-browser-");
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
      () => reject(Error("Browser startup timeout")),
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
  await once(socket, "open");
  let next = 0;
  const pending = new Map();
  const requests = [],
    exceptions = [];
  socket.addEventListener("message", ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) {
      const p = pending.get(m.id);
      if (p) {
        pending.delete(m.id);
        clearTimeout(p.timer);
        m.error
          ? p.reject(Error(JSON.stringify(m.error)))
          : p.resolve(m.result);
      }
    }
    if (m.method === "Network.requestWillBeSent")
      requests.push(m.params.request);
    if (m.method === "Runtime.exceptionThrown")
      exceptions.push(m.params.exceptionDetails);
  });
  const command = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => reject(Error(method + " timeout")), 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(
        JSON.stringify({
          id,
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
  const send = (method, params = {}) => command(method, params, sessionId);
  for (const method of ["Page.enable", "Runtime.enable", "Network.enable"])
    await send(method);
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const until = async (expression) =>
    evaluate(
      `new Promise((resolve,reject)=>{const ready=()=>Boolean(${expression});if(ready()){resolve();return;}const observer=new MutationObserver(()=>{if(ready()){observer.disconnect();clearTimeout(timer);resolve();}});observer.observe(document,{subtree:true,childList:true,attributes:true});const timer=setTimeout(()=>{observer.disconnect();reject(Error('Readiness timeout: '+${JSON.stringify(expression)}));},10000);})`,
    );
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "localStorage.setItem('patchmill-name','Reviewer');",
  });
  await send("Page.navigate", { url: server.url + "#/issue/9" });
  await until('document.querySelector(".ihead")');
  assert.equal(
    await evaluate('document.querySelectorAll(".tool").length'),
    2,
    "real thread must replace the placeholder",
  );
  assert.equal(await evaluate('document.querySelector(".prompt").open'), false);
  assert.ok(
    (await evaluate('document.querySelector(".meta").textContent')).includes(
      "$0.2000",
    ),
  );
  assert.equal(
    await evaluate('document.querySelectorAll(".document-link").length'),
    2,
  );
  await evaluate('document.querySelector(".tool summary").focus()');
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", {
      type,
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      ...(type === "keyDown" ? { text: "\r" } : {}),
    });
  assert.equal(await evaluate('document.querySelector(".tool").open'), true);
  assert.match(
    await evaluate('document.querySelector(".tool-detail").textContent'),
    /Output shortened/,
  );
  assert.equal(await evaluate("window.issueHtmlExecuted ?? false"), false);
  assert.ok(
    (await evaluate('document.querySelector(".meta").textContent')).includes(
      "220 tokens",
    ),
    "small recorded totals must not round down to zero",
  );
  assert.ok(
    await evaluate(
      'document.querySelector(".tool-detail pre:last-child").getBoundingClientRect().height <= 400',
    ),
    "expanded output must remain scrollable instead of occupying thousands of pixels",
  );
  const screenshot = async (name) => {
    if (!process.env.CAPTURE_ISSUE_THREADS) return;
    await fs.mkdir(resolve("docs/screenshots"), { recursive: true });
    await evaluate(
      'document.querySelectorAll(".ev").forEach(n=>n.style.contentVisibility="visible");new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
    const image = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    });
    await fs.writeFile(
      resolve(`docs/screenshots/${name}.png`),
      Buffer.from(image.data, "base64"),
    );
  };
  for (const width of [1440, 390]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 390 ? 900 : 1100,
      deviceScaleFactor: 1,
      mobile: width === 390,
    });
    for (const theme of ["dark", "light"]) {
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)}`,
      );
      for (const number of [9, 10, 11, 12]) {
        await evaluate(`location.hash='#/issue/${number}'`);
        await until(
          `document.querySelector('.ihead')?.dataset.issue === '${number}'`,
        );
        await evaluate(
          "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
        );
        assert.equal(
          await evaluate("document.documentElement.scrollWidth <= innerWidth"),
          true,
          `${width}/${theme}/${number} overflow`,
        );
        assert.equal(
          await evaluate("window.issueHtmlExecuted ?? false"),
          false,
        );
        if (number === 9) {
          await evaluate('document.querySelector(".tool").open=true');
          assert.match(
            await evaluate('document.querySelector(".thread").textContent'),
            /tokens: task 2.4k/,
          );
          assert.match(
            await evaluate('document.querySelector(".meta").textContent'),
            /all retained attempts/,
          );
        } else if (number === 10) {
          assert.match(
            await evaluate('document.querySelector(".error-box").textContent'),
            /Which branch/,
          );
          assert.match(
            await evaluate('document.querySelector(".meta").textContent'),
            /Cost not recorded/,
          );
        } else if (number === 11) {
          const elapsedBefore = await evaluate(
            'document.querySelector("[data-live-elapsed]").textContent',
          );
          const sequence = ++liveSequence;
          const start = Date.now();
          await fs.appendFile(
            join(activeSession, "main.jsonl"),
            JSON.stringify(
              piEntry(
                `live-${sequence}`,
                "assistant",
                [
                  {
                    type: "toolCall",
                    id: `call-${sequence}`,
                    name: "read",
                    arguments: { path: `live-file-${sequence}.ts` },
                  },
                ],
                new Date().toISOString(),
              ),
            ) + "\n",
          );
          await until(
            `document.querySelector('.thread').textContent.includes('live-file-${sequence}.ts')`,
          );
          latencies.push(Date.now() - start);
          assert.ok(latencies.at(-1) < 5000);
          await until(
            `document.querySelector('[data-live-elapsed]').textContent !== ${JSON.stringify(elapsedBefore)}`,
          );
          await evaluate(
            'document.querySelector(".tool").open=true;document.querySelector(".tool summary").focus({preventScroll:true});document.querySelector(".rail").scrollLeft=80;scrollTo(0,0)',
          );
          const railScroll = await evaluate(
            'document.querySelector(".rail").scrollLeft',
          );
          await fs.appendFile(
            join(activeRun, "history.jsonl"),
            JSON.stringify({
              schemaVersion: 1,
              issue: 11,
              runId: boardProgress().runId,
              sequence,
              at: new Date().toISOString(),
              kind: "progress",
              text: `live-progress-${sequence}`,
              stream: "stderr",
            }) + "\n",
          );
          await until(
            `document.querySelector('.thread').textContent.includes('live-progress-${sequence}')`,
          );
          await evaluate(
            "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
          );
          assert.equal(await evaluate("scrollY"), 0);
          assert.equal(
            await evaluate('document.querySelector(".tool").open'),
            true,
          );
          assert.equal(
            await evaluate(
              'document.activeElement === document.querySelector(".tool summary")',
            ),
            true,
          );
          assert.equal(
            await evaluate('document.querySelector(".rail").scrollLeft'),
            railScroll,
          );
          for (const type of ["keyDown", "keyUp"])
            await send("Input.dispatchKeyEvent", {
              type,
              key: "Enter",
              code: "Enter",
              windowsVirtualKeyCode: 13,
              ...(type === "keyDown" ? { text: "\r" } : {}),
            });
          assert.equal(
            await evaluate('document.querySelector(".tool").open'),
            false,
          );
        } else {
          assert.equal(
            await evaluate('document.querySelector(".issue-body").textContent'),
            attack,
          );
          assert.equal(
            await evaluate('document.querySelectorAll(".ev").length'),
            0,
          );
        }
        await screenshot(
          `issue-thread-${number === 9 ? "finished" : number === 10 ? "blocked" : number === 11 ? "active" : "empty"}-${width === 390 ? "mobile" : "desktop"}-${theme}`,
        );
      }
    }
  }
  await evaluate("location.hash='#/issue/11'");
  await until(
    'document.querySelector(".ihead")?.dataset.issue === "11" && document.querySelector("[data-live-elapsed]") && document.querySelector(".connection-state")?.textContent === "Live"',
  );
  const liveOrigin = await evaluate("performance.timeOrigin");
  await fs.writeFile(
    join(activeRun, "result.json"),
    JSON.stringify({
      issue: 11,
      runId: boardProgress().runId,
      startedAt: activeStart,
      finishedAt: new Date().toISOString(),
      sessions: [{ phase: "planning" }],
      outcome: {
        issue: 11,
        status: "completed",
        label: "done",
        summary: "Finished",
      },
    }),
  );
  await lock.release();
  await until(
    'document.querySelector(".ihead")?.dataset.issue === "11" && !document.querySelector("[data-live-elapsed]")',
  );
  const finalMeta = await evaluate(
    'document.querySelector(".meta").textContent',
  );
  assert.match(finalMeta, /Finished/);
  assert.match(finalMeta, /Planning/);
  assert.match(finalMeta, /\$0\.5000/);
  assert.equal(await evaluate("performance.timeOrigin"), liveOrigin);
  const frozenElapsed = await evaluate(
    'document.querySelector(".meta").textContent',
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(
    await evaluate('document.querySelector(".meta").textContent'),
    frozenElapsed,
  );
  for (const width of [1440, 390]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: width === 390 ? 900 : 1100,
      deviceScaleFactor: 1,
      mobile: width === 390,
    });
    for (const theme of ["dark", "light"]) {
      await evaluate(
        `document.documentElement.dataset.theme=${JSON.stringify(theme)};scrollTo(0,0)`,
      );
      await screenshot(
        `issue-thread-live-ended-${width === 390 ? "mobile" : "desktop"}-${theme}`,
      );
    }
  }
  console.log(JSON.stringify({ liveToolLatenciesMs: latencies }));
  if (replay) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1100,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      `document.documentElement.dataset.theme='dark';location.hash='#/issue/${replay.issue}'`,
    );
    await until(
      `document.querySelector('.ihead')?.dataset.issue === '${replay.issue}'`,
    );
    const observed = await evaluate(
      `({ tools:document.querySelectorAll('.tool').length, phases:[...document.querySelectorAll('.step-line')].map(n=>n.textContent.replace(/^\\d+/, '').trim()), meta:document.querySelector('.meta').textContent })`,
    );
    assert.equal(observed.tools, replay.toolCalls);
    assert.deepEqual(observed.phases, replay.phases);
    if (replay.cost !== null)
      assert.ok(
        observed.meta.includes(replay.cost),
        "replayed header cost must match retained usage",
      );
    await evaluate('document.querySelector(".tool").open=true;scrollTo(0,0)');
    await screenshot("issue-thread-repository-replay-desktop-dark");
    console.log(
      JSON.stringify(
        {
          sourceComparison: replay,
          browserTools: observed.tools,
          browserPhases: observed.phases,
        },
        null,
        2,
      ),
    );
  }
  assert.deepEqual(exceptions, []);
  assert.equal(
    requests.filter((r) => !["GET", "HEAD"].includes(r.method)).length,
    0,
  );
  console.log(
    "Issue thread browser check passed: 16 layouts, real file snapshots, keyboard tools, HTML as text, final cost, no mutations.",
  );
} finally {
  socket?.close();
  const closed = once(browser, "close");
  browser.kill("SIGTERM");
  await closed;
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 });
  for (const cleanup of cleanups.reverse()) await cleanup();
}
