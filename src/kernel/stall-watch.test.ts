import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import type { Phase } from "./phase.ts";
import {
  createStallWatch,
  type StallDecision,
  type StallLimits,
} from "./stall-watch.ts";

const LIMITS: StallLimits = {
  stopAfterMs: 600_000,
  maxStalls: 3,
  command: { defaultSeconds: 1200, maxSeconds: 1500 },
};
const TOP = "main.jsonl";
const CHILD = join("parent", "3f2a", "run-0", "session.jsonl");

async function setup(
  t: TestContext,
  limits: Partial<StallLimits> = {},
  phase: Phase = "implementation",
) {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-stall-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let now = 0;
  const watch = createStallWatch({
    sessionDir: dir,
    limits: { ...LIMITS, ...limits },
    phase,
    now: () => now,
  });
  const append = async (file: string, entry: unknown) => {
    await fs.mkdir(dirname(join(dir, file)), { recursive: true });
    await fs.appendFile(join(dir, file), `${JSON.stringify(entry)}\n`);
  };
  const message = (file: string, message: unknown) =>
    append(file, {
      type: "message",
      timestamp: new Date(1_800_000_000_000 + now).toISOString(),
      message,
    });
  return {
    dir,
    watch,
    at: (ms: number) => {
      now = ms;
    },
    poll: () => watch.poll(),
    raw: (file: string, text: string) => fs.appendFile(join(dir, file), text),
    call: (file: string, id: string, name: string, args: unknown = {}) =>
      message(file, {
        role: "assistant",
        content: [{ type: "toolCall", id, name, arguments: args }],
      }),
    calls: (file: string, calls: [string, string, unknown][]) =>
      message(file, {
        role: "assistant",
        content: calls.map(([id, name, args]) => ({
          type: "toolCall",
          id,
          name,
          arguments: args,
        })),
      }),
    result: (
      file: string,
      id: string,
      name: string,
      text: string,
      isError = false,
    ) =>
      message(file, {
        role: "toolResult",
        toolCallId: id,
        toolName: name,
        content: [{ type: "text", text }],
        isError,
      }),
    user: (file: string, text: string) =>
      message(file, { role: "user", content: [{ type: "text", text }] }),
  };
}

const kinds = (decisions: StallDecision[]) => decisions.map((d) => d.kind);
function only<K extends StallDecision["kind"]>(
  decisions: StallDecision[],
  kind: K,
): Extract<StallDecision, { kind: K }> {
  assert.deepEqual(kinds(decisions), [kind]);
  return decisions[0] as Extract<StallDecision, { kind: K }>;
}

test("quiet time reaches the stop limit and gives one recover decision", async (t) => {
  const s = await setup(t);
  await s.user(TOP, "Do the work.");
  assert.deepEqual(await s.poll(), []);
  s.at(599_999);
  assert.deepEqual(await s.poll(), []);
  s.at(600_000);
  const decision = only(await s.poll(), "recover");
  assert.equal(decision.stall.kind, "stall-stop");
  assert.equal(decision.stall.quietMs, 600_000);
  assert.deepEqual(await s.poll(), []);
});

test("a message_update record resets quiet time", async (t) => {
  const s = await setup(t);
  await s.poll();
  s.at(500_000);
  s.watch.record({ type: "message_update" });
  s.at(600_000);
  assert.deepEqual(await s.poll(), []);
});

test("heartbeat records are not activity", async (t) => {
  const s = await setup(t);
  await s.poll();
  for (let ms = 1000; ms < 600_000; ms += 1000) {
    s.at(ms);
    s.watch.record({ type: "extension_ui_request" });
    s.watch.record({ type: "tool_execution_update" });
  }
  s.at(600_000);
  only(await s.poll(), "recover");
});

test("a growing child session file is activity", async (t) => {
  const s = await setup(t);
  await s.call(TOP, "w1", "bg_wait", { id: "3f2a" });
  await s.poll();
  for (let ms = 300_000; ms <= 1_800_000; ms += 300_000) {
    s.at(ms);
    await s.user(CHILD, `step ${ms}`);
    assert.deepEqual(await s.poll(), [], `at ${ms}`);
  }
});

test("subagent-artifacts files are not activity", async (t) => {
  const s = await setup(t);
  await s.user(TOP, "go");
  await s.poll();
  s.at(300_000);
  await s.user(join("subagent-artifacts", "x_transcript.jsonl"), "noise");
  assert.deepEqual(await s.poll(), []);
  s.at(600_000);
  only(await s.poll(), "recover");
});

test("an open bash call inside its timeout is exempt", async (t) => {
  const s = await setup(t);
  await s.call(TOP, "b1", "bash", { command: "npm   test", timeout: 1500 });
  await s.poll();
  for (const ms of [600_000, 1_560_000, 2_159_999]) {
    s.at(ms);
    assert.deepEqual(await s.poll(), [], `at ${ms}`);
  }
  s.at(2_160_000);
  const decision = only(await s.poll(), "recover");
  assert.equal(decision.stall.calls[0]?.command, "npm test");
});

test("an open bash call without a timeout uses the default", async (t) => {
  const s = await setup(t);
  await s.call(TOP, "b1", "bash", { command: "sleep 9999" });
  await s.poll();
  s.at(1_200_000 + 60_000 + 599_999);
  assert.deepEqual(await s.poll(), []);
  s.at(1_200_000 + 60_000 + 600_000);
  only(await s.poll(), "recover");
});

test("an open bash call is not exempt when both command limits are 0", async (t) => {
  const s = await setup(t, { command: { defaultSeconds: 0, maxSeconds: 0 } });
  await s.call(TOP, "b1", "bash", { command: "sleep 9999" });
  await s.poll();
  s.at(600_000);
  only(await s.poll(), "recover");
});

test("a later user or assistant message closes an open call", async (t) => {
  const s = await setup(t);
  await s.call(TOP, "w1", "bg_wait", { id: "x" });
  await s.user(TOP, "next");
  await s.poll();
  s.at(600_000);
  const decision = only(await s.poll(), "recover");
  assert.deepEqual(decision.stall.calls, []);
  assert.match(decision.prompt, /none: the model reply made no progress/);
});

test("a sibling tool result does not close an open call", async (t) => {
  const s = await setup(t);
  await s.calls(TOP, [
    ["w1", "bg_wait", { id: "x" }],
    ["r1", "read", { path: "a" }],
  ]);
  await s.result(TOP, "r1", "read", "text");
  await s.poll();
  s.at(600_000);
  const decision = only(await s.poll(), "recover");
  assert.deepEqual(
    decision.stall.calls.map((call) => call.tool),
    ["bg_wait"],
  );
});

test("a call left open by a killed run is not a repeat", async (t) => {
  const s = await setup(t);
  await s.call(CHILD, "b1", "bash", { command: "npm test" });
  await s.call(TOP, "w1", "bg_wait", { id: "3f2a" });
  await s.poll();
  s.at(LIMITS.stopAfterMs + 1_260_000);
  const first = only(await s.poll(), "recover");
  assert.equal(first.stall.calls.length, 2);
  s.watch.recovered();
  await s.user(TOP, first.prompt);
  await s.poll();
  s.at(LIMITS.stopAfterMs * 2 + 1_260_000);
  const second = only(await s.poll(), "recover");
  assert.deepEqual(second.stall.calls, []);
  assert.match(second.prompt, /none new/);
});

test("a partial line and a split UTF-8 character are parsed on the next poll", async (t) => {
  const s = await setup(t, { command: { defaultSeconds: 0, maxSeconds: 0 } });
  const line = Buffer.from(
    `${JSON.stringify({
      type: "message",
      timestamp: "2027-01-15T08:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "b1",
            name: "bash",
            arguments: { command: "echo é" },
          },
        ],
      },
    })}\n`,
  );
  const cut = line.indexOf(Buffer.from("é")) + 1;
  await fs.writeFile(join(s.dir, TOP), line.subarray(0, cut));
  await s.poll();
  await fs.appendFile(join(s.dir, TOP), line.subarray(cut));
  await s.poll();
  s.at(600_000);
  const decision = only(await s.poll(), "recover");
  assert.equal(decision.stall.calls[0]?.command, "echo é");
});

for (const suffix of [
  "",
  ". The shell exited with code 0 after 3 seconds, but background processes it started kept writing output until the timeout.",
]) {
  test(`a timed-out bash result is a recorded stall${suffix ? " (with shell exit)" : ""}`, async (t) => {
    const s = await setup(t);
    await s.call(CHILD, "b1", "bash", { command: "npm test" });
    await s.result(
      CHILD,
      "b1",
      "bash",
      `out\n\nCommand timed out after 1200 seconds${suffix}`,
      true,
    );
    const decision = only(await s.poll(), "recorded");
    assert.equal(decision.stall.kind, "command-timeout");
    assert.equal(decision.stall.quietMs, 1_200_000);
    assert.equal(decision.stall.calls[0]?.session, CHILD);
    assert.equal(decision.stall.calls[0]?.run, "3f2a");
  });
}

test("a non-error bash result with the timeout text is not a stall", async (t) => {
  const s = await setup(t);
  await s.call(TOP, "b1", "bash", { command: "cat log" });
  await s.result(TOP, "b1", "bash", "Command timed out after 5 seconds");
  assert.deepEqual(await s.poll(), []);
});

test("the same command twice blocks", async (t) => {
  const s = await setup(t);
  await s.call(TOP, "b1", "bash", { command: "npm  test" });
  await s.result(
    TOP,
    "b1",
    "bash",
    "Command timed out after 1200 seconds",
    true,
  );
  only(await s.poll(), "recorded");
  await s.call(TOP, "b2", "bash", { command: "npm test", timeout: 1 });
  await s.poll();
  s.at(61_000 + 600_000);
  const decision = only(await s.poll(), "block");
  assert.match(
    decision.reason,
    /^The implementation session stopped: the same command stalled twice\./,
  );
  assert.equal(decision.stalls.length, 2);
  assert.deepEqual(await s.poll(), []);
});

test("the third stall blocks, also when it is a command timeout", async (t) => {
  const s = await setup(t);
  await s.call(TOP, "w1", "bg_wait", { id: "a" });
  await s.poll();
  s.at(600_000);
  only(await s.poll(), "recover");
  s.watch.recovered();
  await s.call(TOP, "w2", "bg_wait", { id: "b" });
  await s.poll();
  s.at(1_200_000);
  only(await s.poll(), "recover");
  s.watch.recovered();
  await s.call(TOP, "b1", "bash", { command: "make" });
  await s.result(
    TOP,
    "b1",
    "bash",
    "Command timed out after 1200 seconds",
    true,
  );
  const decision = only(await s.poll(), "block");
  assert.match(
    decision.reason,
    /^The implementation session stopped after 3 stalls\./,
  );
  assert.match(decision.reason, /Command timeout after 20 min/);
});

test("maxStalls 0 never blocks on count", async (t) => {
  const s = await setup(t, { maxStalls: 0 });
  for (let n = 1; n <= 5; n++) {
    await s.call(TOP, `w${n}`, "bg_wait", { id: `r${n}` });
    await s.poll();
    s.at(600_000 * n);
    const decision = only(await s.poll(), "recover");
    assert.match(decision.prompt, new RegExp(`This is stall ${n}\\.`));
    s.watch.recovered();
  }
});

test("stopAfterMs 0 gives no stall stop", async (t) => {
  const s = await setup(t, { stopAfterMs: 0 });
  await s.poll();
  s.at(100 * 600_000);
  assert.deepEqual(await s.poll(), []);
});

test("fail turns the last stall into a block", async (t) => {
  const s = await setup(t);
  await s.poll();
  s.at(600_000);
  only(await s.poll(), "recover");
  const decision = s.watch.fail("no session file");
  assert.match(
    decision.reason,
    /^The implementation session stopped: Patchmill could not restart Pi after a stall \(no session file\)\./,
  );
  assert.equal(decision.stalls.length, 1);
});

test("the recovery prompt names the calls, their durations and the background run", async (t) => {
  const s = await setup(t, { command: { defaultSeconds: 0, maxSeconds: 0 } });
  await s.call(TOP, "w1", "bg_wait", { id: "3f2a" });
  await s.poll();
  s.at(120_000);
  await s.call(CHILD, "b1", "bash", { command: "npm test" });
  await s.poll();
  s.at(720_000);
  const decision = only(await s.poll(), "recover");
  for (const text of [
    "This is stall 1 of 3.",
    "implementation session: bg_wait, started",
    "ran 12 min",
    "subagent run 3f2a: bash `npm test`",
    "ran 10 min",
    "check run 3f2a",
  ])
    assert.ok(decision.prompt.includes(text), text);
  assert.match(decision.restartPrompt, /^Patchmill restarted Pi\./m);
  s.watch.recovered();
  for (let n = 0; n < 6; n++)
    await s.call(TOP, `r${n}`, "read", { path: `${n}` });
  await s.poll();
  s.at(720_000 + 600_000);
  const next = only(await s.poll(), "recover");
  assert.equal(next.stall.tried.length, 5);
});

test("long command text is cut and quoted", async (t) => {
  const s = await setup(t, { command: { defaultSeconds: 0, maxSeconds: 0 } });
  await s.call(TOP, "b1", "bash", { command: `echo \`x\` ${"y".repeat(300)}` });
  await s.poll();
  s.at(600_000);
  const decision = only(await s.poll(), "recover");
  const span = /bash `([^`]*)`/.exec(decision.prompt)?.[1] ?? "";
  assert.ok(span.length <= 200, String(span.length));
  assert.ok(span.startsWith("echo 'x'"));
});

test("sessionFile names the top-level session file", async (t) => {
  const s = await setup(t);
  assert.equal(s.watch.sessionFile(), undefined);
  await s.user(CHILD, "child");
  await s.user(TOP, "top");
  await s.poll();
  assert.equal(s.watch.sessionFile(), join(s.dir, TOP));
});

test("a planning watch names the planning session", async (t) => {
  const s = await setup(t, {}, "planning");
  await s.call(TOP, "b1", "bash", { command: "npm  test" });
  await s.result(
    TOP,
    "b1",
    "bash",
    "Command timed out after 1200 seconds",
    true,
  );
  const recorded = only(await s.poll(), "recorded");
  assert.equal(recorded.stall.calls[0]!.session, "planning session");
  await s.call(TOP, "b2", "bash", { command: "npm test", timeout: 1 });
  await s.poll();
  s.at(61_000 + 600_000);
  const decision = only(await s.poll(), "block");
  assert.match(
    decision.reason,
    /^The planning session stopped: the same command stalled twice\./,
  );
});
