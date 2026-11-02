import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPatchmillExtension } from "./extension.ts";
import { SubagentsClient, WORKER_AGENT } from "./subagents-client.ts";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { fakeSubagents } from "../../test-support/fake-subagents.ts";
import type { HumanChannel } from "../kernel/human-channel.ts";
import type { PhaseLaunch } from "../kernel/launch.ts";
const sessionDir = await fs.mkdtemp(join(tmpdir(), "console-planning-test-"));
after(() => fs.rm(sessionDir, { recursive: true, force: true }));

const launch: PhaseLaunch = {
  phase: "planning",
  envelope: "Plan",
  promptPath: "p",
  worktree: "/tmp",
  skillPath: "s",
  sessionDir,
  logPath: "l",
  aggregateLogPath: "a",
  timeoutMs: 1000,
};

test("the first Issue run starts after stray workers are stopped", async () => {
  let active = true;
  const bus = fakeSubagents({
    status: () => ({
      asyncSnapshot: {
        runs: active
          ? [
              {
                id: "stray",
                state: "running",
                children: [{ agent: WORKER_AGENT }],
              },
            ]
          : [],
      },
    }),
    stop: () => {
      active = false;
      return {};
    },
  });
  const api = fakeExtensionApi(bus);
  const started: number[] = [];
  await createPatchmillExtension({
    firstIssue: 9,
    startRun: async (issue) => {
      assert.equal(active, false);
      started.push(issue);
      return { status: "no-work" };
    },
  })(api);
  await api.fire("session_start");
  assert.deepEqual(
    bus.requests.map((r) => r.method),
    ["ping", "status", "stop", "status"],
  );
  assert.deepEqual(started, [9]);
  await api.fire("session_shutdown");
  assert.equal(bus.listenerCount(), 0);
});

test("a stuck stray worker blocks the start and says why", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 100 });
  let statuses = 0;
  const bus = fakeSubagents({
    status: () => {
      if (++statuses > 1) t.mock.timers.tick(60_001);
      return {
        asyncSnapshot: {
          runs: [
            {
              id: "stuck",
              state: "running",
              children: [{ agent: WORKER_AGENT }],
            },
          ],
        },
      };
    },
  });
  const api = fakeExtensionApi(bus);
  let started = false;
  await createPatchmillExtension({
    firstIssue: 9,
    startRun: async () => {
      started = true;
      return { status: "no-work" };
    },
  })(api);
  await api.fire("session_start");
  assert.equal(started, false);
  assert.equal(
    api.messages.at(-1)?.message.content,
    "Worker stuck did not stop. Patchmill will not start the Issue run.",
  );
  assert.equal(
    await api.callCommand("10"),
    "Worker stuck did not stop. Patchmill will not start the Issue run.",
  );
  assert.equal(started, false);
  await api.fire("session_shutdown");
});

test("pending cleanup refuses command starts until cleanup succeeds", async () => {
  const api = fakeExtensionApi();
  let finish!: (workers: { id: string; state: string }[]) => void;
  const pending = new Promise<{ id: string; state: string }[]>((resolve) => {
    finish = resolve;
  });
  class PendingClient extends SubagentsClient {
    override activeWorkers() {
      return pending;
    }
  }
  const started: number[] = [];
  await createPatchmillExtension({
    firstIssue: 9,
    client: (events) => new PendingClient(events),
    startRun: async (issue) => {
      started.push(issue);
      return { status: "no-work" };
    },
  })(api);
  const startup = api.fire("session_start");
  try {
    assert.equal(
      await api.callCommand("10"),
      "Stray-worker cleanup is pending. Patchmill will not start the Issue run.",
    );
    assert.deepEqual(started, []);
  } finally {
    finish([]);
    await startup;
    await api.fire("session_shutdown");
  }
  assert.deepEqual(started, [9]);
});

test("rejected cleanup keeps command starts closed and explains the failure", async () => {
  const bus = fakeSubagents({
    status: () => ({
      error: { code: "cleanup_failed", message: "status unavailable" },
    }),
  });
  const api = fakeExtensionApi(bus);
  const started: number[] = [];
  await createPatchmillExtension({
    firstIssue: 9,
    startRun: async (issue) => {
      started.push(issue);
      return { status: "no-work" };
    },
  })(api);
  await api.fire("session_start");
  const reason =
    "Stray-worker cleanup failed: status unavailable. Patchmill will not start the Issue run.";
  assert.equal(api.messages.at(-1)?.message.content, reason);
  assert.equal(await api.callCommand("10"), reason);
  assert.deepEqual(started, []);
  await api.fire("session_shutdown");
});

test("tools confirm submissions, preserve declined planning, and expose status", async () => {
  const api = fakeExtensionApi();
  let human!: HumanChannel;
  const results: boolean[] = [];
  let firstRunFinished!: () => void;
  const firstRun = new Promise<void>((resolve) => {
    firstRunFinished = resolve;
  });
  const started: number[] = [];
  await createPatchmillExtension({
    firstIssue: 9,
    client: (events) => new SubagentsClient(events),
    startRun: async (issue, channel) => {
      started.push(issue);
      human = channel;
      results.push((await channel.runPlanning(launch)).session.aborted);
      firstRunFinished();
      return { status: "no-work" };
    },
  })(api);
  await api.fire("session_start");
  assert.equal(api.tools.size, 4);
  assert.equal(api.tools.has("patchmill_start_issue_run"), false);
  assert.equal(
    await api.callTool(
      "patchmill_submit_planning_result",
      { status: "done", summary: "ok" },
      { confirm: false },
    ),
    "Not submitted. Ask the maintainer what to change.",
  );
  assert.deepEqual(results, []);
  assert.equal(
    await api.callTool("patchmill_continue_issue_run", {}),
    "No Issue run is waiting for a merge.",
  );
  assert.equal(
    await api.callTool("patchmill_confirm_block_guidance", { text: "fix" }),
    "No worker is blocked.",
  );
  assert.deepEqual(
    JSON.parse(await api.callTool("patchmill_run_status", {})),
    {},
  );
  await api.callTool("patchmill_submit_planning_result", {
    status: "done",
    summary: "ok",
  });
  await firstRun;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(results, [false]);
  assert.deepEqual(api.confirmations[0], {
    title: "Accept planning result?",
    message: "ok",
  });
  const guidance = human.awaitGuidance("blocked");
  await api.fire("session_shutdown");
  await api.fire("session_shutdown");
  assert.deepEqual(results, [false]);
  assert.deepEqual(await guidance, { kind: "quit" });
});

test("issue command refuses active and closing runs, validates issue numbers, and switches without confirmation", async () => {
  const api = fakeExtensionApi();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const switched: number[] = [];
  await createPatchmillExtension({
    firstIssue: 9,
    switchIssue: async (issue) => {
      switched.push(issue);
    },
    startRun: async () => {
      await pending;
      return { status: "no-work" };
    },
  })(api);
  await api.fire("session_start");
  assert.equal(await api.callCommand("10"), "An Issue run is already active.");
  assert.deepEqual(switched, []);
  finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const value of ["", "0", "-1", "1.5", "2 extra", "9007199254740992"]) {
    assert.match((await api.callCommand(value))!, /positive integer/);
  }
  await api.callCommand("10");
  assert.deepEqual(switched, [10]);
  assert.deepEqual(api.confirmations, []);
  await api.fire("session_shutdown");
  assert.equal(await api.callCommand("11"), "The console is shutting down.");
  assert.deepEqual(switched, [10]);
});
