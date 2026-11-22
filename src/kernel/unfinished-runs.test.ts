import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { explainMissingResult, unfinishedRuns } from "./unfinished-runs.ts";
import { MISSING_RESULT_REASON, type ParsedResult } from "./result.ts";

const missing: ParsedResult = {
  ok: false,
  reason: MISSING_RESULT_REASON,
  missing: true,
};

const RUN = "c4856e0b-4247-4f52-9a9b-cf0f9b326737";
const START = "2026-11-20T07:53:05.900Z";
const LATER = "2026-11-20T08:27:42.542Z";

const lines = (...entries: unknown[]) =>
  entries
    .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)))
    .join("\n") + "\n";

const header = (timestamp: string) => ({
  type: "session",
  version: 3,
  id: "s",
  timestamp,
});

const call = (
  timestamp: string,
  toolCallId: string,
  args: Record<string, unknown>,
  name = "subagent",
) => ({
  type: "message",
  timestamp,
  message: {
    role: "assistant",
    content: [{ type: "toolCall", id: toolCallId, name, arguments: args }],
  },
});

const receipt = (
  timestamp: string,
  toolCallId: string,
  asyncId: string,
  text = "Async run started.",
  isError = false,
) => ({
  type: "message",
  timestamp,
  message: {
    role: "toolResult",
    toolCallId,
    toolName: "subagent",
    content: [{ type: "text", text }],
    details: { asyncId },
    isError,
  },
});

const notify = (timestamp: string, runId: string) => ({
  type: "custom_message",
  customType: "subagent-notify",
  timestamp,
  details: { runs: [{ runId, status: "completed" }] },
});

const waited = (timestamp: string, runId: string) => ({
  type: "message",
  timestamp,
  message: {
    role: "toolResult",
    toolCallId: "w1",
    toolName: "bg_wait",
    content: [{ type: "text", text: "done" }],
    details: { completions: [{ runId, state: "complete" }] },
    isError: false,
  },
});

const resumeSession = lines(
  header(START),
  call("2026-11-20T08:27:42.435Z", "c1", {
    action: "resume",
    id: "7afc4d89",
    async: false,
  }),
  receipt(
    LATER,
    "c1",
    RUN,
    "Revived foreground subagent from 7afc4d89.\nAgent: reviewer\n",
  ),
);

test("a resume receipt without a notice is unfinished", () => {
  assert.deepEqual(unfinishedRuns(resumeSession), [
    { runId: RUN, agent: "reviewer" },
  ]);
});

test("a launch takes its agent from the tool call", () => {
  const text = lines(
    header(START),
    call(LATER, "c1", { agent: "reviewer", async: true }),
    receipt(LATER, "c1", RUN),
  );
  assert.deepEqual(unfinishedRuns(text), [{ runId: RUN, agent: "reviewer" }]);
});

test("a resume takes the agent of the run it resumes", () => {
  const text = lines(
    header(START),
    call(LATER, "c1", { agent: "reviewer", async: true }),
    receipt(LATER, "c1", "first"),
    notify(LATER, "first"),
    call(LATER, "c2", { action: "resume", id: "first" }),
    receipt(LATER, "c2", RUN),
  );
  assert.deepEqual(unfinishedRuns(text), [{ runId: RUN, agent: "reviewer" }]);
});

test("a subagent-notify message finishes a run", () => {
  assert.deepEqual(
    unfinishedRuns(resumeSession + lines(notify(LATER, RUN))),
    [],
  );
});

test("bg_wait completion finishes a run", () => {
  assert.deepEqual(
    unfinishedRuns(resumeSession + lines(waited(LATER, RUN))),
    [],
  );
});

test("a stop of the run finishes it", () => {
  const stop = {
    type: "message",
    timestamp: LATER,
    message: {
      role: "toolResult",
      toolCallId: "c2",
      toolName: "subagent",
      content: [{ type: "text", text: "Stopped." }],
      isError: false,
    },
  };
  assert.deepEqual(
    unfinishedRuns(
      resumeSession +
        lines(call(LATER, "c2", { action: "stop", id: RUN }), stop),
    ),
    [],
  );
});

test("an error tool result starts no run", () => {
  const text = lines(
    header(START),
    call(LATER, "c1", { agent: "reviewer" }),
    receipt(LATER, "c1", RUN, "failed", true),
  );
  assert.deepEqual(unfinishedRuns(text), []);
});

test("ignores entries copied from before the fork", () => {
  const text = lines(
    header(START),
    call("2026-11-20T05:00:00.000Z", "c1", { agent: "reviewer" }),
    receipt("2026-11-20T05:00:00.100Z", "c1", RUN),
  );
  assert.deepEqual(unfinishedRuns(text), []);
});

test("without a header every entry counts", () => {
  const text = lines(
    call("2026-11-20T05:00:00.000Z", "c1", { agent: "reviewer" }),
    receipt("2026-11-20T05:00:00.100Z", "c1", RUN),
  );
  assert.deepEqual(unfinishedRuns(text), [{ runId: RUN, agent: "reviewer" }]);
});

test("skips lines that are not JSON objects", () => {
  const text = lines(
    "not json",
    header(START),
    "[]",
    "",
    "null",
    call(LATER, "c1", { agent: "reviewer" }),
    '{"type":"message","timestamp":',
    receipt(LATER, "c1", RUN),
  );
  assert.deepEqual(unfinishedRuns(text), [{ runId: RUN, agent: "reviewer" }]);
});

async function tempDir(t: test.TestContext): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), "patchmill-unfinished-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("explainMissingResult names the run in a missing result reason", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(join(dir, "a.jsonl"), resumeSession);
  assert.deepEqual(await explainMissingResult(missing, dir), {
    ok: false,
    reason: `${MISSING_RESULT_REASON} It ended its turn while its reviewer run ${RUN} was still running.`,
    missing: true,
  });
});

test("explainMissingResult names one run with an unknown agent", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(
    join(dir, "a.jsonl"),
    lines(header(START), receipt(LATER, "c1", "1a2b")),
  );
  assert.deepEqual(await explainMissingResult(missing, dir), {
    ok: false,
    reason: `${MISSING_RESULT_REASON} It ended its turn while its subagent run 1a2b was still running.`,
    missing: true,
  });
});

test("explainMissingResult lists several runs", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(join(dir, "a.jsonl"), resumeSession);
  await fs.writeFile(
    join(dir, "b.jsonl"),
    lines(header(START), receipt(LATER, "c9", "1a2b")),
  );
  assert.deepEqual(await explainMissingResult(missing, dir), {
    ok: false,
    reason: `${MISSING_RESULT_REASON} It ended its turn while its subagent runs reviewer ${RUN}, 1a2b were still running.`,
    missing: true,
  });
});

test("explainMissingResult keeps other results", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(join(dir, "a.jsonl"), resumeSession);
  const done = {
    ok: true as const,
    result: { status: "done" as const, summary: "ok" },
  };
  const invalid = { ok: false as const, reason: "invalid JSON: x" };
  // The reason text alone does not mark a missing block.
  const legacy = { ok: false as const, reason: "no result" };
  assert.equal(await explainMissingResult(legacy, dir), legacy);
  assert.equal(await explainMissingResult(done, dir), done);
  assert.equal(await explainMissingResult(invalid, dir), invalid);
});

test("explainMissingResult reads only top-level session files", async (t) => {
  const dir = await tempDir(t);
  await fs.mkdir(join(dir, "child", "run-0"), { recursive: true });
  await fs.writeFile(
    join(dir, "child", "run-0", "session.jsonl"),
    resumeSession,
  );
  await fs.writeFile(join(dir, "a.jsonl"), lines(header(START)));
  assert.deepEqual(await explainMissingResult(missing, dir), missing);
});

test("explainMissingResult keeps the missing result for a missing directory", async (t) => {
  const dir = await tempDir(t);
  assert.deepEqual(
    await explainMissingResult(missing, join(dir, "missing")),
    missing,
  );
});
