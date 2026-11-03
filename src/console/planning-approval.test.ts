import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { runCommand } from "../process/command.ts";
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
    answer: "Approve and open a planning PR",
    approval: "pr",
    questions: 1,
  },
  {
    name: "required gate without PR",
    gate: { required: true, pullRequest: true },
    answer: "Approve without a PR (continue now)",
    approval: "no-pr",
    questions: 1,
  },
  {
    name: "later required gate",
    gate: { required: true, pullRequest: false },
    answer: "Approve (continue now)",
    approval: "no-pr",
    questions: 1,
  },
  {
    name: "ungated review",
    gate: { required: false, pullRequest: false },
    answer: "Reviewed, continue",
    approval: undefined,
    questions: 1,
  },
]) {
  test(`${row.name}: only explicit UI answers select the planning outcome`, async (t) => {
    const dir = await fs.mkdtemp(join(tmpdir(), "planning-approval-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await prepareWorktree(dir);
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
      planningReview: review,
    };
    const pending = controller.runPlanning(launch);
    const questions: string[] = [];

    const ctx = {
      ui: {
        confirm: async () => {
          throw new Error("Unexpected confirm: planning must use one select");
        },
        select: async (title: string, options: string[]) => {
          assert.ok(options.includes(row.answer));
          questions.push(title);
          return row.answer;
        },
      },
    } as unknown as ExtensionToolContext;
    const result = await pi.tools
      .get("patchmill_submit_planning_result")!
      .execute(
        "id",
        {
          status: "done",
          summary: "approved in chat; open PR",
          highlights: ["Persist votes", "Restore lock"],
        },
        undefined,
        undefined,
        ctx,
      );
    assert.equal(result.content[0]!.type, "text");
    assert.equal(
      (result.content[0] as { text: string }).text,
      "Planning result submitted.",
    );
    const run = await pending;
    assert.equal(run.planningApproval, row.approval);
    assert.equal(questions.length, row.questions);
    assert.match(
      questions[0]!,
      /Spec {5}docs\/specs\/2026-11-02-issue-6-persist-polls-design.md/,
    );
    assert.match(
      questions[0]!,
      /Branch {3}agent\/issue-6--spec @ [0-9a-f]{7,}/,
    );
    assert.doesNotMatch(questions[0]!, /approved in chat/);
    assert.match(questions[0]!, /Mockup {3}docs\/mockups\/polls.html/);
    if (row.gate.required) assert.match(questions[0]!, /Approve/);
    if (row.gate.required && !row.gate.pullRequest)
      assert.match(
        pi.userMessages[0]!.text as string,
        /earlier unmerged document/i,
      );
  });
}

for (const answer of ["Request changes", undefined])
  test(`declining with ${answer} leaves the pending conversation open`, async (t) => {
    const dir = await fs.mkdtemp(join(tmpdir(), "planning-decline-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await prepareWorktree(dir);
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
      planningReview: review,
    });
    let resolved = false;
    void pending.then(() => {
      resolved = true;
    });
    assert.equal(
      await pi.callTool(
        "patchmill_submit_planning_result",
        {
          status: "done",
          summary: "ok",
          highlights: ["Persist votes", "Restore lock"],
        },
        { select: answer },
      ),
      "Not submitted. Ask the maintainer what to change.",
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(resolved, false);
    await pi.callTool("patchmill_submit_planning_result", {
      status: "done",
      summary: "ok",
      highlights: ["Persist votes", "Restore lock"],
    });
    assert.equal((await pending).planningApproval, "pr");
  });

const review = {
  issue: { number: 6, title: "Persist polls locally" },
  stage: "spec" as const,
  branch: "agent/issue-6--spec",
  specsDir: "docs/specs",
  plansDir: "docs/plans",
};
async function prepareWorktree(dir: string) {
  await fs.mkdir(join(dir, "docs/specs"), { recursive: true });
  await fs.writeFile(
    join(dir, "docs/specs/2026-11-02-issue-6-persist-polls-design.md"),
    "[Mockup](../mockups/polls.html)",
  );
  await fs.mkdir(join(dir, "docs/mockups"), { recursive: true });
  await fs.writeFile(join(dir, "docs/mockups/polls.html"), "<html></html>");
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "spec",
    ],
  ]) {
    assert.equal((await runCommand("git", args, { cwd: dir })).code, 0);
  }
}

test("oversized mandatory paths are notified before the single question-only select", async () => {
  const pi = fakeExtensionApi();
  const controller = new ConsoleController({
    pi,
    startRun: async () => ({ status: "no-work" }),
    workers: {} as never,
  });
  controller.planningDialogFacts = async () => ({
    issue: review.issue,
    stage: "spec",
    branch: review.branch,
    commit: "9064d2a",
    specPath: `docs/specs/${"long-path/".repeat(250)}design.md`,
  });
  registerConsoleTools(pi, () => controller);
  const events: string[] = [];
  const result = await pi.tools
    .get("patchmill_submit_planning_result")!
    .execute(
      "id",
      {
        status: "done",
        summary: "Summary stays out of the UI",
        highlights: ["First decision", "Second decision"],
      },
      undefined,
      undefined,
      {
        ui: {
          notify: (message: string) => {
            events.push("notify");
            assert.ok(message.includes("long-path/".repeat(250)));
            assert.match(message, /• Second decision/);
            assert.doesNotMatch(message, /Summary stays out/);
          },
          select: async (title: string, options: string[]) => {
            events.push("select");
            assert.equal(
              title,
              "Have you reviewed the spec for issue #6: Persist polls locally?",
            );
            assert.deepEqual(options, [
              "Reviewed, continue",
              "Request changes",
            ]);
            return "Request changes";
          },
        },
      } as unknown as ExtensionToolContext,
    );
  assert.deepEqual(events, ["notify", "select"]);
  assert.equal(
    (result.content[0] as { text: string }).text,
    "Not submitted. Ask the maintainer what to change.",
  );
});

test("planning tool schema rejects more than 72 characters per highlight", async () => {
  const { Check } = await import("typebox/value");
  const pi = fakeExtensionApi();
  registerConsoleTools(pi, () => {
    throw new Error("Schema validation needs no controller");
  });
  const schema = pi.tools.get("patchmill_submit_planning_result")!.parameters;
  const params = {
    status: "done",
    summary: "Result",
    highlights: ["A".repeat(72), "Another decision"],
  };
  assert.equal(Check(schema, params), true);
  assert.equal(
    Check(schema, {
      ...params,
      highlights: ["A".repeat(73), "Another decision"],
    }),
    false,
  );
});

for (const dimensions of [
  { columns: 120, rows: 40, keepsPoints: true },
  { columns: undefined, rows: undefined, keepsPoints: false },
  { columns: 0, rows: -1, keepsPoints: false },
  { columns: NaN, rows: Infinity, keepsPoints: false },
])
  test(`planning select uses terminal ${dimensions.columns}×${dimensions.rows} with safe fallbacks`, async (t) => {
    const originals = ["columns", "rows"].map((key) =>
      Object.getOwnPropertyDescriptor(process.stdout, key),
    );
    t.after(() => {
      for (const [index, key] of ["columns", "rows"].entries()) {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(process.stdout, key, descriptor);
        else Reflect.deleteProperty(process.stdout, key);
      }
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: dimensions.columns,
    });
    Object.defineProperty(process.stdout, "rows", {
      configurable: true,
      value: dimensions.rows,
    });
    const pi = fakeExtensionApi();
    const controller = new ConsoleController({
      pi,
      startRun: async () => ({ status: "no-work" }),
      workers: {} as never,
    });
    controller.planningGate = () => ({ required: true, pullRequest: false });
    controller.planningDialogFacts = async () => ({
      issue: review.issue,
      stage: "plan",
      earlierStage: "spec",
      branch: review.branch,
      commit: "9064d2a",
      specPath: "docs/specs/2026-11-02-issue-6-persist-polls-locally-design.md",
      planPath: "docs/plans/2026-11-02-issue-6-persist-polls-locally-plan.md",
      mockupPath: "docs/mockups/2026-11-02-issue-6-persist-polls-locally.html",
    });
    registerConsoleTools(pi, () => controller);
    await pi.callTool(
      "patchmill_submit_planning_result",
      {
        status: "done",
        summary: "The later plan is ready",
        highlights: [
          "First decision",
          "Second decision",
          "Third decision",
          "Fourth decision",
          "Fifth decision",
        ],
      },
      { select: "Request changes" },
    );
    assert.equal(pi.selections.length, 1);
    const title = pi.selections[0]!.title;
    assert.equal(title.includes("• Fifth decision"), dimensions.keepsPoints);
    assert.match(title, /^Approve the plan for issue #6:/);
    assert.match(title, /A planning PR isn't offered/);
  });
