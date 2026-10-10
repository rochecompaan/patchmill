import assert from "node:assert/strict";
import test from "node:test";
import fs, {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  acquireIssueRunLease,
  releaseIssueRunLease,
} from "./recovery-lease.ts";
import { runStatePath, writeRunState } from "./run-state.ts";
import {
  JsonlProgressReporter,
  runLogPath,
  runPiSessionPath,
} from "./progress.ts";
import { finalLogPath } from "./main.ts";

const timestamp = "2026-10-05T12:00:00.000Z";

test("wrong lease cannot write another issue's state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "run-state-owner-"));
  const lease = await acquireIssueRunLease(dir, 226);
  try {
    await assert.rejects(
      writeRunState(
        dir,
        { issueNumber: 227, title: "Other issue", status: "claimed" },
        lease,
      ),
      /another issue/u,
    );
    assert.equal((await readdir(dir)).includes("issue-227.json"), false);
  } finally {
    await releaseIssueRunLease(lease);
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed replacement preserves complete old state and replacement owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "run-state-replaced-"));
  const lease = await acquireIssueRunLease(dir, 226);
  const statePath = runStatePath(dir, 226);
  const old = JSON.stringify({
    issueNumber: 226,
    title: "Original",
    status: "planning",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await writeFile(statePath, old);
  const replacement = JSON.stringify({
    ...lease.record,
    ownerToken: "replacement",
  });
  await writeFile(lease.path, replacement);
  try {
    await assert.rejects(
      writeRunState(dir, { issueNumber: 226, status: "implementing" }, lease),
      /not owned/u,
    );
    assert.equal(await readFile(statePath, "utf8"), old);
    assert.equal(await readFile(lease.path, "utf8"), replacement);
    assert.deepEqual(
      (await readdir(dir)).filter((path) => path.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("atomic state replacement exposes complete old or new documents at a write barrier", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "run-state-atomic-"));
  const lease = await acquireIssueRunLease(dir, 226);
  const path = runStatePath(dir, 226);
  await writeRunState(
    dir,
    { issueNumber: 226, title: "Atomic", status: "planning" },
    lease,
    timestamp,
  );
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (from, to) => {
    if (to === path) {
      entered();
      await held;
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  const writing = writeRunState(
    dir,
    { issueNumber: 226, status: "implementing", commits: ["new"] },
    lease,
    timestamp,
  );
  try {
    await started;
    for (let read = 0; read < 8; read++)
      assert.equal(JSON.parse(await readFile(path, "utf8")).status, "planning");
    release();
    await writing;
    const next = JSON.parse(await readFile(path, "utf8"));
    assert.equal(next.status, "implementing");
    assert.deepEqual(next.commits, ["new"]);
  } finally {
    release();
    await writing.catch(() => undefined);
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await releaseIssueRunLease(lease);
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed atomic placement removes only its temporary file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "run-state-failed-"));
  const lease = await acquireIssueRunLease(dir, 226);
  const path = runStatePath(dir, 226);
  await writeRunState(
    dir,
    { issueNumber: 226, title: "Atomic", status: "planning" },
    lease,
    timestamp,
  );
  const old = await readFile(path, "utf8");
  await writeFile(join(dir, "another-attempt.tmp"), "preserve");
  const rename = fs.rename;
  t.mock.method(fs, "rename", (from, to) =>
    to === path
      ? Promise.reject(new Error("placement failed"))
      : rename(from, to),
  );
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      writeRunState(dir, { issueNumber: 226, status: "implementing" }, lease),
      /placement failed/u,
    );
    assert.equal(await readFile(path, "utf8"), old);
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".tmp")),
      ["another-attempt.tmp"],
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await releaseIssueRunLease(lease);
    await rm(dir, { recursive: true, force: true });
  }
});

test("token replacement during a write prevents final state placement", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "run-state-final-owner-"));
  const lease = await acquireIssueRunLease(dir, 226);
  const path = runStatePath(dir, 226);
  await writeRunState(
    dir,
    { issueNumber: 226, title: "Original", status: "planning" },
    lease,
    timestamp,
  );
  const old = await readFile(path, "utf8");
  const replacement = JSON.stringify({
    ...lease.record,
    ownerToken: "replacement",
  });
  const open = fs.open;
  t.mock.method(fs, "open", async (file, ...args) => {
    const handle = await open(file, ...args);
    if (String(file).startsWith(`${path}.`) && String(file).endsWith(".tmp")) {
      const sync = handle.sync.bind(handle);
      t.mock.method(handle, "sync", async () => {
        await writeFile(lease.path, replacement);
        await sync();
      });
    }
    return handle;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      writeRunState(dir, { issueNumber: 226, status: "implementing" }, lease),
      /not owned/u,
    );
    assert.equal(await readFile(path, "utf8"), old);
    assert.equal(await readFile(lease.path, "utf8"), replacement);
    assert.deepEqual(
      (await readdir(dir)).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});

test("equal timestamps produce separate logs and sessions for each attempt", () => {
  assert.equal(
    runLogPath("/runs", timestamp, "attempt-a", 226),
    "/runs/issue-226/run-2026-10-05T12-00-00-000Z-attempt-a.jsonl",
  );
  assert.notEqual(
    runLogPath("/runs", timestamp, "attempt-a", 226),
    runLogPath("/runs", timestamp, "attempt-b", 226),
  );
  assert.equal(
    runPiSessionPath("/runs", timestamp, "attempt-a", 226),
    "/runs/issue-226/run-2026-10-05T12-00-00-000Z-attempt-a-pi-sessions",
  );
});

test("final log collision preserves both the destination and preliminary evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "run-log-placement-"));
  const preliminary = join(dir, "preliminary.jsonl");
  const destination = runLogPath(dir, timestamp, "attempt-a", 226);
  await import("node:fs/promises").then((fs) =>
    fs.mkdir(dirname(destination), { recursive: true }),
  );
  await writeFile(preliminary, "this attempt\n");
  await writeFile(destination, "other evidence\n");
  try {
    await assert.rejects(
      finalLogPath(
        preliminary,
        dir,
        timestamp,
        {
          status: "dry-run",
          issue: {
            number: 226,
            title: "Issue",
            body: "",
            labels: [],
            state: "open",
          },
          transition: "test",
        },
        "attempt-a",
      ),
      /EEXIST/u,
    );
    assert.equal(await readFile(destination, "utf8"), "other evidence\n");
    assert.equal(await readFile(preliminary, "utf8"), "this attempt\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a new reporter cannot append to an existing attempt log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "run-log-exclusive-"));
  const path = join(dir, "run.jsonl");
  await writeFile(path, "previous owner\n");
  try {
    const reporter = new JsonlProgressReporter(path);
    await assert.rejects(
      reporter.event({
        time: timestamp,
        level: "info",
        stage: "run",
        message: "new owner",
      }),
      /EEXIST/u,
    );
    assert.equal(await readFile(path, "utf8"), "previous owner\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
