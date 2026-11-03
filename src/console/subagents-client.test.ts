import assert from "node:assert/strict";
import test from "node:test";
import { fakeSubagents, NO_REPLY } from "../../test-support/fake-subagents.ts";
import {
  SubagentsClient,
  SubagentsRpcError,
  WORKER_AGENT,
} from "./subagents-client.ts";

const input = {
  task: "envelope",
  cwd: "/w",
  timeoutMs: 60_000,
  output: "/r/output.md",
};

test("spawn sends a forked worker and returns the async id", async (t) => {
  const bus = fakeSubagents();
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.equal(await client.spawnWorker(input), "run-1");
  assert.deepEqual(
    bus.requests.map((r) => r.method),
    ["ping", "spawn"],
  );
  assert.deepEqual(bus.requests.at(-1)?.params, {
    agent: WORKER_AGENT,
    task: "envelope",
    context: "fork",
    cwd: "/w",
    output: "/r/output.md",
    maxRuntimeMs: 60_000,
  });
  assert.equal(bus.requests[0]?.version, 1);
  assert.deepEqual(bus.requests[0]?.source, { extension: "patchmill" });
});

test("completion before spawn reply is buffered and normalizes optional flags", async (t) => {
  const bus = fakeSubagents({
    spawn: () => {
      bus.complete("run-1", {
        results: [{ output: "done", sessionFile: "/s.jsonl" }],
      });
      return { details: { asyncId: "run-1" } };
    },
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  const id = await client.spawnWorker(input);
  assert.deepEqual(await client.waitForCompletion(id), {
    id,
    state: "complete",
    timedOut: false,
    stopped: false,
    output: "done",
    sessionFile: "/s.jsonl",
  });
});

test("RPC error preserves its code and reply timeout rejects", async (t) => {
  const bus = fakeSubagents({
    status: () => ({ error: { code: "not_found", message: "missing" } }),
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  await assert.rejects(
    client.request("status"),
    (error) =>
      error instanceof SubagentsRpcError &&
      error.code === "not_found" &&
      error.message === "missing",
  );
  const silent = new SubagentsClient(fakeSubagents({ ping: () => NO_REPLY }), {
    replyTimeoutMs: 30,
  });
  t.after(() => silent.dispose());
  await assert.rejects(silent.request("status"), /did not reply/);
});

test("readiness retries ping every 250ms and is shared by concurrent requests", async (t) => {
  let pings = 0;
  const bus = fakeSubagents({
    ping: () => (++pings < 3 ? NO_REPLY : { version: 1 }),
  });
  const client = new SubagentsClient(bus, { replyTimeoutMs: 900 });
  t.after(() => client.dispose());
  await Promise.all([client.request("status"), client.request("status")]);
  assert.equal(pings, 3);
});

test("activeWorkers filters state and worker agent; resume and stop use id", async (t) => {
  const runs = [
    { id: "a", state: "running", children: [{ agent: WORKER_AGENT }] },
    { id: "b", state: "queued", children: [{ agent: WORKER_AGENT }] },
    { id: "c", state: "complete", children: [{ agent: WORKER_AGENT }] },
    { id: "d", state: "running", children: [{ agent: "other" }] },
  ];
  const bus = fakeSubagents({ status: () => ({ asyncSnapshot: { runs } }) });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(await client.activeWorkers(), [
    { id: "a", state: "running" },
    { id: "b", state: "queued" },
  ]);
  assert.equal(await client.resume("a", "fix"), "run-1");
  assert.deepEqual(bus.requests.at(-1)?.params, { id: "a", message: "fix" });
  await client.stop("run-1");
  assert.deepEqual(bus.requests.at(-1)?.params, { id: "run-1" });
});

test("dispose rejects pending RPCs and completion waits and removes listeners", async () => {
  const bus = fakeSubagents({ spawn: () => NO_REPLY });
  const client = new SubagentsClient(bus);
  await client.request("ping");
  const request = client.spawnWorker(input);
  const completion = client.waitForCompletion("run-1");
  const checks = [
    assert.rejects(request, /disposed/),
    assert.rejects(completion, /disposed/),
  ];
  await new Promise<void>((resolve) => setImmediate(resolve));
  client.dispose();
  await Promise.all(checks);
  assert.equal(bus.listenerCount(), 0);
  await assert.rejects(client.request("status"), /disposed/);
});
