import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { feedClock } from "../../test-support/feed-clock.ts";
import type { PiRpcOptions, PiRpcSession } from "./pi-rpc.ts";
import type { PiSession } from "./pi-supervisor.ts";
import { superviseStalls, type StallNotice } from "./stall-supervisor.ts";
import type { StallLimits } from "./stall-watch.ts";

const LIMITS: StallLimits = {
  stopAfterMs: 600_000,
  maxStalls: 3,
  command: { defaultSeconds: 0, maxSeconds: 0 },
};
const ENDED: PiSession = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  aborted: false,
  stdout: "ended",
  durationMs: 1,
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

type Scripted = {
  options: PiRpcOptions;
  recover: (string | number)[];
  stops: number;
  end: () => void;
};

async function setup(
  t: TestContext,
  recoverWith: ("continued" | "unresponsive" | "pending")[] = [],
  limits: Partial<StallLimits> = {},
  rpc: Partial<PiRpcOptions> = {},
) {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-supervise-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(join(dir, "prompt.md"), "Do the work.");
  const clock = feedClock();
  const sessions: Scripted[] = [];
  const notices: StallNotice[] = [];
  const pending: (() => void)[] = [];
  const start = (options: PiRpcOptions): PiRpcSession => {
    const ended = Promise.withResolvers<PiSession>();
    const scripted: Scripted = {
      options,
      recover: [],
      stops: 0,
      end: () => ended.resolve(ENDED),
    };
    sessions.push(scripted);
    return {
      steer: async () => {},
      followUp: async () => {},
      abort: async () => scripted.end(),
      recover: async (message) => {
        scripted.recover.push(message);
        const next = recoverWith.shift() ?? "continued";
        if (next !== "pending") return next;
        await new Promise<void>((resolve) => pending.push(resolve));
        return "continued";
      },
      stop: async () => {
        scripted.stops++;
        scripted.end();
      },
      done: ended.promise,
    };
  };
  const running = superviseStalls({
    rpc: {
      command: { command: "pi" },
      cwd: dir,
      agentDir: join(dir, "agent"),
      sessionDir: join(dir, "sessions"),
      promptPath: "prompt.md",
      logPath: join(dir, "pi.log"),
      extensionPaths: [],
      timeoutMs: 5_400_000,
      onOutput: () => {},
      ...rpc,
    },
    limits: { ...LIMITS, ...limits },
    phase: "implementation",
    clock: { now: clock.now, every: clock.every },
    start,
    onStall: async (notice) => {
      notices.push(notice);
    },
  });
  const sessionFile = join(dir, "sessions", "main.jsonl");
  return {
    dir,
    clock,
    sessions,
    notices,
    pending,
    running,
    sessionFile,
    writeSession: async () => {
      await fs.mkdir(join(dir, "sessions"), { recursive: true });
      await fs.appendFile(sessionFile, '{"type":"session"}\n');
    },
    advance: async (ms: number) => {
      await advanceAndFlush(clock, ms);
    },
  };
}

async function advanceAndFlush(
  clock: ReturnType<typeof feedClock>,
  ms: number,
) {
  await clock.advance(ms);
  await flush();
}

test("a stall stop recovers in the same session", async (t) => {
  const s = await setup(t);
  await s.writeSession();
  await s.advance(15_000);
  await s.advance(600_000);
  assert.equal(s.sessions.length, 1);
  assert.equal(s.sessions[0]!.recover.length, 1);
  assert.match(String(s.sessions[0]!.recover[0]), /This is stall 1 of 3\./);
  assert.deepEqual(
    s.notices.map((notice) => notice.action),
    ["recovering"],
  );
  s.sessions[0]!.end();
  const result = await s.running;
  assert.equal(result.stalls.length, 1);
  assert.equal(result.block, undefined);
  assert.equal(s.clock.intervals, 0);
});

test("a tick during a recovery is skipped", async (t) => {
  const s = await setup(t, ["pending"]);
  await s.writeSession();
  await s.advance(15_000);
  await s.advance(600_000);
  for (let n = 0; n < 3; n++) await s.advance(15_000);
  assert.equal(s.sessions[0]!.recover.length, 1);
  s.pending.shift()!();
  await flush();
  s.sessions[0]!.end();
  await s.running;
});

test("an unresponsive Pi restarts on the session file with the remaining time", async (t) => {
  const s = await setup(t, ["unresponsive"]);
  await s.writeSession();
  await s.advance(15_000);
  await s.advance(600_000);
  assert.equal(s.sessions.length, 2);
  assert.equal(s.sessions[0]!.stops, 1);
  const restarted = s.sessions[1]!.options;
  assert.equal(restarted.sessionFile, s.sessionFile);
  assert.equal(restarted.appendLogs, true);
  assert.equal(restarted.timeoutMs, 5_400_000 - 615_000);
  assert.equal(restarted.warnNow, undefined);
  assert.equal(restarted.promptPath, join(s.dir, "recovery-1.md"));
  assert.match(
    await fs.readFile(restarted.promptPath, "utf8"),
    /Patchmill restarted Pi\./,
  );
  assert.deepEqual(
    s.notices.map((notice) => notice.action),
    ["recovering", "restarted"],
  );
  s.sessions[1]!.end();
  const result = await s.running;
  assert.equal(result.session.stdout, "ended");
});

test("no session file means the stall blocks", async (t) => {
  const s = await setup(t, ["unresponsive"]);
  await s.advance(600_000);
  const result = await s.running;
  assert.match(
    result.block?.reason ?? "",
    /^The implementation session stopped: Patchmill could not restart Pi after a stall \(no session file\)/,
  );
  assert.equal(s.sessions.length, 1);
  assert.equal(s.notices.at(-1)?.action, "blocked");
});

test("a block stops Pi and returns the reason", async (t) => {
  const s = await setup(t, [], { maxStalls: 1 });
  await s.writeSession();
  await s.advance(15_000);
  await s.advance(600_000);
  const result = await s.running;
  assert.match(result.block?.reason ?? "", /stopped after 1 stalls/);
  assert.equal(s.sessions[0]!.stops, 1);
  assert.equal(s.sessions[0]!.recover.length, 0);
});

test("a recorded command timeout only notifies", async (t) => {
  const s = await setup(t);
  await fs.mkdir(join(s.dir, "sessions"), { recursive: true });
  await fs.writeFile(
    s.sessionFile,
    `${JSON.stringify({
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "b1",
        toolName: "bash",
        isError: true,
        content: [
          { type: "text", text: "Command timed out after 1200 seconds" },
        ],
      },
    })}\n`,
  );
  await s.advance(15_000);
  assert.deepEqual(
    s.notices.map((notice) => notice.action),
    ["recorded"],
  );
  assert.equal(s.sessions[0]!.recover.length, 0);
  s.sessions[0]!.end();
  await s.running;
});

test("the default poll interval follows the stop limit", async (t) => {
  const s = await setup(t, [], { stopAfterMs: 400 });
  await s.writeSession();
  for (let ms = 0; ms < 500; ms += 100) await s.advance(100);
  assert.equal(s.sessions[0]!.recover.length, 1);
  s.sessions[0]!.end();
  await s.running;
});

test("polling stops when the session ends", async (t) => {
  const s = await setup(t);
  assert.equal(s.clock.intervals, 1);
  s.sessions[0]!.end();
  await s.running;
  assert.equal(s.clock.intervals, 0);
});

test("a restart without a deadline starts with no timeoutMs", async (t) => {
  const s = await setup(t, ["unresponsive"], {}, { timeoutMs: undefined });
  await s.writeSession();
  await s.advance(15_000);
  await s.advance(600_000);
  assert.equal(s.sessions.length, 2);
  const restarted = s.sessions[1]!.options;
  assert.equal(restarted.timeoutMs, undefined);
  assert.equal(restarted.warnNow, undefined);
  s.sessions[1]!.end();
  const result = await s.running;
  assert.equal(result.block, undefined);
});

test("a late restart gets warnNow", async (t) => {
  const s = await setup(
    t,
    ["unresponsive"],
    {},
    { timeoutMs: 700_000, warnBeforeMs: 300_000 },
  );
  await s.writeSession();
  await s.advance(15_000);
  await s.advance(600_000);
  const restarted = s.sessions[1]!.options;
  assert.equal(restarted.timeoutMs, 85_000);
  assert.equal(restarted.warnNow, true);
  s.sessions[1]!.end();
  await s.running;
});

test("an early restart gets no warnNow", async (t) => {
  const s = await setup(
    t,
    ["unresponsive"],
    {},
    { timeoutMs: 1_000_000, warnBeforeMs: 300_000 },
  );
  await s.writeSession();
  await s.advance(15_000);
  await s.advance(600_000);
  const restarted = s.sessions[1]!.options;
  assert.equal(restarted.timeoutMs, 385_000);
  assert.equal(restarted.warnNow, undefined);
  s.sessions[1]!.end();
  await s.running;
});
