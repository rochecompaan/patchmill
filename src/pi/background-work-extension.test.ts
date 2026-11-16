import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { fakeSubagents, NO_REPLY } from "../../test-support/fake-subagents.ts";
import {
  createBackgroundWorkExtension,
  LIVENESS_REGISTRY_KEY,
} from "./background-work-extension.ts";

type Registry = {
  version: number;
  register: (registration: {
    name: string;
    sessionId: string;
    isActive: () => boolean;
  }) => () => void;
};
type Handler = (event: unknown, ctx: unknown) => unknown;
const slot = globalThis as Record<symbol, unknown>;

function load(
  t: TestContext,
  options: {
    subagents?: ReturnType<typeof fakeSubagents>;
    existing?: unknown;
  } = {},
) {
  if (options.existing !== undefined)
    slot[LIVENESS_REGISTRY_KEY] = options.existing;
  t.after(() => {
    delete slot[LIVENESS_REGISTRY_KEY];
  });
  t.mock.method(console, "error", () => {});
  const events = options.subagents ?? fakeSubagents();
  const handlers = new Map<string, Handler[]>();
  const statuses: string[] = [];
  const pi = {
    events,
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;
  createBackgroundWorkExtension({
    pollMs: 10,
    stopBudgetMs: 300,
    replyTimeoutMs: 200,
  })(pi);
  const ctx = {
    sessionManager: { getSessionId: () => "session-1" },
    ui: {
      setStatus: (key: string, text: string) => {
        assert.equal(key, "patchmill-background-work");
        statuses.push(text);
      },
    },
  };
  return {
    events,
    statuses,
    registry: () => slot[LIVENESS_REGISTRY_KEY] as Registry,
    async fire(event: string) {
      for (const handler of handlers.get(event) ?? [])
        await handler({ type: event }, ctx);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("no registration reports 0 at each settle", async (t) => {
  const f = load(t);
  await f.fire("agent_settled");
  await f.fire("agent_settled");
  assert.deepEqual(f.statuses, ["1:0", "2:0"]);
});

test("an active registration for the session reports 1, then 0", async (t) => {
  const f = load(t);
  let active = true;
  f.registry().register({
    name: "pi-subagents",
    sessionId: "session-1",
    isActive: () => active,
  });
  await f.fire("agent_settled");
  await f.fire("agent_start");
  active = false;
  await f.fire("agent_settled");
  assert.deepEqual(f.statuses, ["1:1", "2:0"]);
});

test("other sessions, released registrations and throws count as 0", async (t) => {
  const f = load(t);
  f.registry().register({
    name: "other",
    sessionId: "session-2",
    isActive: () => true,
  });
  const release = f.registry().register({
    name: "released",
    sessionId: "session-1",
    isActive: () => true,
  });
  release();
  f.registry().register({
    name: "broken",
    sessionId: "session-1",
    isActive: () => {
      throw new Error("boom");
    },
  });
  await f.fire("agent_settled");
  assert.deepEqual(f.statuses, ["1:0"]);
});

test("an existing v1 registry still receives registrations", async (t) => {
  const seen: string[] = [];
  let released = 0;
  const existing: Registry = {
    version: 1,
    register: (registration) => {
      seen.push(registration.name);
      return () => released++;
    },
  };
  const f = load(t, { existing });
  const release = f.registry().register({
    name: "pi-subagents",
    sessionId: "session-1",
    isActive: () => true,
  });
  assert.deepEqual(seen, ["pi-subagents"]);
  await f.fire("agent_settled");
  release();
  assert.equal(released, 1);
  await f.fire("agent_settled");
  assert.deepEqual(f.statuses, ["1:1", "2:0"]);
});

test("idle polling repeats the settle with 0 when work ends without a turn", async (t) => {
  const f = load(t);
  let active = true;
  f.registry().register({
    name: "pi-subagents",
    sessionId: "session-1",
    isActive: () => active,
  });
  await f.fire("agent_settled");
  active = false;
  await sleep(60);
  assert.deepEqual(f.statuses, ["1:1", "1:0"]);
});

test("a new turn stops idle polling", async (t) => {
  const f = load(t);
  let active = true;
  f.registry().register({
    name: "pi-subagents",
    sessionId: "session-1",
    isActive: () => active,
  });
  await f.fire("agent_settled");
  await f.fire("agent_start");
  active = false;
  await sleep(60);
  assert.deepEqual(f.statuses, ["1:1"]);
});

test("shutdown stops active runs only while work is active", async (t) => {
  const runs = [
    { id: "r1", state: "running", children: [{ agent: "reviewer" }] },
    { id: "r2", state: "complete", children: [{ agent: "reviewer" }] },
  ];
  const subagents = fakeSubagents({
    status: () => ({ asyncSnapshot: { runs } }),
  });
  const f = load(t, { subagents });
  let active = false;
  f.registry().register({
    name: "pi-subagents",
    sessionId: "session-1",
    isActive: () => active,
  });
  await f.fire("session_shutdown");
  assert.deepEqual(subagents.requests, []);
  active = true;
  await f.fire("session_shutdown");
  const stops = subagents.requests.filter((r) => r.method === "stop");
  assert.deepEqual(
    stops.map((r) => r.params),
    [{ id: "r1" }],
  );
});

test("shutdown with no pi-subagents reply ends within the stop budget", async (t) => {
  const subagents = fakeSubagents({ ping: () => NO_REPLY });
  const f = load(t, { subagents });
  f.registry().register({
    name: "pi-subagents",
    sessionId: "session-1",
    isActive: () => true,
  });
  const started = performance.now();
  await f.fire("session_shutdown");
  assert.ok(performance.now() - started < 1000);
});
