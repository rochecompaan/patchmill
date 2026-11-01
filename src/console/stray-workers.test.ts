import assert from "node:assert/strict";
import test from "node:test";
import { fakeSubagents } from "../../test-support/fake-subagents.ts";
import { SubagentsClient } from "./subagents-client.ts";
import { stopWorkers } from "./stray-workers.ts";

const worker = (
  id: string,
  state = "running",
  agent = "patchmill-implementation",
) => ({
  id,
  state,
  children: [{ agent }],
});

test("stops every running Patchmill worker and waits for it to leave", async (t) => {
  let stopped = false;
  const bus = fakeSubagents({
    status: () => ({
      asyncSnapshot: {
        runs: [worker("run-1", stopped ? "stopped" : "running")],
      },
    }),
    stop: () => {
      stopped = true;
      return {};
    },
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(await stopWorkers(client, { waitMs: 100, pollMs: 5 }), {
    ok: true,
    stopped: ["run-1"],
  });
  assert.deepEqual(
    bus.requests.map((r) => r.method),
    ["ping", "status", "stop", "status"],
  );
  assert.deepEqual(bus.requests.find((r) => r.method === "stop")?.params, {
    id: "run-1",
  });
});

test("ignores other agents' runs", async (t) => {
  const bus = fakeSubagents({
    status: () => ({
      asyncSnapshot: { runs: [worker("other", "running", "other-agent")] },
    }),
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(await stopWorkers(client, { waitMs: 20, pollMs: 5 }), {
    ok: true,
    stopped: [],
  });
  assert.deepEqual(
    bus.requests.map((r) => r.method),
    ["ping", "status"],
  );
});

test("reports a worker that is still running after the wait", async (t) => {
  const bus = fakeSubagents({
    status: () => ({ asyncSnapshot: { runs: [worker("run-1")] } }),
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(await stopWorkers(client, { waitMs: 20, pollMs: 5 }), {
    ok: false,
    stuck: ["run-1"],
  });
  assert.ok(bus.requests.filter((r) => r.method === "status").length > 2);
});

test("polls queued and stopping workers until they leave, ignoring newly active workers", async (t) => {
  let polls = 0;
  const bus = fakeSubagents({
    status: () => ({
      asyncSnapshot: {
        runs:
          ++polls === 1
            ? [worker("run-1", "queued"), worker("run-2", "stopping")]
            : polls === 2
              ? [worker("run-2", "stopping"), worker("new")]
              : [worker("new")],
      },
    }),
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(await stopWorkers(client, { waitMs: 100, pollMs: 5 }), {
    ok: true,
    stopped: ["run-1", "run-2"],
  });
  assert.deepEqual(
    bus.requests.filter((r) => r.method === "stop").map((r) => r.params),
    [{ id: "run-1" }, { id: "run-2" }],
  );
  assert.equal(polls, 3);
});

test("stops only explicit IDs and waits only for those IDs", async (t) => {
  const bus = fakeSubagents({
    status: () => ({ asyncSnapshot: { runs: [worker("unrelated")] } }),
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(
    await stopWorkers(client, { ids: ["selected"], waitMs: 20, pollMs: 5 }),
    { ok: true, stopped: ["selected"] },
  );
  assert.deepEqual(
    bus.requests.map((r) => r.method),
    ["ping", "stop", "status"],
  );
  assert.deepEqual(bus.requests.find((r) => r.method === "stop")?.params, {
    id: "selected",
  });
});

test("an empty explicit selection does not stop any workers", async (t) => {
  const bus = fakeSubagents();
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(await stopWorkers(client, { ids: [] }), {
    ok: true,
    stopped: [],
  });
  assert.deepEqual(bus.requests, []);
});

test("continues stopping and polling after a stop failure, reporting only remaining workers", async (t) => {
  let otherStopped = false;
  const bus = fakeSubagents({
    status: () => ({
      asyncSnapshot: {
        runs: [worker("stuck"), ...(otherStopped ? [] : [worker("other")])],
      },
    }),
    stop: (request) => {
      if (request.params.id === "stuck")
        return { error: { code: "execution_failed", message: "cannot stop" } };
      otherStopped = true;
      return {};
    },
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(await stopWorkers(client, { waitMs: 20, pollMs: 5 }), {
    ok: false,
    stuck: ["stuck"],
  });
  assert.deepEqual(
    bus.requests.filter((r) => r.method === "stop").map((r) => r.params),
    [{ id: "stuck" }, { id: "other" }],
  );
  assert.ok(bus.requests.filter((r) => r.method === "status").length > 2);
});

test("a rejected stop still succeeds if the worker has left", async (t) => {
  const bus = fakeSubagents({
    stop: () => ({ error: { code: "not_found", message: "already gone" } }),
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(
    await stopWorkers(client, { ids: ["gone"], waitMs: 0, pollMs: 5 }),
    { ok: true, stopped: ["gone"] },
  );
});

test("default polling waits 500 ms before checking an active worker again", async (t) => {
  const checks: number[] = [];
  const bus = fakeSubagents({
    status: () => {
      checks.push(performance.now());
      return {
        asyncSnapshot: { runs: checks.length === 1 ? [worker("run-1")] : [] },
      };
    },
  });
  const client = new SubagentsClient(bus);
  t.after(() => client.dispose());
  assert.deepEqual(
    await stopWorkers(client, { ids: ["run-1"], waitMs: 1_000 }),
    {
      ok: true,
      stopped: ["run-1"],
    },
  );
  assert.equal(checks.length, 2);
  // Allow scheduling/clock precision tolerance without accepting a 250 ms poll.
  assert.ok(
    checks[1] - checks[0] >= 450,
    "default poll must wait about 500 ms",
  );
});
