import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { basename } from "node:path";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
  branch,
} from "../../test-support/run-once-fixture.ts";
import { acquireLock } from "./lock.ts";
import { selectIssue } from "./run-once.ts";

// Missing claims, verification, or cleanup break these persisted observations.
test("fresh planning pushes a spec and draft PR, then releases with one cost comment", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "design" },
      commit: "Spec",
      push: true,
      pullRequest: { draft: true },
      result: done,
    },
  ]);
  assert.equal((await c.run()).status, "stopped");
  const issue = c.host.state().issues[0]!;
  assert.deepEqual(issue.labels, ["spec-review"]);
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0]!.body, /Login work complete/);
  assert.match(issue.comments[0]!.body, /Cost:.*0.05/);
  assert.equal(c.host.state().pullRequests[0]!.draft, true);
  assert.equal(await c.git(["show", `origin/${branch}:${spec}`]), "design");
  const record = await c.records();
  const runId = basename(record.dir);
  assert.match(runId, /^20261015-120000-[0-9a-f]{4}$/);
  assert.equal(record.result.runId, runId);
  assert.equal(
    record.result.startedAt,
    new Date(2026, 9, 15, 12).toISOString(),
  );
  assert.equal(record.result.sessions[0].phase, "planning");
  assert.equal(record.result.sessions[0].status, "done");
  assert.equal(await fs.readFile(c.lockPath, "utf8"), "");
  const lock = await acquireLock(c.lockPath);
  await lock.release();
  assert.match(c.output.join("\n"), /```json/);
});

test("approved spec runs planning then implementation to a verified ready PR", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [plan]: "plan" },
      commit: "Plan",
      push: true,
      result: done,
    },
    {
      writeFiles: { "login.ts": "code" },
      commit: "Code",
      push: true,
      pullRequest: { draft: false, body: "Closes #9" },
      result: done,
    },
  ]);
  await c.seed({ [spec]: "spec" });
  await c.mutate((s) => s.issues[0]!.labels.push("spec-approved"));
  assert.equal((await c.run()).status, "completed");
  assert.deepEqual(c.host.state().issues[0]!.labels, [
    "spec-approved",
    "agent-done",
  ]);
  assert.equal(c.host.state().issues[0]!.comments.length, 1);
  assert.equal((await c.records()).result.sessions.length, 2);
  assert.equal(await c.git(["show", `origin/${branch}:login.ts`]), "code");
});

test("ready-driven revision preserves real approval and stops after one planning session", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "revised" },
      commit: "Revise",
      push: true,
      result: done,
    },
  ]);
  c.config.labels.specApproved = "review-accepted";
  await c.seed({ [spec]: "spec" });
  assert.equal((await c.run()).status, "stopped");
  const r = await c.records();
  const prompt = await r.prompt();
  assert.match(prompt, /planning/);
  assert.ok(prompt.includes(spec));
  assert.match(prompt, /spec-review/);
  assert.match(prompt, /review-accepted.*absent/);
  assert.match(prompt, /not approved/);
  assert.deepEqual(c.host.state().issues[0]!.labels, ["spec-review"]);
  assert.equal(r.result.sessions.length, 1);
});

test("explicit issue without ready stops at the normal spec gate without Pi", async (t) => {
  const c = await setupRun(t);
  await c.seed({ [spec]: "spec" });
  await c.mutate((s) => {
    s.issues[0]!.labels = [];
  });
  assert.equal((await c.run({ issue: 9 })).status, "stopped");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["spec-review"]);
  await assert.rejects(fs.stat(`${c.script}.counter`), { code: "ENOENT" });
});

test("merged PR wins over ready-driven revision", async (t) => {
  const c = await setupRun(t);
  await c.seed({ [spec]: "spec" });
  await c.mutate((s) =>
    s.pullRequests.push({
      number: 1,
      url: "https://example.invalid/1",
      state: "merged",
      draft: false,
      body: "Closes #9",
      headBranch: branch,
    }),
  );
  assert.equal((await c.run()).status, "completed");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
  await assert.rejects(fs.stat(`${c.script}.counter`), { code: "ENOENT" });
});

test("plan-only with gate off stops before non-advance and a second session", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "spec" },
      commit: "Spec",
      push: true,
      result: done,
    },
  ]);
  c.config.workflow.specApproval.required = false;
  await c.run({ planOnly: true });
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.match(
    c.host.state().issues[0]!.comments[0]!.body,
    /planning complete/,
  );
  assert.equal(await fs.readFile(`${c.script}.counter`, "utf8"), "1");
});

test("dry-run describes the initial revision without claim, lock, comment, or Pi", async (t) => {
  const c = await setupRun(t);
  await c.seed({ [spec]: "spec" });
  assert.deepEqual(await c.run({ dryRun: true }), {
    status: "dry-run",
    issue: 9,
    derived: { kind: "phase", phase: "planning" },
  });
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-ready"]);
  assert.equal(c.host.state().issues[0]!.comments.length, 0);
  await assert.rejects(fs.stat(c.lockPath), { code: "ENOENT" });
  await assert.rejects(fs.stat(`${c.script}.counter`), { code: "ENOENT" });
  assert.match(c.output.join("\n"), /planning/);
});

test("selection chooses oldest eligible and explicit selection still requires open and unclaimed", async (t) => {
  const c = await setupRun(t);
  const base = c.host.state().issues[0]!;
  const issues = [
    {
      ...base,
      number: 1,
      createdAt: "2025-01-01",
      labels: ["in-progress", "agent-ready"],
    },
    { ...base, number: 2, createdAt: "2026-01-01" },
    base,
    { ...base, number: 3, state: "closed" as const },
  ];
  assert.equal(selectIssue(issues, c.config.labels)?.number, 2);
  assert.equal(selectIssue(issues, c.config.labels, 9)?.number, 9);
  for (const n of [1, 3, 99])
    assert.equal(selectIssue(issues, c.config.labels, n), undefined);
  await c.mutate((s) => {
    s.issues = [];
  });
  assert.deepEqual(await c.run(), { status: "no-work" });
  assert.equal((await c.run({ issue: 99 })).status, "refused");
});

test("configured labels control selection, claim, revision state and release", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "revision" },
      commit: "Revise",
      push: true,
      result: done,
    },
  ]);
  c.config.labels.ready = "queue";
  c.config.labels.inProgress = "working";
  c.config.labels.specReview = "design-review";
  c.config.labels.specApproved = "accepted";
  await c.mutate((s) => {
    s.issues[0]!.labels = ["queue"];
  });
  await c.seed({ [spec]: "spec" });
  await c.run();
  assert.deepEqual(c.host.state().issues[0]!.labels, ["design-review"]);
  assert.match(
    await (await c.records()).prompt(),
    /design-review.*accepted: absent/s,
  );
});

for (const state of ["closed", "in-progress"] as const) {
  test(`explicit ${state} issue is refused before locks or mutation`, async (t) => {
    const c = await setupRun(t);
    await c.mutate((s) => {
      if (state === "closed") s.issues[0]!.state = "closed";
      else s.issues[0]!.labels.push("in-progress");
    });
    const result = await c.run({ issue: 9 });
    assert.equal(result.status, "refused");
    assert.equal(c.host.state().issues[0]!.comments.length, 0);
    await assert.rejects(fs.stat(c.lockPath), { code: "ENOENT" });
  });
}
