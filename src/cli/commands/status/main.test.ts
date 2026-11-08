import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import { STATE_DIR, StateStore } from "../../../state/store.ts";
import type { Host, IssueDependency } from "../../../host/types.ts";
import { main } from "./main.ts";

async function harness(t: TestContext, mode = "local") {
  const root = await mkdtemp(join(tmpdir(), "patchmill-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({ workflow: { stateTracking: mode } }),
  );
  const stateRoot = join(root, STATE_DIR);
  const store = new StateStore(stateRoot);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: (string | number)[] = [];
  const dependencies = new Map<number, IssueDependency[] | Error>();
  const host: Pick<Host, "repository" | "listIssueDependencies"> = {
    async repository() {
      calls.push("repository");
      return { owner: "owner", repo: "repo", defaultBranch: "main" };
    },
    async listIssueDependencies(n) {
      calls.push(n);
      const result = dependencies.get(n) ?? [];
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return {
    calls,
    dependencies,
    host,
    root,
    stateRoot,
    store,
    stdout,
    stderr,
    async issue(
      number: number,
      title: string,
      state: "open" | "closed" = "open",
    ) {
      await store.writeIssue({
        number,
        title,
        state,
        body: "",
        labels: [],
        url: `https://example.invalid/issues/${number}`,
        author: "owner",
        createdAt: "2026-11-01T00:00:00Z",
        comments: [],
      });
    },
    run(args: string[] = [], color = false) {
      stdout.length = 0;
      stderr.length = 0;
      return main(args, {
        repoRoot: root,
        host,
        color,
        timeZone: "UTC",
        output: {
          stdout: (line) => stdout.push(line),
          stderr: (line) => stderr.push(line),
        },
      });
    },
  };
}

// Wrong grouping, last-record selection, or closed filtering changes these rows.
test("status lists issues by status", async (t) => {
  const h = await harness(t);
  await h.store.writeCursor({
    repository: "owner/repo",
    fullSyncAt: "2026-11-01T00:00:00Z",
    syncedUpTo: "2026-11-07T12:00:00Z",
  });
  await h.issue(3, "Add login");
  await h.issue(4, "Clarify API");
  await h.issue(5, "Ship fix", "closed");
  await h.issue(2, "Earlier ready issue");
  await h.issue(6, "Untriaged issue");
  await h.store.appendStatus(3, {
    at: "2026-11-06T10:00:00Z",
    status: "inProgress",
  });
  await h.store.appendStatus(3, {
    at: "2026-11-07T10:00:00Z",
    status: "ready",
  });
  await h.store.appendStatus(4, {
    at: "2026-11-07T11:00:00Z",
    status: "needsInfo",
  });
  await h.store.appendStatus(5, { at: "2026-11-07T12:00:00Z", status: "done" });
  await h.store.appendStatus(2, {
    at: "2026-11-07T09:00:00Z",
    status: "ready",
  });
  const before = await readFile(join(h.stateRoot, "status/3.jsonl"), "utf8");
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.stdout, [
    "Synced 7 Nov 2026, 12:00",
    "",
    "Needs Info (1)",
    "  #4  Clarify API          7 Nov 2026, 11:00",
    "",
    "Ready (2)",
    "  #2  Earlier ready issue  7 Nov 2026, 09:00",
    "  #3  Add login            7 Nov 2026, 10:00",
  ]);
  assert.deepEqual(h.stderr, []);
  assert.equal(await h.run(["--all"]), 0);
  assert.deepEqual(h.stdout.slice(-2), [
    "Done (1)",
    "  #5  Ship fix             7 Nov 2026, 12:00",
  ]);
  assert.equal(
    await readFile(join(h.stateRoot, "status/3.jsonl"), "utf8"),
    before,
  );
});

// Dropping history or optional metadata loses operator-visible run context.
test("status --issue shows every change", async (t) => {
  const h = await harness(t);
  await h.issue(3, "Add login", "closed");
  await h.store.appendStatus(3, {
    at: "2026-11-06T10:00:00Z",
    status: "ready",
  });
  await h.store.appendStatus(3, {
    at: "2026-11-07T10:00:00Z",
    status: "needsInfo",
    runId: "run-3",
    summary: "Need API details\n\u001b[31msecond summary line\u001b[0m",
    cost: "$0.12",
    warnings: ["Missing tests", "Check auth"],
    questionUrl: "https://example.invalid/questions/3",
  });
  assert.equal(await h.run(["--issue", "3"]), 0);
  assert.deepEqual(h.stdout, [
    "#3 Add login",
    "State: Closed",
    "Status: Needs Info",
    "",
    "6 Nov 2026, 10:00  Ready",
    "",
    "7 Nov 2026, 10:00  Needs Info",
    "  Run: run-3",
    "  Summary: Need API details",
    "           second summary line",
    "  Cost: $0.12",
    "  Warning: Missing tests",
    "  Warning: Check auth",
    "  Question: https://example.invalid/questions/3",
  ]);
  assert.deepEqual(h.stderr, []);
});

test("status requires local mode", async (t) => {
  const h = await harness(t, "labels");
  // A file instead of a state directory makes accidental state reads fail.
  await mkdir(join(h.root, ".patchmill"));
  await writeFile(h.stateRoot, "not a directory");
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.stderr, [
    'patchmill status requires workflow.stateTracking "local".',
  ]);
  assert.deepEqual(h.stdout, []);
});

test("status handles absent state and untriaged or missing issue copies without writes", async (t) => {
  const h = await harness(t);
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.stdout, [
    "Not synced yet.",
    "",
    "No issues with local workflow state.",
  ]);
  assert.deepEqual(await readdir(h.root), [CONFIG_FILE]);
  assert.equal(await h.run(["--issue", "9"]), 1);
  assert.deepEqual(h.stderr, [
    "Issue #9 is not in local state. Run patchmill triage to sync it.",
  ]);
  await h.issue(9, "Awaiting triage");
  assert.equal(await h.run(["--issue", "9"]), 0);
  assert.deepEqual(h.stdout, [
    "#9 Awaiting triage",
    "State: Open",
    "Status: Untriaged",
    "",
    "No status changes.",
  ]);
});

test("status warns about damaged copies and unfinished records but rejects corrupt middle records", async (t) => {
  const h = await harness(t);
  await h.issue(3, "Readable issue");
  await writeFile(h.store.issuePath(4), "{broken");
  await h.store.appendStatus(3, {
    at: "2026-11-07T10:00:00Z",
    status: "ready",
  });
  await h.store.appendStatus(7, { at: "2026-11-07T10:00:00Z", status: "done" });
  const path = join(h.stateRoot, "status/3.jsonl");
  const original = await readFile(path, "utf8");
  await writeFile(path, original + "{unfinished");
  assert.equal(await h.run(["--all"]), 0);
  assert.deepEqual(h.stdout, [
    "Not synced yet.",
    "",
    "Ready (1)",
    "  #3  Readable issue  7 Nov 2026, 10:00",
  ]);
  assert.deepEqual(h.stderr, [
    `Warning: damaged issue copy ${h.store.issuePath(4)}`,
    `Warning: Ignoring unfinished status record in ${path}`,
  ]);
  assert.equal(await readFile(path, "utf8"), original + "{unfinished");
  await writeFile(path, original + "{broken\n" + original);
  assert.equal(await h.run(["--issue", "3"]), 1);
  assert.deepEqual(h.stderr, [`Invalid status record in ${path} at line 2`]);
});

test("status validates arguments and handles help before loading config", async (t) => {
  const h = await harness(t);
  await rm(join(h.root, CONFIG_FILE));
  for (const args of [
    ["--issue"],
    ["--issue", "0"],
    ["--issue", "-1"],
    ["--issue", "1.5"],
    ["--issue", "1e2"],
    ["--issue", "x"],
    ["--issue", "9007199254740992"],
    ["--all", "--issue", "3"],
    ["--all", "extra"],
    ["--unknown"],
  ]) {
    assert.equal(await h.run(args), 1);
    assert.match(h.stderr.join("\n"), /Usage: patchmill status/);
    assert.doesNotMatch(h.stderr.join("\n"), /Missing/);
  }
  for (const arg of ["--help", "-h", "help"]) {
    assert.equal(await h.run([arg]), 0);
    assert.match(h.stdout.join("\n"), /Usage: patchmill status/);
    assert.deepEqual(h.stderr, []);
  }
  assert.equal(await h.run(), 1);
  assert.match(h.stderr.join("\n"), /Missing/);
});

async function readyIssues(t: TestContext) {
  const h = await harness(t);
  await h.store.writeCursor({
    repository: "OWNER/REPO",
    fullSyncAt: "2026-09-01T00:00:00Z",
    syncedUpTo: "2026-09-03T19:05:00Z",
  });
  for (const [n, status] of [
    [3, "ready"],
    [12, "inProgress"],
  ] as const) {
    await h.issue(n, n === 3 ? "\u001b[31mLogin\u001b[0m" : "API");
    await h.store.appendStatus(n, { at: "2026-09-03T19:05:00Z", status });
  }
  return h;
}

test("ready and in-progress issues show open blockers aligned with sanitized titles", async (t) => {
  const h = await readyIssues(t);
  h.dependencies.set(3, [
    { repository: "Owner/Repo", number: 2, state: "open" },
    { repository: "other/project", number: 7, state: "open" },
    { repository: "owner/repo", number: 9, state: "closed" },
  ]);
  h.dependencies.set(12, [
    { repository: "owner/repo", number: 3, state: "open" },
  ]);
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.stdout, [
    "Synced 3 Sep 2026, 19:05",
    "",
    "In Progress (1)",
    "  #12  API    3 Sep 2026, 19:05",
    "       Blocked by #3",
    "",
    "Ready (1)",
    "  #3   Login  3 Sep 2026, 19:05",
    "       Blocked by #2, other/project#7",
  ]);
  assert.equal(h.calls.filter((c) => c === "repository").length, 1);
  assert.ok(h.stdout.every((line) => !line.includes("\u001b")));
});

test("status stays offline without selectable shown issues", async (t) => {
  const h = await harness(t);
  for (const [n, status, state] of [
    [1, "needsInfo", "open"],
    [2, "ready", "closed"],
    [3, "done", "open"],
    [4, "unsuitable", "open"],
  ] as const) {
    await h.issue(n, "Issue", state);
    await h.store.appendStatus(n, { at: "bad timestamp", status });
  }
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.calls, []);
  assert.ok(h.stdout.includes("  #1  Issue  bad timestamp"));
});

test("a failed blocker lookup warns without hiding other rows or failing status", async (t) => {
  const h = await readyIssues(t);
  h.dependencies.set(3, new Error("unavailable"));
  h.dependencies.set(12, [
    { repository: "owner/repo", number: 2, state: "open" },
  ]);
  assert.equal(await h.run(), 0);
  assert.ok(h.stdout.includes("       Blockers unknown"));
  assert.ok(h.stdout.includes("       Blocked by #2"));
  assert.deepEqual(h.stderr, [
    "Warning: Cannot read blockers for issue #3: unavailable",
  ]);
});

test("repository mismatch warns once and skips dependency reads", async (t) => {
  const h = await readyIssues(t);
  await h.store.writeCursor({
    repository: "wrong/repo",
    fullSyncAt: "x",
    syncedUpTo: "x",
  });
  assert.equal(await h.run(), 0);
  assert.equal(
    h.stdout.filter((line) => line.includes("Blockers unknown")).length,
    2,
  );
  assert.deepEqual(h.calls, ["repository"]);
  assert.equal(h.stderr.length, 1);
  assert.match(
    h.stderr[0]!,
    /^Warning: Cannot read blockers: .*belongs to wrong\/repo/,
  );
});

test("color styles headings and dates with local SGR spans", async (t) => {
  const h = await readyIssues(t);
  assert.equal(await h.run([], true), 0);
  assert.ok(h.stdout.includes("\u001b[1m\u001b[36mIn Progress (1)\u001b[0m"));
  assert.ok(h.stdout.includes("\u001b[1m\u001b[32mReady (1)\u001b[0m"));
  assert.match(h.stdout[3]!, /\u001b\[2m3 Sep 2026, 19:05\u001b\[0m$/);
});

test("open issue detail reads blockers even when untriaged", async (t) => {
  const h = await harness(t);
  await h.issue(3, "\u001b[31mLogin\u001b[0m");
  h.dependencies.set(3, [
    { repository: "other/repo", number: 2, state: "open" },
  ]);
  assert.equal(await h.run(["--issue", "3"]), 0);
  assert.deepEqual(h.stdout, [
    "#3 Login",
    "State: Open",
    "Status: Untriaged",
    "Blocked by other/repo#2",
    "",
    "No status changes.",
  ]);
});
