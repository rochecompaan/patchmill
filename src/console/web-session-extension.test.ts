import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { fakeSubagents } from "../../test-support/fake-subagents.ts";
import type { StartRun } from "./controller.ts";
import { SubagentsClient } from "./subagents-client.ts";
import {
  createWebSessionExtension,
  WEB_SESSION_EXTENSION_PATH,
  WEB_SESSION_STOP,
  webSessionTarget,
} from "./web-session-extension.ts";
import { WEB_SESSION_STOP_COMMAND } from "../kernel/pi-rpc-interactive.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const texts = (api: ReturnType<typeof fakeExtensionApi>) =>
  api.messages.map((m) => m.message.content);

function setup(startRun: StartRun, refusal?: string) {
  const events = fakeSubagents();
  const api = fakeExtensionApi(events);
  createWebSessionExtension({
    issue: 7,
    startRun,
    client: (bus) => new SubagentsClient(bus, { replyTimeoutMs: 100 }),
    ...(refusal ? { refusal } : {}),
  })(api);
  return { api, events };
}

test("webSessionTarget reads the repository and a positive issue number", () => {
  assert.deepEqual(
    webSessionTarget({
      PATCHMILL_WEB_SESSION_REPO: "/r",
      PATCHMILL_WEB_SESSION_ISSUE: "7",
    }),
    { repoRoot: "/r", issue: 7 },
  );
  for (const issue of [undefined, "0", "-1", "1.5", "7x"])
    assert.throws(() =>
      webSessionTarget({
        PATCHMILL_WEB_SESSION_REPO: "/r",
        ...(issue === undefined ? {} : { PATCHMILL_WEB_SESSION_ISSUE: issue }),
      }),
    );
  assert.throws(() => webSessionTarget({ PATCHMILL_WEB_SESSION_ISSUE: "7" }));
});

test("the stop command name matches the RPC client's", () => {
  assert.equal(`/${WEB_SESSION_STOP}`, WEB_SESSION_STOP_COMMAND);
});

test("session_start starts the Issue run and shutdown follows its end", async () => {
  const finish = Promise.withResolvers<void>();
  const issues: (number | undefined)[] = [];
  const { api } = setup(async (issue) => {
    issues.push(issue);
    await finish.promise;
    return { status: "no-work" };
  });
  await api.fire("session_start");
  await tick();
  assert.deepEqual(issues, [7]);
  assert.equal(api.shutdowns, 0);
  finish.resolve();
  await tick();
  await tick();
  assert.equal(api.shutdowns, 1);
  assert.equal(texts(api).at(-1), "Issue run no-work.");
});

test("a failed Issue run also requests shutdown", async () => {
  const { api } = setup(async () => {
    throw new Error("sync failed");
  });
  await api.fire("session_start");
  await tick();
  await tick();
  assert.equal(api.shutdowns, 1);
  assert.ok(texts(api).includes("sync failed"));
});

test("a refused run notifies its reason before shutdown", async () => {
  const { api } = setup(async () => ({
    status: "refused",
    issue: 7,
    reason: "another Run attempt is active",
  }));
  await api.fire("session_start");
  await tick();
  await tick();
  assert.equal(texts(api).at(-1), "another Run attempt is active");
  assert.equal(api.shutdowns, 1);
});

test("blocked stray-worker cleanup shuts the session down", async () => {
  const events = fakeSubagents({
    status: () => ({ error: { code: "boom", message: "status failed" } }),
  });
  const api = fakeExtensionApi(events);
  let started = false;
  createWebSessionExtension({
    issue: 7,
    startRun: async () => {
      started = true;
      return { status: "no-work" };
    },
    client: (bus) => new SubagentsClient(bus, { replyTimeoutMs: 100 }),
  })(api);
  await api.fire("session_start");
  assert.equal(started, false);
  assert.match(texts(api).at(-1) ?? "", /will not start the Issue run/);
  assert.equal(api.shutdowns, 1);
});

test("a held Console session lock refuses without starting a run", async () => {
  let started = false;
  const { api } = setup(async () => {
    started = true;
    return { status: "no-work" };
  }, "Issue #7's Console session is open in another process. Close it first.");
  await api.fire("session_start");
  assert.equal(started, false);
  assert.deepEqual(texts(api), [
    "Issue #7's Console session is open in another process. Close it first.",
  ]);
  assert.equal(api.shutdowns, 1);
});

test("the stop command stops the Issue run before session_shutdown", async () => {
  const order: string[] = [];
  const { api } = setup(async (_issue, human) => {
    const answer = await human.awaitContinue({ kind: "gate", message: "Go" });
    order.push(`run settled: ${answer}`);
    return { status: "no-work" };
  });
  await api.fire("session_start");
  await tick();
  const original = api.shutdowns;
  assert.equal(original, 0);
  await api.runCommand(WEB_SESSION_STOP);
  // The run wrapper and the command both ask Pi to exit; Pi accepts both.
  order.push(`shut down: ${api.shutdowns > 0}`);
  assert.deepEqual(order, ["run settled: quit", "shut down: true"]);
  assert.ok(texts(api).includes("Stopping the Web session."));
  // A later session_shutdown reuses the finished shutdown.
  await api.fire("session_shutdown");
});

test("WEB_SESSION_EXTENSION_PATH exists", () => {
  assert.ok(existsSync(WEB_SESSION_EXTENSION_PATH));
});
