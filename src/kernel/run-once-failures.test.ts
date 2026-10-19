import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  setupRun,
  spec,
  plan,
  done,
} from "../../test-support/run-once-fixture.ts";
import { acquireLock } from "./lock.ts";

for (const mode of ["draft", "dirty"] as const) {
  test(`implementation ${mode} evidence controls verified outcome and warnings`, async (t) => {
    const c = await setupRun(t, [
      {
        writeFiles: { "left.txt": "local" },
        pullRequest: { draft: mode === "draft", body: "Closes #9" },
        result: done,
      },
    ]);
    await c.seed({ [spec]: "spec", [plan]: "plan" });
    await c.mutate((s) => s.issues[0]!.labels.push("spec-approved"));
    assert.equal(
      (await c.run()).status,
      mode === "draft" ? "stopped" : "completed",
    );
    const issue = c.host.state().issues[0]!;
    assert.ok(
      issue.labels.includes(mode === "draft" ? "needs-info" : "agent-done"),
    );
    assert.match(
      issue.comments[0]!.body,
      mode === "draft" ? /not verified/ : /uncommitted/,
    );
  });
}
for (const mode of [
  "timeout",
  "invalid",
  "wrong artifact",
  "no plan",
] as const) {
  test(`${mode} stops with actionable evidence and releases the lock`, async (t) => {
    const step =
      mode === "timeout"
        ? { stdout: "waiting", sleepMs: 60000 }
        : mode === "invalid"
          ? { stdout: "prose only" }
          : {
              writeFiles: {
                [mode === "wrong artifact" ? "spec.md" : spec]: "spec",
              },
              commit: "Spec",
              push: true,
              result: done,
            };
    const c = await setupRun(t, [step]);
    if (mode === "timeout") c.config.pi.timeoutMinutes = 0.01;
    if (mode === "no plan") {
      c.config.workflow.specApproval.required = false;
      await c.seed({ [spec]: "old" });
    }
    await c.run();
    const issue = c.host.state().issues[0]!;
    assert.deepEqual(issue.labels, ["needs-info"]);
    assert.match(
      issue.comments[0]!.body,
      mode === "timeout"
        ? /timed out.*|Log:/
        : mode === "invalid"
          ? /no result/
          : mode === "no plan"
            ? new RegExp(plan.replaceAll(".", "\\."))
            : /not verified/,
    );
    if (mode === "timeout") {
      assert.match(issue.comments[0]!.body, /\.log/);
      const pid = Number(await fs.readFile(join(c.dir, "pi.pid"), "utf8"));
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      assert.equal((await c.records()).result.sessions[0].timedOut, true);
    }
    if (mode === "wrong artifact")
      assert.ok(issue.comments[0]!.body.includes(spec));
    const lock = await acquireLock(c.lockPath);
    await lock.release();
  });
}
for (const pid of [999999, process.pid]) {
  test(`unlocked pid ${pid} diagnostics do not block`, async (t) => {
    const c = await setupRun(t, [{ stdout: "no result" }]);
    await fs.mkdir(dirname(c.lockPath), { recursive: true });
    await fs.writeFile(c.lockPath, JSON.stringify({ pid, startedAt: "old" }));
    assert.equal((await c.run()).status, "stopped");
  });
}
for (const empty of [false, true]) {
  test(`held OS lock refuses without mutation (empty diagnostics: ${empty})`, async (t) => {
    const c = await setupRun(t);
    const held = await acquireLock(c.lockPath);
    t.after(() => held.release());
    if (empty) await fs.writeFile(c.lockPath, "");
    const r = await c.run();
    assert.equal(r.status, "refused");
    if (r.status === "refused")
      assert.match(r.reason, /another Run attempt is active/);
    assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-ready"]);
    assert.equal(c.host.state().issues[0]!.comments.length, 0);
  });
}

test("ambiguous branches stop with both branch names", async (t) => {
  const c = await setupRun(t);
  await c.git([
    "push",
    "origin",
    "HEAD:agent/issue-9-a",
    "HEAD:agent/issue-9-b",
  ]);
  await c.run();
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.match(
    c.host.state().issues[0]!.comments[0]!.body,
    /agent\/issue-9-a.*agent\/issue-9-b/s,
  );
});
for (const closed of [false, true]) {
  test(`claim loss changes no further labels or comments (closed: ${closed})`, async (t) => {
    const c = await setupRun(t);
    c.host.setLabels = async () => {
      if (closed)
        await c.mutate((s) => {
          s.issues[0]!.state = "closed";
          s.issues[0]!.labels = ["in-progress"];
        });
    };
    assert.deepEqual(await c.run(), { status: "claimed-elsewhere", issue: 9 });
    assert.equal(c.host.state().issues[0]!.comments.length, 0);
    assert.deepEqual(
      c.host.state().issues[0]!.labels,
      closed ? ["in-progress"] : ["agent-ready"],
    );
    const lock = await acquireLock(c.lockPath);
    await lock.release();
  });
}

test("claimed errors become needs-info and cleanup host errors cannot leak ownership", async (t) => {
  const c = await setupRun(t);
  c.deps.git.fetch = async () => {
    throw new Error("fetch failed");
  };
  await c.run();
  assert.match(c.host.state().issues[0]!.comments[0]!.body, /fetch failed/);
  c.host.commentIssue = async () => {
    throw new Error("comment failed");
  };
  await c.mutate((s) => {
    s.issues[0]!.labels = ["agent-ready"];
  });
  const outcome = await c.run();
  assert.equal(outcome.status, "stopped");
  if (outcome.status === "stopped")
    assert.match(outcome.summary, /fetch failed.*comment failed/s);
  const lock = await acquireLock(c.lockPath);
  await lock.release();
});

test("aborted signal stops the claimed attempt without starting Pi", async (t) => {
  const c = await setupRun(t);
  const signal = AbortSignal.abort();
  await c.run({ signal });
  assert.match(c.host.state().issues[0]!.comments[0]!.body, /aborted/);
  await assert.rejects(fs.stat(`${c.script}.counter`), { code: "ENOENT" });
});

test("revision result still requires a verified done result", async (t) => {
  const c = await setupRun(t, [
    { result: { status: "needs-input", summary: "Which login?" } },
  ]);
  await c.seed({ [spec]: "spec" });
  await c.run();
  assert.deepEqual(c.host.state().issues[0]!.labels, ["needs-info"]);
  assert.match(c.host.state().issues[0]!.comments[0]!.body, /Which login/);
  assert.equal((await c.records()).result.sessions.length, 1);
});

test("dry-run ambiguous branches does not claim or start Pi", async (t) => {
  const c = await setupRun(t);
  await c.git([
    "push",
    "origin",
    "HEAD:agent/issue-9-a",
    "HEAD:agent/issue-9-b",
  ]);
  assert.deepEqual(await c.run({ dryRun: true }), {
    status: "dry-run",
    issue: 9,
    derived: "ambiguous-branches",
  });
  assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-ready"]);
  await assert.rejects(fs.stat(c.lockPath), { code: "ENOENT" });
});

for (const site of ["release labels", "comment"] as const) {
  test(`finalization ${site} error is recorded without retry and retains the lock inode`, async (t) => {
    const c = await setupRun(t);
    c.config.workflow.specApproval.required = true;
    await c.seed({ [spec]: "spec" }, "agent/issue-9--spec");
    await c.mutate((s) => {
      s.pullRequests.push({
        number: 1,
        url: "https://example.invalid/1",
        state: "open",
        draft: false,
        body: "Refs #9",
        headBranch: "agent/issue-9--spec",
      });
    });
    await c.mutate((s) => {
      s.issues[0]!.labels = [];
    });
    let swaps = 0;
    let comments = 0;
    const setLabels = c.host.setLabels.bind(c.host);
    c.host.setLabels = async (n, add, remove) => {
      swaps++;
      if (swaps === 2 && site === "release labels")
        throw new Error("release labels failed");
      await setLabels(n, add, remove);
    };
    c.host.commentIssue = async () => {
      comments++;
      throw new Error("comment failed");
    };
    const outcome = await c.run({ issue: 9 });
    assert.equal(outcome.status, "stopped");
    if (outcome.status === "stopped") {
      assert.equal(outcome.label, "needsInfo");
      assert.match(outcome.summary, /Waiting for it to be merged/);
      assert.ok(outcome.summary.includes(`${site} failed`));
    }
    assert.equal(swaps, 2);
    assert.equal(comments, site === "comment" ? 1 : 0);
    assert.deepEqual((await c.records()).result.outcome, outcome);
    assert.match(c.output.join("\n"), new RegExp(`${site} failed`));
    const inode = (await fs.stat(c.lockPath)).ino;
    const lock = await acquireLock(c.lockPath);
    await lock.release();
    assert.equal((await fs.stat(c.lockPath)).ino, inode);
    assert.equal(await fs.readFile(c.lockPath, "utf8"), "");
  });
}

test("a result-record write failure still closes the permanent lock handle", async (t) => {
  const c = await setupRun(t);
  c.deps.git.fetch = async () => {
    const root = dirname(c.lockPath);
    const runId = (await fs.readdir(root)).find((name) => name !== "lock")!;
    await fs.mkdir(join(root, runId, "result.json"));
    throw new Error("fetch failed");
  };
  await assert.rejects(c.run(), { code: "EISDIR" });
  const inode = (await fs.stat(c.lockPath)).ino;
  const lock = await acquireLock(c.lockPath);
  await lock.release();
  assert.equal((await fs.stat(c.lockPath)).ino, inode);
});
