import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  issueThreadFixture,
  piEntry,
} from "../../test-support/issue-thread-fixture.ts";
import { acquireLock } from "../kernel/lock.ts";
import { writeRunProgress } from "../kernel/run-progress.ts";
import { boardProgress } from "../../test-support/board-fixture.ts";
import type { IssueDetail } from "./api-types.ts";
const texts = (d: IssueDetail) => JSON.stringify(d.thread);

test("finished snapshots join tools and retain attempts without counting the idle gap", async (t) => {
  const f = await issueThreadFixture(t);
  await f.attempt({
    messages: [
      piEntry("prompt", "user", "kernel prompt"),
      piEntry("a", "assistant", [
        { type: "text", text: "<b>agent</b>" },
        {
          type: "toolCall",
          id: "r",
          name: "read",
          arguments: { path: "<i>input</i>" },
        },
      ]),
      {
        ...piEntry("r", "toolResult", [
          { type: "text", text: "<script>output</script>" },
        ]),
        message: {
          role: "toolResult",
          toolCallId: "r",
          content: [{ type: "text", text: "<script>output</script>" }],
          isError: false,
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
            id: "b",
            name: "bash",
            arguments: { command: "npm test" },
          },
        ],
        "2026-11-14T13:00:01Z",
      ),
    ],
  });
  const detail = await f.read();
  assert.equal(detail.body, null);
  assert.equal(detail.summary.elapsedSeconds, 90);
  assert.deepEqual(
    detail.thread.filter((e) => e.kind === "divider").map((e) => e.text),
    ["Run attempt 1", "Run attempt 2"],
  );
  assert.deepEqual(
    detail.thread.filter((e) => e.kind === "step").map((e) => e.label),
    ["planning", "implementation"],
  );
  const tools = detail.thread.filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2);
  assert.equal(tools[0]!.result, "<script>output</script>");
  assert.equal(tools[1]!.state, "stopped");
  assert.equal(tools[1]!.result, "Output not recorded.");
  assert.equal(detail.thread.filter((e) => e.kind === "prompt").length, 1);
  assert.equal(detail.finalUsage?.cost?.amount, "0.2000");
});

test("blocked, missing transcript, and no-run snapshots preserve honest text", async (t) => {
  const f = await issueThreadFixture(t);
  const empty = await f.read();
  assert.equal(empty.body, f.issue.body);
  assert.deepEqual(empty.thread, []);
  await f.attempt({ label: "needsInfo", summary: "Which <branch>?" });
  const blocked = await f.read();
  assert.equal(blocked.run?.outcome, "stopped");
  assert.match(texts(blocked), /Which <branch>\?/);
  assert.match(texts(blocked), /Agent transcript not recorded/);
  assert.match(texts(blocked), /Terminal progress was not recorded/);
  assert.equal(blocked.finalUsage, null);
});

test("damaged and oversized lines do not discard later messages or expose thinking", async (t) => {
  const f = await issueThreadFixture(t);
  await f.attempt({
    messages: [
      "broken",
      "x".repeat(16 * 1024 * 1024 + 1),
      { type: "unknown", text: "ignore-me" },
      piEntry("a", "assistant", [
        { type: "thinking", thinking: "private-thinking" },
        { type: "text", text: "valid-after-damage" },
      ]),
      "{partial",
    ],
  });
  const detail = await f.read();
  assert.match(texts(detail), /valid-after-damage/);
  assert.doesNotMatch(texts(detail), /private-thinking|ignore-me/);
  assert.equal(detail.finalUsage, null);
  assert.ok(f.warnings.length > 0);
});

test("fork ancestors and exact duplicates disappear but reused IDs retain distinct work", async (t) => {
  const f = await issueThreadFixture(t);
  const a = piEntry("same", "assistant", [{ type: "text", text: "new-work" }]);
  await f.attempt({
    messages: [
      {
        type: "session",
        timestamp: "2026-11-14T12:00:00Z",
        parentSession: "/do/not/read",
      },
      piEntry(
        "old",
        "assistant",
        [{ type: "text", text: "ancestor-marker" }],
        "2026-11-13T12:00:00Z",
      ),
      a,
      a,
      piEntry("same", "assistant", [{ type: "text", text: "different-work" }]),
      piEntry(
        "untimed",
        "assistant",
        [{ type: "text", text: "untimed-work" }],
        null,
      ),
    ],
  });
  const detail = await f.read();
  const messages = detail.thread.filter((e) => e.kind === "message");
  assert.equal(messages.length, 3);
  assert.doesNotMatch(texts(detail), /ancestor-marker/);
  assert.match(texts(detail), /different-work|untimed-work/);
});

test("results pair by call identity, preserve content order, and shorten Unicode output", async (t) => {
  const f = await issueThreadFixture(t);
  await f.attempt({
    messages: [
      {
        type: "message",
        id: "result",
        message: {
          role: "toolResult",
          toolCallId: "call",
          isError: true,
          content: [
            { type: "text", text: "😀".repeat(8100) },
            { type: "image", data: "private-image" },
          ],
        },
      },
      piEntry("a", "assistant", [
        { type: "text", text: "before" },
        { type: "toolCall", id: "call", name: "read", arguments: {} },
        { type: "text", text: "after" },
      ]),
    ],
  });
  const detail = await f.read();
  const work = detail.thread.filter(
    (e) => e.kind === "message" || e.kind === "tool",
  );
  assert.deepEqual(
    work.map((e) => e.kind),
    ["message", "tool", "message"],
  );
  const tool = detail.thread.find((e) => e.kind === "tool")!;
  assert.equal(tool.state, "failed");
  assert.equal(Array.from(tool.result!.split("\n")[0]!).length, 8000);
  assert.match(tool.result!, /Output shortened/);
  assert.doesNotMatch(texts(detail), /private-image/);
});

test("nested agent usage contributes to billing without a nested transcript", async (t) => {
  const f = await issueThreadFixture(t);
  const { sessionDir } = await f.attempt({
    messages: [
      piEntry("parent", "assistant", [{ type: "text", text: "main-work" }]),
    ],
  });
  await fs.mkdir(join(sessionDir, "subagents"));
  await fs.writeFile(
    join(sessionDir, "subagents/child.jsonl"),
    JSON.stringify(
      piEntry("child", "assistant", [
        { type: "text", text: "nested-private-marker" },
      ]),
    ),
  );
  const detail = await f.read();
  assert.equal(detail.finalUsage?.cost?.amount, "0.2000");
  assert.doesNotMatch(texts(detail), /nested-private-marker/);
});

test("retained progress merges with main work and does not duplicate phase headings", async (t) => {
  const f = await issueThreadFixture(t);
  const { dir } = await f.attempt({
    messages: [piEntry("main", "assistant", [{ type: "text", text: "work" }])],
  });
  const record = {
    schemaVersion: 1,
    issue: 9,
    runId: "20261114-120000-abcd",
    at: "2026-11-14T12:00:00Z",
  };
  await fs.writeFile(
    join(dir, "history.jsonl"),
    [
      {
        ...record,
        sequence: 1,
        kind: "progress",
        stream: "stderr",
        text: "issue #9",
      },
      {
        ...record,
        sequence: 2,
        kind: "session",
        number: 1,
        phase: "planning",
        stage: "implementation",
      },
      {
        ...record,
        sequence: 3,
        kind: "progress",
        stream: "stderr",
        text: "01 planning",
      },
      {
        ...record,
        sequence: 4,
        at: "2026-11-14T12:00:20Z",
        kind: "progress",
        stream: "stderr",
        text: "\u001b[31mtokens: task 2k\u001b[0m",
      },
      {
        ...record,
        sequence: 5,
        issue: 8,
        kind: "progress",
        stream: "stderr",
        text: "foreign-private",
      },
    ]
      .map((r) => JSON.stringify(r))
      .join("\n"),
  );
  const detail = await f.read();
  const progress = detail.thread
    .filter((e) => e.kind === "progress")
    .map((e) => e.text);
  assert.deepEqual(progress, ["issue #9", "tokens: task 2k"]);
  assert.equal(detail.thread.filter((e) => e.kind === "step").length, 1);
  assert.doesNotMatch(texts(detail), /foreign-private/);
});

test("mixed valid and invalid usage is not labelled as a complete cost", async (t) => {
  const f = await issueThreadFixture(t);
  await f.attempt({
    messages: [
      piEntry("valid", "assistant", [{ type: "text", text: "work" }]),
      {
        type: "message",
        id: "bad",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "unpriced" }],
          usage: { input: -1, output: 10 },
        },
      },
    ],
  });
  assert.equal((await f.read()).finalUsage, null);
});

test("symlinked transcripts and non-generated attempt directories are never read", async (t) => {
  const f = await issueThreadFixture(t);
  const { sessionDir } = await f.attempt({ messages: [] });
  const outside = join(f.repoRoot, "private.jsonl");
  await fs.writeFile(
    outside,
    JSON.stringify(
      piEntry("secret", "assistant", [
        { type: "text", text: "outside-sentinel" },
      ]),
    ),
  );
  await fs.symlink(outside, join(sessionDir, "escape.jsonl"));
  await fs.symlink(f.repoRoot, join(f.issueDir, "20261114-140000-eeee"));
  await fs.mkdir(join(f.issueDir, "console"));
  await fs.writeFile(
    join(f.issueDir, "console/result.json"),
    "outside-sentinel",
  );
  const detail = await f.read();
  assert.doesNotMatch(JSON.stringify(detail), /outside-sentinel/);
  assert.equal(detail.finalUsage, null);
});

test("recovered progress never lets billing follow a symlinked result outside the run root", async (t) => {
  const f = await issueThreadFixture(t);
  const { dir } = await f.attempt({
    messages: [
      piEntry("priced", "assistant", [{ type: "text", text: "work" }]),
    ],
  });
  const outside = join(f.repoRoot, "private-result.json");
  await fs.rename(join(dir, "result.json"), outside);
  await fs.symlink(outside, join(dir, "result.json"));
  await writeRunProgress(
    f.issueDir,
    boardProgress({
      state: "ended",
      outcome: { status: "completed", label: "done" },
    }),
  );
  const readFile = fs.readFile;
  let unconfinedMetadataReads = 0;
  t.mock.method(
    fs,
    "readFile",
    async (...args: Parameters<typeof fs.readFile>) => {
      if (String(args[0]) === join(dir, "result.json"))
        unconfinedMetadataReads++;
      return readFile(...args);
    },
  );
  const detail = await f.read();
  assert.equal(unconfinedMetadataReads, 0);
  assert.equal(detail.finalUsage, null);
});

test("history-only recovery derives the latest header and total duration from all retained attempts", async (t) => {
  const f = await issueThreadFixture(t);
  await f.attempt({
    messages: [
      piEntry("first", "assistant", [{ type: "text", text: "planning" }]),
    ],
  });
  const runId = "20261114-130000-bbbb";
  const dir = join(f.issueDir, runId);
  await fs.mkdir(dir);
  const progress = boardProgress({
    runId,
    startedAt: "2026-11-14T13:00:00Z",
    updatedAt: "2026-11-14T13:01:00Z",
    state: "ended",
    phase: "implementation",
    outcome: { status: "stopped", label: "needsInfo" },
    summary: "Which branch?",
  });
  await fs.writeFile(
    join(dir, "history.jsonl"),
    JSON.stringify({
      schemaVersion: 1,
      issue: 9,
      runId,
      sequence: 1,
      at: progress.updatedAt,
      kind: "snapshot",
      progress,
    }),
  );
  const detail = await f.read();
  assert.equal(detail.thread.filter((e) => e.kind === "divider").length, 2);
  assert.equal(detail.run?.outcome, "stopped");
  assert.equal(detail.summary.step, "Implementation");
  assert.equal(detail.summary.elapsedSeconds, 90);
});

test("active attempts withhold history and cost, unlocked progress becomes incomplete", async (t) => {
  const f = await issueThreadFixture(t);
  await f.attempt({
    messages: [
      piEntry("old", "assistant", [{ type: "text", text: "old-history" }]),
    ],
  });
  await writeRunProgress(
    f.issueDir,
    boardProgress({
      issue: 9,
      runId: "20261114-130000-bbbb",
      startedAt: "2026-11-14T13:00:00Z",
      state: "implementation",
      phase: "implementation",
    }),
  );
  const lock = await acquireLock(join(f.issueDir, "lock"), {
    now: () => new Date("2026-11-14T13:00:00Z"),
  });
  t.after(() => lock.release());
  assert.equal((await f.read()).run?.outcome, "active");
  assert.deepEqual((await f.read()).thread, []);
  assert.equal((await f.read()).finalUsage, null);
  await lock.release();
  const ended = await f.read();
  assert.equal(ended.run?.outcome, "incomplete");
  assert.equal(ended.summary.elapsedSeconds, null);
  assert.match(texts(ended), /Run ended before recording a result/);
});
