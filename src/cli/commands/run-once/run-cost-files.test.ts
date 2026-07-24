import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRunCost, type RunCostIo } from "./run-cost-files.ts";

function assistant(id: string): string {
  return JSON.stringify({
    type: "message",
    id,
    message: {
      role: "assistant",
      model: "gpt-5.5",
      usage: {
        input: 1,
        cacheRead: 2,
        cacheWrite: 3,
        output: 4,
        cost: { total: 0.1 },
      },
    },
  });
}

function ioFor(
  files: Record<string, { content: string; mtimeMs: number }>,
): RunCostIo {
  const paths = Object.keys(files);
  return {
    async listJsonlFiles() {
      return paths;
    },
    async stat(path) {
      const file = files[path];
      if (!file) throw new Error(`missing ${path}`);
      return { size: file.content.length, mtimeMs: file.mtimeMs };
    },
    async readFile(path) {
      const file = files[path];
      if (!file) throw new Error(`missing ${path}`);
      return file.content;
    },
  };
}

test("summarizeRunCost uses filename timestamps before mtime when session timestamps are invalid", async () => {
  const report = await summarizeRunCost(
    "/sessions",
    ioFor({
      "/sessions/pi-plan/2026-07-19T12-00-00-000Z_plan.jsonl": {
        content: `${JSON.stringify({ type: "session", timestamp: "invalid" })}\n${assistant("copied")}\n`,
        mtimeMs: 10,
      },
      "/sessions/pi-implementation/2026-07-19T11-00-00-000Z_implementation.jsonl":
        {
          content: `${JSON.stringify({ type: "session", timestamp: "invalid" })}\n${assistant("copied")}\n`,
          mtimeMs: 20,
        },
    }),
  );

  assert.deepEqual(
    report.stages.map((stage) => stage.stage),
    ["pi-implementation"],
  );
});

test("summarizeRunCost prioritizes valid session timestamps over filename timestamps", async () => {
  const report = await summarizeRunCost(
    "/sessions",
    ioFor({
      "/sessions/pi-plan/2026-07-19T11-00-00-000Z_plan.jsonl": {
        content: `${JSON.stringify({ type: "session", timestamp: "2026-07-19T12:00:00.000Z" })}\n${assistant("copied")}\n`,
        mtimeMs: 1,
      },
      "/sessions/pi-implementation/2026-07-19T13-00-00-000Z_implementation.jsonl":
        {
          content: `${JSON.stringify({ type: "session", timestamp: "2026-07-19T10:00:00.000Z" })}\n${assistant("copied")}\n`,
          mtimeMs: 20,
        },
    }),
  );

  assert.deepEqual(
    report.stages.map((stage) => stage.stage),
    ["pi-implementation"],
  );
});

test("summarizeRunCost uses mtime only when session and filename timestamps are unavailable", async () => {
  const report = await summarizeRunCost(
    "/sessions",
    ioFor({
      "/sessions/pi-plan/no-timestamp_plan.jsonl": {
        content: `${JSON.stringify({ type: "session", timestamp: "invalid" })}\n${assistant("copied")}\n`,
        mtimeMs: 20,
      },
      "/sessions/pi-implementation/no-timestamp_implementation.jsonl": {
        content: `${JSON.stringify({ type: "session", timestamp: "invalid" })}\n${assistant("copied")}\n`,
        mtimeMs: 10,
      },
    }),
  );

  assert.deepEqual(
    report.stages.map((stage) => stage.stage),
    ["pi-implementation"],
  );
});

test("summarizeRunCost parses captured JSONL before checking the post-read manifest", async () => {
  let listings = 0;
  const io: RunCostIo = {
    async listJsonlFiles() {
      listings += 1;
      return listings === 1
        ? ["/sessions/a.jsonl"]
        : ["/sessions/a.jsonl", "/sessions/b.jsonl"];
    },
    async stat() {
      return { size: 1, mtimeMs: 1 };
    },
    async readFile() {
      return "{not-json}\n";
    },
  };

  await assert.rejects(
    () => summarizeRunCost("/sessions", io),
    /Malformed Pi session JSON/u,
  );
  assert.equal(listings, 1);
});

test("summarizeRunCost rejects a session manifest that changes after reading", async () => {
  let listings = 0;
  const io: RunCostIo = {
    async listJsonlFiles() {
      listings += 1;
      return listings === 1
        ? ["/sessions/a.jsonl"]
        : ["/sessions/a.jsonl", "/sessions/b.jsonl"];
    },
    async stat() {
      return { size: 1, mtimeMs: 1 };
    },
    async readFile() {
      return `${assistant("entry-a")}\n`;
    },
  };

  await assert.rejects(
    () => summarizeRunCost("/sessions", io),
    /Pi session files changed while calculating run cost/u,
  );
});
