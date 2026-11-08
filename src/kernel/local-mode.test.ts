import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import {
  setupRun,
  spec,
  plan,
  implement,
} from "../../test-support/run-once-fixture.ts";
import { createTriagePi } from "../../test-support/triage-fixture.ts";
import { STATE_DIR, StateStore } from "../state/store.ts";
import { KERNEL_COMMENT } from "./comments.ts";
import { LocalWorkflowState } from "./local-workflow.ts";
import { runTriage } from "./triage.ts";

const block = (label = "agent-ready", comment = "Looks clear.") =>
  `\`\`\`json\n${JSON.stringify({ label, comment, blockedBy: [] })}\n\`\`\``;

async function setup(t: TestContext, steps: unknown[] = []) {
  const c = await setupRun(t, steps);
  c.config.workflow.stateTracking = "local";
  await c.mutate((state) => {
    state.issues[0]!.labels = [];
    state.labels = ["bug"];
  });
  const store = new StateStore(join(c.repoRoot, STATE_DIR));
  const workflow = new LocalWorkflowState({
    host: c.host,
    store,
    now: c.deps.now,
    warn: c.deps.output.stderr,
  });
  const statusPath = join(c.repoRoot, STATE_DIR, "status/9.jsonl");
  const triage = async (result = block()) => {
    const root = join(c.dir, "triage-pi");
    await fs.mkdir(root, { recursive: true });
    const piCommand = await createTriagePi(root, [result]);
    return runTriage(c.config, { ...c.deps, workflow, piCommand }, {});
  };
  return { ...c, store, workflow, statusPath, triage };
}

// Missing sync leaves the unlabeled issue undiscovered; label-backed writes leak upstream.
test("local mode posts no status comments and changes no labels", async (t) => {
  const c = await setup(t, [implement]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  assert.deepEqual(await c.triage(), [
    { issue: 9, label: "agent-ready", applied: true },
  ]);
  assert.equal((await c.run({}, { workflow: c.workflow })).status, "completed");
  const state = c.host.state();
  assert.deepEqual(state.issues[0]!.labels, []);
  assert.deepEqual(state.labels, ["bug"]);
  assert.deepEqual(state.issues[0]!.comments, []);
  assert.equal(
    state.calls.some((call) =>
      /^(createLabel:|setLabels:|commentIssue:)/.test(call),
    ),
    false,
  );
  assert.deepEqual(
    (await c.store.readStatus(9)).map((change) => change.status),
    ["ready", "inProgress", "done"],
  );
  assert.match(state.pullRequests[0]!.body, /## Patchmill run cost/);
  assert.match(
    state.pullRequests[0]!.body,
    /\| \*\*Total\*\* .*\*\*\$0\.0500\*\*/,
  );
  assert.equal((await c.records()).result.sessions.length, 1);
});

// Only a successful needs-input result may publish the unmarked stop summary.
test("unattended needs-input posts one question", async (t) => {
  const c = await setup(t, [
    { result: { status: "needs-input", summary: "Which login provider?" } },
  ]);
  await c.workflow.setStatus(9, { status: "ready" });
  assert.equal((await c.run({}, { workflow: c.workflow })).status, "stopped");
  const comments = c.host.state().issues[0]!.comments;
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.body, "Which login provider?");
  assert.equal(comments[0]!.body.includes(KERNEL_COMMENT), false);
  const last = (await c.store.readStatus(9)).at(-1)!;
  assert.match(last.summary!, /The agent reported needs-input\./);
  assert.match(last.summary!, /Which login provider\?/);
  assert.match(last.summary!, /Exit code: 0/);
  assert.equal(last.status, "needsInfo");
  assert.equal(last.questionUrl, comments[0]!.url);
});

test("errors post nothing", async (t) => {
  const c = await setup(t, [{ stdout: "prose only" }]);
  await c.workflow.setStatus(9, { status: "ready" });
  assert.equal((await c.run({}, { workflow: c.workflow })).status, "stopped");
  assert.deepEqual(c.host.state().issues[0]!.comments, []);
  const last = (await c.store.readStatus(9)).at(-1)!;
  assert.equal(last.status, "needsInfo");
  assert.equal(last.questionUrl, undefined);
});

// A rejected question or status append must not appear as applied triage.
test("a failed triage question leaves the issue untriaged", async (t) => {
  const c = await setup(t);
  c.host.commentIssue = async () => {
    throw new Error("question refused");
  };
  assert.deepEqual(await c.triage(block("needs-info", "Which provider?")), []);
  assert.match(
    c.output.join("\n"),
    /Warning: Issue #9: Comment failed: question refused/,
  );
  assert.equal((await c.workflow.issue(9)).status, "untriaged");
  await assert.rejects(fs.stat(c.statusPath), { code: "ENOENT" });
});

test("a failed triage status write is not applied", async (t) => {
  if (process.getuid?.() === 0) return t.skip("needs non-root");
  // Restore permissions before setupRun's cleanup removes the fixture.
  t.after(() => fs.chmod(statusDir, 0o755));
  const c = await setup(t);
  const statusDir = join(c.repoRoot, STATE_DIR, "status");
  await fs.mkdir(statusDir, { recursive: true });
  await fs.chmod(statusDir, 0o555);
  assert.deepEqual(await c.triage(), []);
  assert.match(c.output.join("\n"), /Warning: Issue #9: Status update failed/);
  await assert.rejects(fs.stat(c.statusPath), { code: "ENOENT" });
  assert.deepEqual(c.host.state().issues[0]!.comments, []);
});

// Sync must reject before selection, ownership, run artifacts, or status publication.
test("sync failure stops the run before claiming", async (t) => {
  const c = await setup(t);
  c.host.listIssuesSince = async () => {
    throw new Error("sync unavailable");
  };
  await assert.rejects(c.run({}, { workflow: c.workflow }), /sync unavailable/);
  await assert.rejects(fs.stat(c.statusPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(c.lockPath), { code: "ENOENT" });
  assert.deepEqual(c.host.state().issues[0]!.comments, []);
});

test("sync failure stops triage before writing", async (t) => {
  const c = await setup(t);
  c.host.listIssuesSince = async () => {
    throw new Error("sync unavailable");
  };
  await assert.rejects(c.triage(), /sync unavailable/);
  await assert.rejects(fs.stat(c.statusPath), { code: "ENOENT" });
  await assert.rejects(
    fs.stat(join(c.repoRoot, c.config.paths.runsDir, "triage")),
    { code: "ENOENT" },
  );
});
