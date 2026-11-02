import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { fakeExtensionApi } from "../../test-support/fake-extension-api.ts";
import { ConsoleController } from "./controller.ts";
import { registerConsoleTools } from "./tools.ts";
import type { PhaseLaunch } from "../kernel/launch.ts";

for (const row of [
  {
    name: "required gate with PR",
    gate: { required: true, pullRequest: true },
    answers: [true, true],
    approval: "pr",
    questions: 2,
  },
  {
    name: "required gate without PR",
    gate: { required: true, pullRequest: true },
    answers: [true, false],
    approval: "no-pr",
    questions: 2,
  },
  {
    name: "later required gate",
    gate: { required: true, pullRequest: false },
    answers: [true],
    approval: "no-pr",
    questions: 1,
  },
  {
    name: "ungated review",
    gate: { required: false, pullRequest: false },
    answers: [true],
    approval: undefined,
    questions: 1,
  },
]) {
  test(`${row.name}: only explicit UI answers select the planning outcome`, async (t) => {
    const dir = await fs.mkdtemp(join(tmpdir(), "planning-approval-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const pi = fakeExtensionApi();
    const controller = new ConsoleController({
      pi,
      startRun: async () => ({ status: "no-work" }),
      workers: {} as never,
    });
    registerConsoleTools(pi, () => controller);
    const launch: PhaseLaunch = {
      phase: "planning",
      envelope: "plan",
      promptPath: "p",
      worktree: dir,
      skillPath: "s",
      sessionDir: dir,
      logPath: "l",
      aggregateLogPath: "a",
      timeoutMs: 1000,
      planningGate: row.gate,
    };
    const pending = controller.runPlanning(launch);
    const questions: string[] = [];
    const answers = [...row.answers];
    const ctx = {
      ui: {
        confirm: async (title: string) => {
          questions.push(title);
          return answers.shift();
        },
      },
    } as unknown as ExtensionToolContext;
    await pi.tools
      .get("patchmill_submit_planning_result")!
      .execute(
        "id",
        { status: "done", summary: "approved in chat; open PR" },
        undefined,
        undefined,
        ctx,
      );
    const run = await pending;
    assert.equal(run.planningApproval, row.approval);
    assert.equal(questions.length, row.questions);
    if (row.questions === 2)
      assert.match(questions[1]!, /Open a planning pull request/);
    if (row.gate.required) assert.match(questions[0]!, /Approve/);
    if (row.gate.required && !row.gate.pullRequest)
      assert.match(
        pi.userMessages[0]!.text as string,
        /earlier unmerged document/i,
      );
  });
}

test("declining gate approval leaves the pending conversation open", async (t) => {
  const dir = await fs.mkdtemp(join(tmpdir(), "planning-decline-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pi = fakeExtensionApi();
  const controller = new ConsoleController({
    pi,
    startRun: async () => ({ status: "no-work" }),
    workers: {} as never,
  });
  registerConsoleTools(pi, () => controller);
  const pending = controller.runPlanning({
    phase: "planning",
    envelope: "plan",
    promptPath: "p",
    worktree: dir,
    skillPath: "s",
    sessionDir: dir,
    logPath: "l",
    aggregateLogPath: "a",
    timeoutMs: 1000,
    planningGate: { required: true, pullRequest: true },
  });
  let resolved = false;
  void pending.then(() => {
    resolved = true;
  });
  assert.equal(
    await pi.callTool(
      "patchmill_submit_planning_result",
      { status: "done", summary: "ok" },
      { confirm: false },
    ),
    "Not submitted.",
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  await pi.callTool("patchmill_submit_planning_result", {
    status: "done",
    summary: "ok",
  });
  assert.equal((await pending).planningApproval, "pr");
});
