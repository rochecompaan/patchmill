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
  return {
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
    run(args: string[] = []) {
      stdout.length = 0;
      stderr.length = 0;
      return main(args, {
        repoRoot: root,
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
    "Synced up to 2026-11-07T12:00:00Z",
    "needsInfo",
    "  #4 Clarify API (2026-11-07T11:00:00Z)",
    "ready",
    "  #2 Earlier ready issue (2026-11-07T09:00:00Z)",
    "  #3 Add login (2026-11-07T10:00:00Z)",
  ]);
  assert.deepEqual(h.stderr, []);
  assert.equal(await h.run(["--all"]), 0);
  assert.deepEqual(h.stdout.slice(-2), [
    "done",
    "  #5 Ship fix (2026-11-07T12:00:00Z)",
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
    summary: "Need API details",
    cost: "$0.12",
    warnings: ["Missing tests", "Check auth"],
    questionUrl: "https://example.invalid/questions/3",
  });
  assert.equal(await h.run(["--issue", "3"]), 0);
  assert.deepEqual(h.stdout, [
    "#3 Add login",
    "State: closed",
    "Status: needsInfo",
    "2026-11-06T10:00:00Z ready",
    "2026-11-07T10:00:00Z needsInfo",
    "  run: run-3",
    "  summary: Need API details",
    "  cost: $0.12",
    "  warning: Missing tests",
    "  warning: Check auth",
    "  question: https://example.invalid/questions/3",
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
    "State: open",
    "Status: untriaged",
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
    "ready",
    "  #3 Readable issue (2026-11-07T10:00:00Z)",
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
