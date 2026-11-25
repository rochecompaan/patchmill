import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  done,
  merge,
  setupRun,
  spec,
  type Scenario,
} from "../../test-support/run-once-fixture.ts";
import { prepareInteractiveRun } from "./interactive-start.ts";
import { fakeHuman } from "../../test-support/fake-human.ts";
import type { RunOnceOptions } from "./run-once.ts";

type Result = {
  finishedAt: string;
  outcome: { status: string; label?: string; summary?: string };
  republished?: boolean;
};

// An unattended gate wait that repeats unchanged is announced once.
async function gated(t: TestContext, extraSteps: unknown[] = []) {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "design" },
      commit: "Spec",
      push: true,
      pullRequest: { draft: false, body: "Refs #9" },
      result: done,
    },
    ...extraSteps,
  ]);
  c.config.workflow.specApproval.required = true;
  let minute = 0;
  // Later runs name issue 9: they check its gate stop, not selection, and
  // automatic selection skips an issue that waits on its planning PR.
  const run = (overrides = {}, options: RunOnceOptions = { issue: 9 }) => {
    const at = new Date(2026, 9, 15, 12, ++minute);
    return c.run(options, { now: () => at, ...overrides });
  };
  const comments = () => c.host.state().issues[0]!.comments;
  const results = async (): Promise<Result[]> => {
    const root = dirname(c.lockPath);
    const found: Result[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const text = await fs
        .readFile(join(root, entry.name, "result.json"), "utf8")
        .catch(() => undefined);
      if (text === undefined) continue;
      try {
        found.push(JSON.parse(text) as Result);
      } catch {
        // An unreadable result is not part of the history.
      }
    }
    return found.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  };
  const resultFile = async (index: number) => {
    const root = dirname(c.lockPath);
    const files: { path: string; finishedAt: string }[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name, "result.json");
      const result = JSON.parse(await fs.readFile(path, "utf8")) as Result;
      files.push({ path, finishedAt: result.finishedAt });
    }
    files.sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
    return files[index]!.path;
  };
  // Run 1 publishes the planning PR, run 2 announces the gate wait.
  assert.equal((await run({}, {})).status, "stopped");
  assert.equal(comments().length, 1);
  return { c, run, comments, results, resultFile };
}

test("an unchanged unattended gate wait publishes once", async (t) => {
  const g = await gated(t);
  const second = await g.run();
  assert.equal(second.status, "stopped");
  assert.equal(g.comments().length, 2);
  assert.match(g.comments()[1]!.body, /Waiting for it to be merged/);
  const before = g.c.output.length;
  const third = await g.run();
  assert.equal(third.status, "stopped");
  if (third.status === "stopped") assert.equal(third.label, "inProgress");
  assert.equal(g.comments().length, 2);
  const last = (await g.results()).at(-1)!;
  assert.equal(last.republished, false);
  assert.equal(last.outcome.label, "inProgress");
  assert.match(
    g.c.output.slice(before).join(""),
    /Unchanged planning gate wait; not republished\./,
  );
  assert.deepEqual(g.c.host.state().issues[0]!.labels, ["in-progress"]);
});

test("a changed gate summary publishes again", async (t) => {
  const g = await gated(t);
  await g.run();
  await g.run();
  assert.equal(g.comments().length, 2);
  await g.c.mutate((state) => {
    state.pullRequests[0]!.url = "https://example.invalid/pulls/2";
  });
  const outcome = await g.run();
  assert.equal(outcome.status, "stopped");
  if (outcome.status === "stopped") assert.equal(outcome.label, "inProgress");
  assert.equal(g.comments().length, 3);
  assert.match(g.comments()[2]!.body, /pulls\/2/);
});

test("a failed gate publication is retried", async (t) => {
  const g = await gated(t);
  const comment = g.c.host.commentIssue.bind(g.c.host);
  g.c.host.commentIssue = async () => {
    throw new Error("comment failed");
  };
  const second = await g.run();
  assert.ok(
    second.status === "stopped" && second.publicationErrors?.length,
    JSON.stringify(second),
  );
  g.c.host.commentIssue = comment;
  assert.equal(g.comments().length, 1);
  await g.run();
  assert.equal(g.comments().length, 2);
  assert.match(g.comments()[1]!.body, /Waiting for it to be merged/);
});

test("an unreadable earlier result publishes as today", async (t) => {
  const g = await gated(t);
  await g.run();
  assert.equal(g.comments().length, 2);
  await fs.writeFile(await g.resultFile(1), "{");
  await g.run();
  assert.equal(g.comments().length, 3);
});

test("an interactive gate wait is not affected", async (t) => {
  const g = await gated(t);
  await g.run();
  assert.equal(g.comments().length, 2);
  // The interactive gate wait asks the human, who declines to continue.
  const human = fakeHuman(g.c);
  await g.run({ human });
  assert.equal(g.comments().length, 3);
});

const skipWarning =
  /Warning: Issue #9: planning pull request #\d+ is waiting for review; skipping it\./;

function skipWarnings(c: Scenario) {
  return c.output.filter((line) => skipWarning.test(line));
}

// Issue 10 is newer than issue 9. It is appended, so issues[0] stays issue 9.
async function addNewerIssue(c: Scenario) {
  await c.mutate((state) => {
    state.issues.push({
      ...state.issues[0]!,
      number: 10,
      title: "Add logout",
      url: "https://example.invalid/10",
      labels: ["agent-ready"],
      createdAt: "2026-10-16",
      comments: [],
    });
  });
}

test("a waiting issue yields to newer ready work, in dry-run and in a run", async (t) => {
  const { c } = await gated(t, [
    { result: { status: "needs-input", summary: "Question" } },
  ]);
  await addNewerIssue(c);
  c.output.length = 0;
  const dryRun = await c.run({ dryRun: true });
  assert.equal(dryRun.status, "dry-run");
  assert.equal("issue" in dryRun ? dryRun.issue : undefined, 10);
  assert.equal(skipWarnings(c).length, 1);
  c.output.length = 0;
  const run = await c.run();
  assert.equal(run.status, "stopped");
  assert.equal("issue" in run ? run.issue : undefined, 10);
  assert.equal(skipWarnings(c).length, 1);
});

test("after the merge, the waiting issue is selected first again", async (t) => {
  const { c } = await gated(t);
  await addNewerIssue(c);
  const pull = c.host
    .state()
    .pullRequests.find((p) => p.state === "open" && p.body.includes("#9"))!;
  await merge(c, pull.headBranch);
  c.output.length = 0;
  const dryRun = await c.run({ dryRun: true });
  assert.equal("issue" in dryRun ? dryRun.issue : undefined, 9);
  assert.equal(skipWarnings(c).length, 0);
});

test("only waiting issues report no eligible issue", async (t) => {
  const { c } = await gated(t);
  c.output.length = 0;
  assert.deepEqual(await c.run(), { status: "no-work" });
  assert.ok(c.output.some((line) => line.includes("No eligible issue")));
  assert.equal(skipWarnings(c).length, 1);
});

test("interactive automatic selection skips a waiting issue", async (t) => {
  const { c } = await gated(t);
  const reports: string[] = [];
  const start = await prepareInteractiveRun({
    config: c.config,
    deps: c.deps,
    report: (line) => reports.push(line),
    sweep: async () => {},
  });
  assert.deepEqual(start, { kind: "none" });
  assert.equal(reports.filter((line) => skipWarning.test(line)).length, 1);
});

// Spec D8: only an explicit run retries a failed gate-wait publication.
test("an automatic pass does not retry a failed gate publication", async (t) => {
  const g = await gated(t);
  const comment = g.c.host.commentIssue.bind(g.c.host);
  g.c.host.commentIssue = async () => {
    throw new Error("comment failed");
  };
  const failed = await g.run();
  assert.ok(
    failed.status === "stopped" && failed.publicationErrors?.length,
    JSON.stringify(failed),
  );
  g.c.host.commentIssue = comment;
  assert.deepEqual(await g.c.run(), { status: "no-work" });
  assert.equal(g.comments().length, 1);
  await g.run();
  assert.equal(g.comments().length, 2);
  assert.match(g.comments()[1]!.body, /Waiting for it to be merged/);
});
