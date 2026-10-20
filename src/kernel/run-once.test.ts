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
test("gated planning publishes a spec PR and keeps in-progress with one cost comment", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "design" },
      commit: "Spec",
      push: true,
      pullRequest: { draft: true },
      result: done,
    },
  ]);
  c.config.workflow.specApproval.required = true;
  assert.equal((await c.run()).status, "stopped");
  const issue = c.host.state().issues[0]!;
  assert.deepEqual(issue.labels, ["in-progress"]);
  assert.equal(issue.comments.length, 1);
  assert.match(issue.comments[0]!.body, /Login work complete/);
  assert.match(issue.comments[0]!.body, /Cost:.*0.05/);
  assert.ok(issue.comments[0]!.body.includes(spec));
  assert.ok(
    issue.comments[0]!.body.includes("https://example.invalid/pulls/1"),
  );
  assert.equal(c.host.state().pullRequests[0]!.draft, true);
  assert.equal(
    await c.git(["show", `origin/agent/issue-9--spec:${spec}`]),
    "design",
  );
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
  assert.match(
    c.output.join("\n"),
    /Final result:.*Planning PR merge required/,
  );
  assert.doesNotMatch(c.output.join("\n"), /```json/);
});

test("planning with an issue-closing PR is not offered for specification review", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "design" },
      commit: "Spec",
      push: true,
      pullRequest: { draft: true, body: "Closes #9" },
      result: done,
    },
  ]);
  const outcome = await c.run();
  assert.equal(outcome.status, "stopped");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.match(
    c.host.state().issues[0]!.comments[0]!.body,
    /planning.*close.*#9/i,
  );
  assert.equal((await c.records()).result.sessions.length, 1);
});

test("existing ungated spec runs planning then implementation to a verified ready PR", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [plan]: "plan" },
      commit: "Plan",
      push: true,
      stdout: "planning output",
      stderr: "planning warning",
      result: done,
    },
    {
      stdout: "implementation output",
      stderr: "implementation warning",
      writeFiles: { "login.ts": "code" },
      commit: "Code",
      push: true,
      pullRequest: { draft: false, body: "Closes #9" },
      result: done,
    },
  ]);
  await c.seed({ [spec]: "spec" });
  assert.equal((await c.run()).status, "completed");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
  assert.equal(c.host.state().issues[0]!.comments.length, 1);
  assert.equal((await c.records()).result.sessions.length, 2);
  const dir = (await c.records()).dir;
  const aggregate = await fs.readFile(`${dir}/pi.log`, "utf8");
  for (const text of [
    "planning output",
    "planning warning",
    "implementation output",
    "implementation warning",
  ])
    assert.ok(aggregate.includes(text));
  assert.equal(
    await fs.readFile(`${dir}/pi.log`, "utf8"),
    (await fs.readFile(`${dir}/session-1.log`, "utf8")) +
      (await fs.readFile(`${dir}/session-2.log`, "utf8")),
  );
  assert.equal(await c.git(["show", `origin/${branch}:login.ts`]), "code");
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
      writeFiles: { [spec]: "spec", [plan]: "plan" },
      commit: "Planning",
      push: true,
      result: done,
    },
  ]);
  await c.run({ planOnly: true });
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.match(
    c.host.state().issues[0]!.comments[0]!.body,
    /planning complete/,
  );
  assert.equal(await fs.readFile(`${c.script}.counter`, "utf8"), "1");
});

test("dry-run describes missing plan without claim, lock, comment, or Pi", async (t) => {
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

test("selection resumes in-progress issues and explicit selection still requires open", async (t) => {
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
  assert.equal(selectIssue(issues, c.config.labels)?.number, 1);
  assert.equal(selectIssue(issues, c.config.labels, 1)?.number, 1);
  assert.equal(selectIssue(issues, c.config.labels, 9)?.number, 9);
  for (const n of [3, 99])
    assert.equal(selectIssue(issues, c.config.labels, n), undefined);
  await c.mutate((s) => {
    s.issues = [];
  });
  assert.deepEqual(await c.run(), { status: "no-work" });
  assert.equal((await c.run({ issue: 99 })).status, "refused");
});

test("configured labels control selection, claim and planning wait", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [spec]: "spec" },
      commit: "Spec",
      push: true,
      pullRequest: { body: "Refs #9" },
      result: done,
    },
  ]);
  c.config.labels.ready = "queue";
  c.config.labels.inProgress = "working";
  c.config.workflow.specApproval.required = true;
  await c.mutate((s) => {
    s.issues[0]!.labels = ["queue"];
  });
  await c.run();
  assert.deepEqual(c.host.state().issues[0]!.labels, ["working"]);
  assert.match(await (await c.records()).prompt(), /Planning stage: spec/);
});
for (const state of ["closed"] as const) {
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

for (const hasPlan of [false, true]) {
  test(`shared artifact directory requires a distinct plan: plan=${hasPlan}`, async (t) => {
    const c = await setupRun(t);
    c.config.paths.specsDir = "docs";
    c.config.paths.plansDir = "docs";
    await c.seed({
      "docs/2026-10-15-issue-9-design.md": "spec",
      ...(hasPlan ? { "docs/2026-10-15-issue-9-plan.md": "plan" } : {}),
    });
    const outcome = await c.run({ dryRun: true });
    assert.equal(outcome.status, "dry-run");
    if (outcome.status === "dry-run")
      assert.deepEqual(outcome.derived, {
        kind: "phase",
        phase: hasPlan ? "implementation" : "planning",
      });
  });
}

for (const login of ["work", ""]) {
  test(`run envelope trusts authenticated Tea author with selector ${JSON.stringify(login)}`, async (t) => {
    const c = await setupRun(t, [
      { result: { status: "needs-input", summary: "Question" } },
    ]);
    c.config.host = {
      provider: "forgejo-tea",
      login,
      trustedAuthors: ["reviewer"],
    };
    c.host.checkCli = async () => ({
      ok: true,
      message: "authenticated",
      login: "alice",
    });
    await c.mutate((s) => {
      s.issues[0]!.comments = ["alice", "work", "reviewer"].map((author) => ({
        author,
        body: "Reply",
        createdAt: "2026-10-16",
      }));
    });
    await c.run();
    const prompt = await (await c.records()).prompt();
    assert.match(prompt, /alice \(trusted,/);
    assert.match(prompt, /work \(untrusted,/);
    assert.match(prompt, /reviewer \(trusted,/);
  });
}

test("explicit issue is viewed independently of automatic enumeration", async (t) => {
  const c = await setupRun(t);
  c.host.listOpenIssues = async () => [];
  assert.equal((await c.run({ issue: 9, dryRun: true })).status, "dry-run");
  assert.equal(
    c.host.state().calls.some((call) => /setLabels|commentIssue/.test(call)),
    false,
  );
});

test("comments added during planning reach the implementation envelope", async (t) => {
  const c = await setupRun(t, [
    {
      writeFiles: { [plan]: "plan" },
      commit: "Plan",
      push: true,
      issuePatch: {
        comments: [
          {
            author: "reviewer",
            body: "Fresh review comment",
            createdAt: "2026-10-16",
          },
        ],
      },
      result: done,
    },
    { result: { status: "needs-input", summary: "Need help" } },
  ]);
  await c.seed({ [spec]: "spec" });
  await c.run();
  assert.match(await (await c.records()).prompt(), /Fresh review comment/);
});

test("kernel run-report from the authenticated account does not reopen automatic triage", async (t) => {
  const c = await setupRun(t, [
    { result: { status: "needs-input", summary: "Question" } },
    { stdout: '```json\n{"label":"agent-ready","comment":"Clear"}\n```' },
  ]);
  await c.run();
  const { runTriage } = await import("./triage.ts");
  assert.equal(c.host.state().issues[0]!.comments[0]!.author, "owner");
  assert.deepEqual(await runTriage(c.config, c.deps, {}), []);
  assert.equal(await fs.readFile(`${c.script}.counter`, "utf8"), "1");
});

test("a PR closing a foreign repository cannot set agent-done", async (t) => {
  const c = await setupRun(t, [
    { pullRequest: { draft: false, body: "Fixes other/repo#9" }, result: done },
  ]);
  await c.seed({ [spec]: "spec", [plan]: "plan" });
  assert.equal((await c.run()).status, "stopped");
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
});

for (const checkout of [["-b", "operator-branch"], ["main"], ["--detach"]]) {
  test(`wrong worktree ${checkout.join(" ")} refuses Pi at the run boundary`, async (t) => {
    const c = await setupRun(t);
    await c.seed({ [spec]: "spec" });
    await c.run({ dryRun: true });
    if (checkout[0] === "main") await c.git(["checkout", "--detach"]);
    await c.git(["checkout", ...checkout], c.worktree);
    await fs.writeFile(`${c.worktree}/operator.txt`, "keep");
    const result = await c.run();
    assert.equal(result.status, "stopped");
    if (result.status === "stopped")
      assert.match(result.summary, /expected branch/);
    assert.equal(
      await fs.readFile(`${c.worktree}/operator.txt`, "utf8"),
      "keep",
    );
    await assert.rejects(fs.stat(`${c.script}.counter`), { code: "ENOENT" });
  });
}

test("GitHub runtime envelope retains configured identity alongside authenticated identity", async (t) => {
  const c = await setupRun(t, [
    { result: { status: "needs-input", summary: "Question" } },
  ]);
  c.config.host = {
    provider: "github-gh",
    login: "old-owner",
    trustedAuthors: ["reviewer"],
  };
  c.host.checkCli = async () => ({
    ok: true,
    message: "authenticated",
    login: "alice",
  });
  await c.mutate((s) => {
    s.issues[0]!.comments = ["alice", "old-owner", "reviewer"].map(
      (author) => ({ author, body: "Reply", createdAt: "2026-10-16" }),
    );
  });
  await c.run();
  const prompt = await (await c.records()).prompt();
  for (const author of ["alice", "old-owner", "reviewer"])
    assert.ok(prompt.includes(`${author} (trusted,`));
});
