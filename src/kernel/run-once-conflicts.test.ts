import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
  branch,
  kernelComments,
  type Scenario,
} from "../../test-support/run-once-fixture.ts";
import { STATE_DIR, StateStore } from "../state/store.ts";
import { LocalWorkflowState } from "./local-workflow.ts";
import { acquireLock } from "./lock.ts";
import { ATTEMPT_FILE } from "./merge-conflicts.ts";
import type { RunOnceDeps } from "./run-once.ts";

const resolveStep = {
  git: [
    { args: ["fetch", "origin"] },
    { args: ["merge", "origin/main"], allowFailure: true },
  ],
  writeFiles: { "login.ts": "both\n" },
  commit: "Merge main",
  push: true,
  result: done,
};

const readyIssue = (number: number, createdAt: string) => ({
  number,
  title: `Other ${number}`,
  body: "Other",
  labels: ["agent-ready"],
  state: "open" as const,
  url: `https://example.invalid/${number}`,
  author: "fixture",
  createdAt,
  comments: [],
});

/** Moves `origin/main` so that it changes `login.ts` too. */
async function landOnMain(c: Scenario) {
  const cwd = join(c.dir, "seed");
  await c.git(["fetch", "origin"], cwd);
  await c.git(["checkout", "-B", "land", "origin/main"], cwd);
  await fs.writeFile(join(cwd, "login.ts"), "main\n");
  await c.git(["add", "."], cwd);
  await c.git(["commit", "-m", "Land other work"], cwd);
  await c.git(["push", "origin", "HEAD:main"], cwd);
}

/**
 * Issue 9 is done with an open ready pull request #1 that was clean, then
 * conflicts after another commit lands on main.
 */
async function conflicting(
  t: TestContext,
  steps: unknown[],
  options: { label?: string; draft?: boolean } = {},
) {
  const c = await setupRun(t, steps);
  await c.seed({ [spec]: "spec", [plan]: "plan", "login.ts": "branch\n" });
  await c.mutate((s) => {
    s.issues[0]!.labels = [options.label ?? "agent-done"];
    s.pullRequests.push({
      number: 1,
      url: "https://example.invalid/pulls/1",
      state: "open",
      draft: options.draft ?? false,
      body: "Closes #9",
      headRepository: "fixture/repo",
      headBranch: branch,
      baseBranch: "main",
    });
  });
  await c.deps.git.fetch();
  assert.equal(
    await c.deps.git.mergeConflict("origin/main", `origin/${branch}`),
    undefined,
  );
  await landOnMain(c);
  return c;
}

const attemptPath = (c: Scenario) =>
  join(c.repoRoot, c.config.paths.runsDir, "issue-9", ATTEMPT_FILE);
const counter = (c: Scenario) =>
  fs.readFile(`${c.script}.counter`, "utf8").catch(() => "0");

test("a done pull request that starts to conflict is resolved first", async (t) => {
  const c = await conflicting(t, [resolveStep]);
  await c.mutate((s) => s.issues.push(readyIssue(10, "2026-10-01")));
  const outcome = await c.run();
  assert.deepEqual(outcome, { status: "completed", issue: 9 });
  const state = c.host.state();
  assert.deepEqual(state.issues[0]!.labels, ["agent-done"]);
  assert.deepEqual(state.issues[1]!.labels, ["agent-ready"]);
  assert.ok(
    (await (await c.records()).prompt()).includes(
      "This session is a Conflict resolution",
    ),
  );
  assert.ok(
    c.output.includes(
      "Issue #9: pull request #1 conflicts with origin/main in login.ts; resolving it first.",
    ),
  );
  await fs.access(attemptPath(c));
  await c.deps.git.fetch();
  assert.equal(
    await c.deps.git.mergeConflict("origin/main", `origin/${branch}`),
    undefined,
  );
});

test("local state mode resolves a conflicting done pull request", async (t) => {
  const c = await conflicting(t, [resolveStep], { label: "bug" });
  c.config.workflow.stateTracking = "local";
  const store = new StateStore(join(c.repoRoot, STATE_DIR));
  const workflow = new LocalWorkflowState({
    host: c.host,
    store,
    now: c.deps.now,
    warn: c.deps.output.stderr,
  });
  await workflow.sync();
  await workflow.setStatus(9, { status: "done" });
  assert.deepEqual(await c.run({}, { workflow }), {
    status: "completed",
    issue: 9,
  });
  assert.deepEqual(
    (await store.readStatus(9)).map((change) => change.status),
    ["done", "inProgress", "done"],
  );
  assert.deepEqual(c.host.state().issues[0]!.labels, ["bug"]);
});

test("a push without the merge stops with needsInfo", async (t) => {
  const c = await conflicting(t, [
    {
      writeFiles: { "other.ts": "x" },
      commit: "Other",
      push: true,
      result: done,
    },
  ]);
  const outcome = await c.run();
  assert.equal(outcome.status, "stopped");
  assert.equal(outcome.status === "stopped" && outcome.label, "needsInfo");
  assert.ok(c.host.state().issues[0]!.labels.includes("needs-info"));
  assert.match(
    kernelComments(c).at(-1)!.body,
    /The pull request still conflicts with origin\/main in: login\.ts\./,
  );
});

const needsInput = {
  result: {
    status: "needs-input",
    summary: "login.ts: both sides change the token rule",
  },
};

test("an agent needs-input stops with needsInfo, and a second pass starts no session", async (t) => {
  const c = await conflicting(t, [needsInput]);
  const outcome = await c.run();
  assert.equal(outcome.status === "stopped" && outcome.label, "needsInfo");
  assert.match(
    kernelComments(c).at(-1)!.body,
    /login\.ts: both sides change the token rule/,
  );
  assert.equal(await counter(c), "1");
  // A person sets it back to Done; the pair rule alone must hold it back.
  await c.mutate((s) => {
    s.issues[0]!.labels = ["agent-done"];
  });
  const later = new Date(c.deps.now().getTime() + 31 * 60_000);
  assert.deepEqual(await c.run({}, { now: () => later }), {
    status: "no-work",
  });
  assert.equal(await counter(c), "1");
  assert.ok(
    c.output.some((line) =>
      /^Issue #9 conflict resolution skipped: already attempted at head /.test(
        line,
      ),
    ),
  );
});

test("a held lock falls back to normal selection", async (t) => {
  const c = await conflicting(t, [needsInput]);
  await c.mutate((s) => s.issues.push(readyIssue(10, "2026-10-20")));
  await fs.mkdir(join(c.lockPath, ".."), { recursive: true });
  const held = await acquireLock(c.lockPath, { now: c.deps.now });
  t.after(() => held.release());
  const outcome = await c.run();
  assert.equal(outcome.status === "stopped" && outcome.issue, 10);
  assert.ok(
    c.output.includes(
      "Issue #9 conflict resolution skipped: another Run attempt is active",
    ),
  );
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
});

test("normal work gets the continue line", async (t) => {
  const c = await conflicting(t, [needsInput], {
    label: "in-progress",
    draft: true,
  });
  await c.run();
  const prompt = await (await c.records()).prompt();
  assert.match(prompt, /then continue your normal work/);
  assert.doesNotMatch(prompt, /This session is a Conflict resolution/);
  await assert.rejects(fs.access(attemptPath(c)));
});

test("nothing to resolve stops without a session", async (t) => {
  const c = await conflicting(t, []);
  const workflow = c.deps.workflow;
  let fixed = false;
  const setStatus: RunOnceDeps["workflow"]["setStatus"] = async (n, u) => {
    if (!fixed) {
      fixed = true;
      const cwd = join(c.dir, "seed");
      await c.git(["fetch", "origin"], cwd);
      await c.git(["checkout", "-B", "fix", `origin/${branch}`], cwd);
      await c.deps.runner("git", ["merge", "origin/main"], { cwd });
      await fs.writeFile(join(cwd, "login.ts"), "both\n");
      await c.git(["add", "."], cwd);
      await c.git(["commit", "-m", "Person resolves"], cwd);
      await c.git(["push", "origin", `HEAD:${branch}`], cwd);
    }
    return workflow.setStatus(n, u);
  };
  const outcome = await c.run(
    {},
    {
      workflow: {
        sync: (n) => workflow.sync(n),
        openIssues: () => workflow.openIssues(),
        issue: (n) => workflow.issue(n),
        setStatus,
      },
    },
  );
  assert.deepEqual(outcome, { status: "completed", issue: 9 });
  assert.equal(await counter(c), "0");
  assert.ok(
    c.output
      .join("\n")
      .includes(
        "Pull request #1 no longer conflicts with origin/main; nothing to resolve.",
      ),
  );
});

test("a failed search does not block ready work", async (t) => {
  const c = await conflicting(t, [needsInput]);
  await c.mutate((s) => s.issues.push(readyIssue(10, "2026-10-20")));
  c.host.listOpenPullRequests = async () => {
    throw new Error("host down");
  };
  const outcome = await c.run();
  assert.equal(outcome.status === "stopped" && outcome.issue, 10);
  assert.ok(c.output.includes("Merge conflict check failed: host down"));
});
