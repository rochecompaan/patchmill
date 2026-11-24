import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeInteractivePi } from "../../../test-support/fake-interactive-pi.ts";
import type { ThreadEvent } from "../api-types.ts";
import type { SessionChange } from "./types.ts";
import { createWebSession, MAX_ENTRIES } from "./web-session.ts";

const tick = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const ann = { author: "Ann", requestId: "r1" };
const bob = { author: "Bob", requestId: "r2" };

function setup(options: { hold?: boolean; ready?: boolean } = {}) {
  const changes: SessionChange[] = [];
  const timers: (() => void)[] = [];
  const session = createWebSession({
    id: "s1",
    now: () => new Date("2026-11-19T10:00:00.000Z"),
    after: (_ms, fn) => {
      timers.push(fn);
      return () => {
        const i = timers.indexOf(fn);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    onChange: (change) => changes.push(change),
  });
  const fake = fakeInteractivePi(options);
  fake.connect(session.handlers);
  session.attach(fake.pi);
  if (options.ready !== false) fake.ready();
  const entries = () => session.snapshot().entries;
  const last = () => entries().at(-1) as ThreadEvent & Record<string, unknown>;
  const flush = () => {
    for (const fn of timers.splice(0)) fn();
  };
  return { session, fake, changes, entries, last, flush, timers };
}
const select = {
  id: "d1",
  method: "select" as const,
  title: "Approve the plan?",
  options: ["Approve", "Request changes"],
};

test("queues input until Pi is ready", async () => {
  const s = setup({ ready: false });
  assert.deepEqual(s.session.send({ ...ann, text: "hi" }), {
    ok: true,
    duplicate: false,
  });
  await tick();
  assert.deepEqual(s.fake.commands, []);
  assert.equal(s.session.snapshot().state, "starting");
  s.fake.ready();
  await tick();
  assert.deepEqual(s.fake.commands, [{ type: "prompt", text: "Ann: hi" }]);
  assert.equal(s.session.snapshot().state, "idle");
});

test("messages run one at a time", async () => {
  const s = setup({ hold: true });
  s.session.send({ ...ann, text: "one" });
  s.session.send({ ...bob, text: "two" });
  await tick();
  assert.deepEqual(s.fake.commands, [{ type: "prompt", text: "Ann: one" }]);
  s.fake.respond();
  await tick();
  assert.deepEqual(s.fake.commands.at(-1), {
    type: "prompt",
    text: "Bob: two",
  });
});

test("a rejected prompt adds an error entry", async () => {
  const s = setup({ hold: true });
  s.session.send({ ...ann, text: "hi" });
  await tick();
  s.fake.respond("Agent is already processing");
  await tick();
  assert.equal(s.last().kind, "error");
  assert.equal(
    s.last().text,
    "The agent did not get Ann's message: Agent is already processing. Send it again.",
  );
});

test("pause while starting ends the process once it starts", async () => {
  const changes: SessionChange[] = [];
  const session = createWebSession({
    id: "s1",
    now: () => new Date(),
    after: () => () => {},
    onChange: (c) => changes.push(c),
  });
  const paused = session.pause(ann);
  assert.equal(session.signal.aborted, true);
  assert.equal(session.snapshot().state, "pausing");
  assert.deepEqual(session.send({ ...bob, text: "x" }).ok, false);
  const fake = fakeInteractivePi();
  session.attach(fake.pi);
  await paused;
  assert.deepEqual(fake.commands, [{ type: "end" }]);
  assert.equal(session.snapshot().ended?.reason, "paused");
});

test("a refused launch after pause ends as paused", async () => {
  const session = createWebSession({
    id: "s1",
    now: () => new Date(),
    after: () => () => {},
    onChange: () => {},
  });
  const paused = session.pause(ann);
  session.refuse("The start was cancelled.");
  await paused;
  assert.equal(session.snapshot().ended?.reason, "paused");
});

test("a refused launch ends as refused with its reason", async () => {
  const session = createWebSession({
    id: "s1",
    now: () => new Date(),
    after: () => () => {},
    onChange: () => {},
  });
  session.refuse("Issue #7 was claimed elsewhere.");
  await session.ended;
  assert.deepEqual(session.snapshot().ended, {
    reason: "refused",
    message: "Issue #7 was claimed elsewhere.",
  });
});

test("each message shows its author and is not echoed again", async () => {
  const s = setup();
  s.session.send({ ...ann, text: "hi" });
  await tick();
  assert.equal(s.entries().length, 1);
  assert.deepEqual(
    { ...s.last(), id: "", at: "" },
    {
      id: "",
      at: "",
      kind: "message",
      author: "Ann",
      role: "person",
      blocks: [{ kind: "paragraph", content: [{ kind: "text", text: "hi" }] }],
      note: null,
    },
  );
  assert.match(s.last().id, /^web:s1:\d+$/);
  s.fake.emit({
    type: "message_end",
    message: { role: "user", content: [{ type: "text", text: "Ann: hi" }] },
  });
  assert.equal(s.entries().length, 1);
  s.fake.emit({
    type: "message_end",
    message: { role: "user", content: "Start Issue run #7." },
  });
  assert.equal(s.last().kind, "prompt");
  assert.equal(s.last().text, "Start Issue run #7.");
});

test("streamed text becomes one agent entry, replaced at message_end", async () => {
  const s = setup();
  const delta = (contentIndex: number, text: string) =>
    s.fake.emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", contentIndex, delta: text },
    });
  s.fake.emit({ type: "agent_start" });
  assert.equal(s.session.snapshot().state, "replying");
  delta(1, "Hel");
  const updates = s.changes.filter((c) => c.kind === "session-entries").length;
  delta(1, "lo");
  assert.equal(s.entries().length, 1);
  assert.equal(
    s.changes.filter((c) => c.kind === "session-entries").length,
    updates,
  );
  assert.equal(s.timers.length, 1);
  s.flush();
  const streamed = s.changes.at(-1);
  assert.equal(streamed?.kind, "session-entries");
  s.fake.emit({
    type: "message_end",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret" },
        { type: "text", text: "Hello." },
      ],
    },
  });
  assert.equal(s.entries().length, 1);
  assert.deepEqual(s.last().blocks, [
    { kind: "paragraph", content: [{ kind: "text", text: "Hello." }] },
  ]);
  assert.equal(s.timers.length, 0);
  s.fake.emit({ type: "agent_settled" });
  assert.equal(s.session.snapshot().state, "idle");
});

test("tool calls run and complete in place", async () => {
  const s = setup();
  s.fake.emit({
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "bash",
    args: { command: "ls" },
  });
  assert.equal(s.last().state, "running");
  s.fake.emit({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "x".repeat(9000) }] },
    isError: true,
  });
  assert.equal(s.entries().length, 1);
  assert.equal(s.last().state, "failed");
  assert.match(String(s.last().result), /Output shortened\.$/);
  assert.deepEqual(s.last().arguments, { command: "ls" });
});

test("notices and patchmill messages become progress entries; status sets the header", async () => {
  const s = setup();
  s.fake.emit({
    type: "extension_ui_request",
    id: "n1",
    method: "notify",
    message: "Planning starts.",
  });
  s.fake.emit({
    type: "message_end",
    message: {
      role: "custom",
      customType: "patchmill",
      content: "The Issue run continues with implementation.",
    },
  });
  s.fake.emit({
    type: "message_end",
    message: { role: "custom", customType: "other", content: "hidden" },
  });
  s.fake.emit({
    type: "extension_ui_request",
    id: "s1",
    method: "setStatus",
    statusKey: "patchmill",
    statusText: "#7 planning",
  });
  s.fake.emit({ type: "extension_error", extensionPath: "/x", error: "boom" });
  s.fake.emit({ type: "turn_end" });
  assert.deepEqual(
    s.entries().map((e) => [e.kind, "text" in e ? e.text : ""]),
    [
      ["progress", "Planning starts."],
      ["progress", "The Issue run continues with implementation."],
      ["error", "boom"],
    ],
  );
  assert.equal(s.session.snapshot().status, "#7 planning");
});

test("the first answer wins and later answers are rejected", async () => {
  const s = setup();
  s.fake.dialog(select);
  const snapshot = s.session.snapshot();
  assert.equal(snapshot.state, "question");
  assert.deepEqual(snapshot.question, {
    id: "d1",
    kind: "select",
    title: "Approve the plan?",
    message: null,
    options: ["Approve", "Request changes"],
  });
  assert.deepEqual(
    s.session.answer({ ...ann, questionId: "d1", choice: "Approve" }),
    { ok: true, duplicate: false },
  );
  assert.deepEqual(
    s.session.answer({ ...bob, questionId: "d1", choice: "Request changes" }),
    {
      ok: false,
      code: "already_answered",
      message: "Already answered by Ann.",
    },
  );
  assert.deepEqual(
    s.fake.commands.filter((c) => c.type === "answer"),
    [{ type: "answer", id: "d1", answer: { value: "Approve" } }],
  );
  assert.equal(s.last().text, "Ann chose “Approve”.");
  assert.equal(s.session.snapshot().question, null);
  assert.equal(
    s.session.answer({ ...bob, questionId: "zz", choice: "Approve" }).ok ===
      false &&
      (
        s.session.answer({ ...bob, questionId: "zz", choice: "Approve" }) as {
          code: string;
        }
      ).code,
    "no_question",
  );
});

test("confirm questions offer Yes and No and send confirmed", async () => {
  const s = setup();
  s.fake.dialog({ id: "c1", method: "confirm", title: "Go?", message: "Sure" });
  assert.deepEqual(s.session.snapshot().question?.options, ["Yes", "No"]);
  assert.equal(s.session.snapshot().question?.message, "Sure");
  s.session.answer({ ...ann, questionId: "c1", choice: "No" });
  assert.deepEqual(s.fake.commands.at(-1), {
    type: "answer",
    id: "c1",
    answer: { confirmed: false },
  });
});

test("text dialogs are cancelled with a note", async () => {
  const s = setup();
  s.fake.dialog({ id: "t1", method: "input", title: "Name?" });
  assert.deepEqual(s.fake.commands, [
    { type: "answer", id: "t1", answer: { cancelled: true } },
  ]);
  assert.equal(s.session.snapshot().question, null);
  assert.equal(
    s.last().text,
    "Patchmill cancelled a text dialog that the web page cannot show.",
  );
});

test("a choice outside the options is invalid_choice", async () => {
  const s = setup();
  s.fake.dialog(select);
  const result = s.session.answer({ ...ann, questionId: "d1", choice: "Nope" });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.code, "invalid_choice");
  assert.equal(s.session.snapshot().question?.id, "d1");
});

test("stop reply cancels the open question and aborts the turn", async () => {
  const s = setup();
  s.fake.dialog(select);
  s.session.stopReply(ann);
  await tick();
  assert.deepEqual(s.fake.commands, [
    { type: "answer", id: "d1", answer: { cancelled: true } },
    { type: "abort" },
  ]);
  assert.equal(s.session.snapshot().question, null);
  assert.equal(s.last().text, "Ann stopped the reply.");
  const late = s.session.answer({
    ...bob,
    questionId: "d1",
    choice: "Approve",
  });
  assert.equal(!late.ok && late.code, "no_question");
});

test("pause refuses later input and records who paused", async () => {
  const s = setup();
  s.fake.dialog(select);
  await s.session.pause(ann);
  assert.deepEqual(s.fake.commands, [
    { type: "answer", id: "d1", answer: { cancelled: true } },
    { type: "end" },
  ]);
  assert.ok(
    s
      .entries()
      .some((e) => "text" in e && e.text === "Ann paused the Web session."),
  );
  for (const result of [
    s.session.send({ ...bob, text: "x" }),
    s.session.stopReply(bob),
    s.session.answer({ ...bob, questionId: "d1", choice: "Approve" }),
  ])
    assert.equal(!result.ok && result.code, "not_accepting");
  assert.equal(s.session.snapshot().ended?.reason, "paused");
});

test("a server stop records its own divider", async () => {
  const s = setup();
  await s.session.pause(null);
  assert.ok(
    s
      .entries()
      .some(
        (e) => "text" in e && e.text === "The server stopped the Web session.",
      ),
  );
});

test("exit reasons: paused, finished, crashed", async () => {
  const finished = setup();
  finished.fake.emit({
    type: "message_end",
    message: {
      role: "custom",
      customType: "patchmill",
      content: "another Run attempt is active",
    },
  });
  finished.fake.exit({ exitCode: 0, signal: null, requested: false });
  await finished.session.ended;
  assert.deepEqual(finished.session.snapshot().ended, {
    reason: "finished",
    message: "another Run attempt is active",
  });

  const plain = setup();
  plain.fake.exit({ exitCode: 0, signal: null, requested: false });
  await plain.session.ended;
  assert.equal(plain.session.snapshot().ended?.message, "The Issue run ended.");

  const crashed = setup();
  crashed.fake.dialog(select);
  crashed.fake.exit({ exitCode: 3, signal: null, requested: false });
  await crashed.session.ended;
  const snapshot = crashed.session.snapshot();
  assert.equal(snapshot.ended?.reason, "crashed");
  assert.equal(snapshot.question, null);
  assert.equal(
    crashed.last().text,
    "Pi stopped unexpectedly (exit code 3). Press Resume to continue the Issue run. A worker that is still running stops when the next session starts.",
  );

  const paused = setup();
  paused.fake.exit({ exitCode: null, signal: "SIGKILL", requested: true });
  await paused.session.ended;
  assert.equal(paused.session.snapshot().ended?.reason, "paused");
});

test("entries stay at 2000 with an earlier marker", async () => {
  const s = setup();
  for (let i = 0; i < MAX_ENTRIES + 5; i++)
    s.fake.emit({
      type: "extension_ui_request",
      id: `n${i}`,
      method: "notify",
      message: `note ${i}`,
    });
  const entries = s.entries();
  assert.equal(entries.length, MAX_ENTRIES);
  assert.equal(entries[0]?.kind, "earlier");
  assert.equal(
    "text" in entries[0]! && entries[0].text,
    "Earlier Web session messages appear after the Web session ends.",
  );
  assert.equal(
    entries.at(-1) && "text" in entries.at(-1)! && entries.at(-1)!.text,
    `note ${MAX_ENTRIES + 4}`,
  );
});

const EXPIRED =
  "Your authentication token has expired. Please try refreshing it.";
const failedEnd = (
  errorMessage: string,
  content: unknown[] = [],
  stopReason = "error",
) => ({
  type: "message_end",
  message: { role: "assistant", content, stopReason, errorMessage },
});
const errors = (s: ReturnType<typeof setup>) =>
  s.entries().filter((e) => e.kind === "error") as (ThreadEvent & {
    kind: "error";
  })[];

test("a failed reply adds a sign-in error entry", () => {
  const s = setup();
  s.fake.emit({ type: "agent_start" });
  s.fake.emit(failedEnd(EXPIRED));
  s.fake.emit({ type: "agent_settled" });
  assert.equal(s.entries().length, 1);
  const [entry] = errors(s);
  assert.equal(entry?.title, "Sign-in failed");
  assert.match(entry?.text ?? "", /Run patchmill auth/);
  assert.match(entry?.text ?? "", /Your authentication token has expired\./);
  assert.equal(s.session.snapshot().state, "idle");
});

test("each failed reply adds its own error entry", () => {
  const s = setup();
  s.fake.emit(failedEnd(EXPIRED));
  s.fake.emit(failedEnd(EXPIRED));
  const list = errors(s);
  assert.equal(list.length, 2);
  assert.notEqual(list[0]!.id, list[1]!.id);
});

test("text before a failure stays before the error", () => {
  const s = setup();
  s.fake.emit(failedEnd("Overloaded", [{ type: "text", text: "Partial" }]));
  const [message, error] = s.entries() as (ThreadEvent &
    Record<string, unknown>)[];
  assert.equal(message?.kind, "message");
  assert.deepEqual(message?.blocks, [
    { kind: "paragraph", content: [{ kind: "text", text: "Partial" }] },
  ]);
  assert.equal(error?.kind, "error");
  assert.equal(error?.title, "The agent's request failed");
  assert.equal(error?.text, "Overloaded.");
});

test("an aborted reply adds no error entry", () => {
  const s = setup();
  s.fake.emit(failedEnd("Request was aborted", [], "aborted"));
  assert.equal(errors(s).length, 0);
});
