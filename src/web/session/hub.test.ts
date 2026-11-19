import assert from "node:assert/strict";
import { test } from "node:test";
import { feedClock } from "../../../test-support/feed-clock.ts";
import { fakeInteractivePi } from "../../../test-support/fake-interactive-pi.ts";
import { createSessionHub } from "./hub.ts";
import type {
  LaunchResult,
  PiHandlers,
  SessionChange,
  SessionLauncher,
} from "./types.ts";

const tick = async (n = 4) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const as = (author: string, requestId: string) => ({ author, requestId });

function setup(
  options: {
    lockHeld?: (issue: number) => Promise<boolean>;
    launch?: SessionLauncher;
  } = {},
) {
  const clock = feedClock();
  const launched: {
    issue: number;
    signal: AbortSignal;
    fake: ReturnType<typeof fakeInteractivePi>;
  }[] = [];
  let n = 0;
  const launch: SessionLauncher =
    options.launch ??
    (async (issue, handlers: PiHandlers, _report, signal) => {
      const fake = fakeInteractivePi();
      fake.connect(handlers);
      fake.ready();
      launched.push({ issue, signal, fake });
      return { kind: "started", pi: fake.pi };
    });
  const warnings: string[] = [];
  const hub = createSessionHub({
    launch,
    lockHeld: options.lockHeld ?? (async () => false),
    clock,
    id: () => `s${++n}`,
    retainMs: 1000,
    warn: (m) => warnings.push(m),
  });
  return { hub, clock, launched, warnings };
}

test("one session per issue, even for two starts in the same tick", async () => {
  const s = setup();
  const [a, b] = await Promise.all([
    s.hub.start(7, as("Ann", "a")),
    s.hub.start(7, as("Bob", "b")),
  ]);
  assert.deepEqual(a, { ok: true, duplicate: false });
  assert.deepEqual(b, {
    ok: false,
    code: "session_live",
    message: "This issue already has a Web session.",
  });
  await tick();
  assert.equal(s.launched.length, 1);
  assert.deepEqual(await s.hub.start(8, as("Bob", "c")), {
    ok: true,
    duplicate: false,
  });
});

test("a held issue lock refuses the start and frees the issue", async () => {
  let held = true;
  const s = setup({ lockHeld: async () => held });
  assert.deepEqual(await s.hub.start(7, as("Ann", "a")), {
    ok: false,
    code: "run_live",
    message:
      "This issue has a live run in another process. Wait for it to finish.",
  });
  assert.equal(s.hub.current(7), null);
  held = false;
  // The refused request ID stays usable.
  assert.deepEqual(await s.hub.start(7, as("Ann", "a")), {
    ok: true,
    duplicate: false,
  });
});

test("a retried start with the same request ID counts once", async () => {
  const gate = Promise.withResolvers<boolean>();
  const s = setup({ lockHeld: () => gate.promise });
  const first = s.hub.start(7, as("Ann", "a"));
  // The retry arrives while the lock check is still pending.
  assert.deepEqual(await s.hub.start(7, as("Ann", "a")), {
    ok: true,
    duplicate: true,
  });
  gate.resolve(false);
  assert.deepEqual(await first, { ok: true, duplicate: false });
  assert.deepEqual(await s.hub.start(7, as("Ann", "a")), {
    ok: true,
    duplicate: true,
  });
  await tick();
  assert.equal(s.launched.length, 1);
});

test("a retried message with the same request ID is sent once", async () => {
  const s = setup();
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  assert.deepEqual(s.hub.send(7, { ...as("Ann", "m1"), text: "hi" }), {
    ok: true,
    duplicate: false,
  });
  assert.deepEqual(s.hub.send(7, { ...as("Ann", "m1"), text: "hi" }), {
    ok: true,
    duplicate: true,
  });
  await tick();
  const prompts = s.launched[0]!.fake.commands.filter(
    (c) => c.type === "prompt",
  );
  assert.deepEqual(prompts, [{ type: "prompt", text: "Ann: hi" }]);
  assert.equal(s.hub.current(7)?.entries.length, 1);
});

test("a refused input keeps its request ID usable", async () => {
  const s = setup();
  assert.deepEqual(s.hub.send(7, { ...as("Ann", "m1"), text: "hi" }), {
    ok: false,
    code: "no_session",
    message: "This issue has no live Web session.",
  });
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  const fake = s.launched[0]!.fake;
  fake.dialog({ id: "d1", method: "select", title: "?", options: ["A"] });
  const bad = s.hub.answer(7, {
    ...as("Ann", "q1"),
    questionId: "d1",
    choice: "B",
  });
  assert.equal(!bad.ok && bad.code, "invalid_choice");
  assert.deepEqual(
    s.hub.answer(7, { ...as("Ann", "q1"), questionId: "d1", choice: "A" }),
    { ok: true, duplicate: false },
  );
  assert.deepEqual(s.hub.send(7, { ...as("Ann", "m1"), text: "hi" }), {
    ok: true,
    duplicate: false,
  });
});

test("a launch refusal ends the session with the reason and frees the issue", async () => {
  let refuse = true;
  const s = setup({
    launch: async (_issue, handlers): Promise<LaunchResult> => {
      if (refuse)
        return { kind: "refused", reason: "Issue #7 was claimed elsewhere." };
      const fake = fakeInteractivePi();
      fake.connect(handlers);
      return { kind: "started", pi: fake.pi };
    },
  });
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  assert.deepEqual(s.hub.current(7)?.ended, {
    reason: "refused",
    message: "Issue #7 was claimed elsewhere.",
  });
  refuse = false;
  assert.deepEqual(await s.hub.start(7, as("Ann", "b")), {
    ok: true,
    duplicate: false,
  });
});

test("a launch that throws ends the session as refused", async () => {
  const s = setup({
    launch: async () => {
      throw new Error("provision failed");
    },
  });
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  assert.deepEqual(s.hub.current(7)?.ended, {
    reason: "refused",
    message: "provision failed",
  });
});

test("crash closes the open question and frees the issue", async () => {
  const s = setup();
  const changes: SessionChange[] = [];
  s.hub.subscribe(7, (c) => changes.push(c));
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  const fake = s.launched[0]!.fake;
  fake.dialog({ id: "d1", method: "select", title: "?", options: ["A"] });
  assert.equal(s.hub.current(7)?.question?.id, "d1");
  fake.exit({ exitCode: 3, signal: null, requested: false });
  await tick();
  const current = s.hub.current(7);
  assert.equal(current?.question, null);
  assert.equal(current?.state, "ended");
  assert.equal(current?.ended?.reason, "crashed");
  const last = changes.filter((c) => c.kind === "session").at(-1);
  assert.equal(last?.kind === "session" && last.session?.question, null);
  const late = s.hub.answer(7, {
    ...as("Bob", "q"),
    questionId: "d1",
    choice: "A",
  });
  assert.equal(!late.ok && late.code, "no_session");
  assert.deepEqual(await s.hub.start(7, as("Ann", "b")), {
    ok: true,
    duplicate: false,
  });
  assert.equal(s.hub.current(7)?.state, "starting");
});

test("an ended session is kept for retainMs, then removed", async () => {
  const s = setup();
  const changes: SessionChange[] = [];
  s.hub.subscribe(7, (c) => changes.push(c));
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  s.launched[0]!.fake.exit({ exitCode: 0, signal: null, requested: false });
  await tick();
  assert.equal(s.hub.current(7)?.ended?.reason, "finished");
  await s.clock.advance(999);
  assert.ok(s.hub.current(7));
  await s.clock.advance(1);
  assert.equal(s.hub.current(7), null);
  assert.deepEqual(changes.at(-1), { kind: "session", session: null });
});

test("a new start replaces a kept ended session and emits its header first", async () => {
  const s = setup();
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  s.launched[0]!.fake.exit({ exitCode: 0, signal: null, requested: false });
  await tick();
  const changes: SessionChange[] = [];
  s.hub.subscribe(7, (c) => changes.push(c));
  await s.hub.start(7, as("Ann", "b"));
  assert.equal(changes[0]?.kind, "session");
  assert.equal(changes[0]?.kind === "session" && changes[0].session?.id, "s2");
  // The old retention timer no longer removes the new session.
  await s.clock.advance(2000);
  assert.equal(s.hub.current(7)?.id, "s2");
});

test("pause ends the session and keeps the request ID", async () => {
  const s = setup();
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  assert.deepEqual(s.hub.pause(7, as("Ann", "p")), {
    ok: true,
    duplicate: false,
  });
  assert.deepEqual(s.hub.pause(7, as("Ann", "p")), {
    ok: true,
    duplicate: true,
  });
  await tick();
  assert.equal(s.hub.current(7)?.ended?.reason, "paused");
  assert.deepEqual(s.launched[0]!.fake.commands.at(-1), { type: "end" });
});

test("close waits for a launch in flight and ends it", async () => {
  const release = Promise.withResolvers<void>();
  let fake: ReturnType<typeof fakeInteractivePi> | undefined;
  let aborted: boolean | undefined;
  const s = setup({
    launch: async (_issue, handlers, _report, signal) => {
      await release.promise;
      aborted = signal.aborted;
      fake = fakeInteractivePi();
      fake.connect(handlers);
      return { kind: "started", pi: fake.pi };
    },
  });
  await s.hub.start(7, as("Ann", "a"));
  let closed = false;
  const closing = s.hub.close().then(() => {
    closed = true;
  });
  assert.equal(s.hub.close(), s.hub.close());
  await tick();
  assert.equal(closed, false);
  assert.deepEqual(await s.hub.start(8, as("Ann", "b")), {
    ok: false,
    code: "closing",
    message: "The server is stopping.",
  });
  release.resolve();
  await closing;
  assert.equal(aborted, true);
  assert.deepEqual(fake!.commands, [{ type: "end" }]);
  assert.equal(s.hub.current(7)?.ended?.reason, "paused");
});

test("subscribers get changes only for their issue", async () => {
  const s = setup();
  const seven: SessionChange[] = [];
  const eight: SessionChange[] = [];
  const stop = s.hub.subscribe(7, (c) => seven.push(c));
  s.hub.subscribe(8, (c) => eight.push(c));
  await s.hub.start(7, as("Ann", "a"));
  await tick();
  s.hub.send(7, { ...as("Ann", "m"), text: "hi" });
  assert.ok(seven.length >= 2);
  assert.equal(eight.length, 0);
  stop();
  const count = seven.length;
  s.hub.send(7, { ...as("Ann", "m2"), text: "again" });
  assert.equal(seven.length, count);
});
