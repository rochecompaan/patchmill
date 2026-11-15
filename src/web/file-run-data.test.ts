import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  boardIssue,
  boardProgress,
  boardPull,
} from "../../test-support/board-fixture.ts";
import { startWebFixture } from "../../test-support/web-fixture.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { acquireLock } from "../kernel/lock.ts";
import { writeRunProgress } from "../kernel/run-progress.ts";
import { StateStore, stateDir } from "../state/store.ts";
import { createFileRunDataSource } from "./file-run-data.ts";

async function fixture(t: import("node:test").TestContext, local = false) {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-file-source-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const config = structuredClone(DEFAULT_CONFIG);
  config.workflow.stateTracking = local ? "local" : "labels";
  config.labels = {
    ready: "queue",
    inProgress: "busy",
    needsInfo: "question",
    done: "delivered",
    unsuitable: "manual",
  };
  let calls = 0;
  const issues = [
    boardIssue(8, ["manual"]),
    boardIssue(7, ["question"]),
    boardIssue(6, ["delivered"]),
    boardIssue(5, ["busy"]),
    boardIssue(4, ["busy"]),
    boardIssue(3, ["busy"]),
    boardIssue(2, ["queue"]),
    boardIssue(1),
  ];
  const source = createFileRunDataSource({
    repoRoot,
    config,
    metadata: {
      repository: { name: "owner/repo", url: "https://github.com/owner/repo" },
      baseBranch: "main",
      pushRepository: {
        slug: "owner/repo",
        url: "https://github.com/owner/repo",
      },
    },
    host: {
      listOpenIssues: async () => {
        calls++;
        return issues;
      },
      listOpenPullRequests: async () => [boardPull("agent/issue-4--plan")],
    },
    runner: async () => ({ code: 1, stdout: "", stderr: "" }),
    now: () => new Date("2026-11-14T12:00:00Z"),
    warn: () => {},
  });
  const dir = (issue: number) =>
    join(repoRoot, config.paths.runsDir, `issue-${issue}`);
  for (const issue of [3, 4, 5])
    await writeRunProgress(
      dir(issue),
      boardProgress({
        issue,
        state:
          issue === 5
            ? "implementation"
            : issue === 4
              ? "gate-wait"
              : "planning",
        phase: issue === 5 ? "implementation" : "planning",
      }),
    );
  await writeRunProgress(
    dir(7),
    boardProgress({
      issue: 7,
      state: "ended",
      outcome: { status: "stopped", label: "needsInfo" },
      summary: "private-token /private/log",
    }),
  );
  const locks = await Promise.all(
    [3, 4, 5].map((issue) =>
      acquireLock(join(dir(issue), "lock"), {
        now: () => new Date("2026-11-14T12:00:00Z"),
      }),
    ),
  );
  t.after(async () => {
    await Promise.all(locks.map((lock) => lock.release()));
  });
  return { repoRoot, config, source, locks, calls: () => calls };
}

test("file-backed snapshots classify current fixture files, preserve immutability, and refresh local data inside a warm host period", async (t) => {
  const f = await fixture(t);
  const first = await f.source.snapshot();
  assert.deepEqual(
    first.issues.map((i) => [i.number, i.column]),
    [
      [1, "triage"],
      [2, "ready"],
      [3, "planning"],
      [4, "review"],
      [5, "implementing"],
      [6, "code"],
      [7, "blocked"],
    ],
  );
  assert.equal(first.source, "live");
  assert.equal(first.issues.find((i) => i.number === 4)?.live, true);
  assert.equal(
    first.issues.find((i) => i.number === 2)?.labels[0]?.tone,
    "ready",
  );
  assert.doesNotMatch(
    JSON.stringify(first),
    /private-token|\/private\/log|Private issue body|Private PR body/,
  );
  assert.throws(() => {
    (first.issues as unknown[]).push({});
  });
  assert.deepEqual(first.details, {});
  const selected = await f.source.snapshot({ issue: 3 });
  assert.deepEqual(selected.details["3"]?.summary, first.issues[2]);
  assert.deepEqual(selected.details["3"]?.thread, []);
  assert.equal((await f.source.snapshot()).revision, first.revision);
  await f.locks[2]!.release();
  const next = await f.source.snapshot();
  assert.equal(next.issues.find((i) => i.number === 5)?.column, "blocked");
  assert.equal(next.issues.find((i) => i.number === 5)?.live, false);
  assert.notEqual(next.revision, first.revision);
  assert.equal(f.calls(), 1);
});

test("both authenticated HTTP APIs share the provider cache and unknown callers cannot trigger it", async (t) => {
  const f = await fixture(t);
  const web = await startWebFixture(t, { source: f.source });
  assert.equal((await web.request("/api/board")).status, 401);
  assert.equal(f.calls(), 0);
  const [board, detail] = await Promise.all([
    web.request("/api/board", { cookie: web.cookie }),
    web.request("/api/issues/3", { cookie: web.cookie }),
  ]);
  assert.equal(board.status, 200);
  assert.equal(detail.status, 200);
  assert.equal(JSON.parse(board.body).source, "live");
  assert.deepEqual(
    JSON.parse(detail.body).issue.summary,
    JSON.parse(board.body).issues.find(
      (i: { number: number }) => i.number === 3,
    ),
  );
  assert.equal(f.calls(), 1);
});

test("optional damaged run data does not erase host issues", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(
    join(f.repoRoot, f.config.paths.runsDir, "issue-5/progress.json"),
    "damaged data",
  );
  const snapshot = await f.source.snapshot();
  assert.equal(snapshot.issues.length, 7);
  assert.equal(snapshot.issues.find((i) => i.number === 5)?.live, true);
  assert.equal(snapshot.issues.find((i) => i.number === 5)?.column, "planning");
});

test("local workflow role changes appear inside a warm host cache", async (t) => {
  const f = await fixture(t, true);
  const store = new StateStore(stateDir(f.repoRoot));
  await store.appendStatus(2, { at: "2026-11-14T12:00:00Z", status: "ready" });
  assert.equal(
    (await f.source.snapshot()).issues.find((i) => i.number === 2)?.column,
    "ready",
  );
  await store.appendStatus(2, { at: "2026-11-14T12:00:01Z", status: "done" });
  assert.equal(
    (await f.source.snapshot()).issues.find((i) => i.number === 2)?.column,
    "code",
  );
  assert.equal(f.calls(), 1);
});

test("local Ready resets an old completed or planning-stop outcome", async (t) => {
  const f = await fixture(t, true);
  const store = new StateStore(stateDir(f.repoRoot));
  await store.appendStatus(2, { at: "2026-11-14T13:00:00Z", status: "ready" });
  for (const label of ["done", "inProgress"] as const) {
    await writeRunProgress(
      join(f.repoRoot, f.config.paths.runsDir, "issue-2"),
      boardProgress({
        issue: 2,
        state: "ended",
        outcome: { status: label === "done" ? "completed" : "stopped", label },
      }),
    );
    assert.equal(
      (await f.source.snapshot()).issues.find((i) => i.number === 2)?.column,
      "ready",
    );
  }
});

test("shared base document trees are read once per snapshot rather than once per issue", async (t) => {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-shared-docs-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  let calls = 0;
  const source = createFileRunDataSource({
    repoRoot,
    config: structuredClone(DEFAULT_CONFIG),
    metadata: {
      repository: { name: "owner/repo", url: "https://host/owner/repo" },
      baseBranch: "main",
      pushRepository: { slug: "owner/repo", url: "https://host/owner/repo" },
    },
    host: {
      listOpenIssues: async () => [boardIssue(1), boardIssue(2), boardIssue(3)],
      listOpenPullRequests: async () => [],
    },
    runner: async (_cmd, args) => {
      calls++;
      return {
        code: 0,
        stdout: args[0] === "rev-parse" ? "a".repeat(40) : "",
        stderr: "",
      };
    },
    now: () => new Date(0),
    warn: assert.fail,
  });
  await source.snapshot();
  assert.equal(calls, 3);
  await source.snapshot();
  assert.equal(calls, 6);
});

test("empty host repositories produce an empty valid snapshot", async () => {
  const source = createFileRunDataSource({
    repoRoot: "/unused",
    config: structuredClone(DEFAULT_CONFIG),
    metadata: {
      repository: { name: "owner/repo", url: "https://host/owner/repo" },
      baseBranch: "main",
      pushRepository: { slug: "owner/repo", url: "https://host/owner/repo" },
    },
    host: {
      listOpenIssues: async () => [],
      listOpenPullRequests: async () => [],
    },
    runner: async () => {
      throw Error("No Git read is necessary");
    },
    now: () => new Date(0),
    warn: () => {},
  });
  const data = await source.snapshot();
  assert.deepEqual(data.issues, []);
  assert.deepEqual(data.details, {});
  assert.equal(data.syncedAt, new Date(0).toISOString());
});

test("local-mode repository mismatch never consumes another repository's statuses", async (t) => {
  const f = await fixture(t, true);
  await new StateStore(stateDir(f.repoRoot)).writeCursor({
    repository: "other/repo",
    fullSyncAt: "2026-11-14T12:00:00Z",
    syncedUpTo: "2026-11-14T12:00:00Z",
  });
  await assert.rejects(f.source.snapshot(), /different repository/);
});
