import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { runCommand } from "../../process/command.ts";
import {
  acquireLifetimeLock,
  LifetimeLockHeldError,
  lifetimeLockPath,
  processStartMarker,
  type LifetimeLockRecord,
} from "./lifetime-lock.ts";

const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = async (cwd: string, args: string[]) => {
  const result = await runCommand("git", args, { cwd, env });
  assert.equal(result.code, 0, result.stderr);
};

async function repository(t: TestContext) {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-run-lock-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = join(dir, "repo");
  await fs.mkdir(root);
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "init",
  ]);
  const worktree = join(dir, "wt");
  await git(root, ["worktree", "add", "-q", "-b", "side", worktree]);
  const lines: string[] = [];
  const acquire = (repoRoot = root) =>
    acquireLifetimeLock({
      repoRoot,
      runner: runCommand,
      now: () => new Date(2026, 10, 21, 12),
      log: (line) => lines.push(line),
    });
  return { root, worktree, lines, acquire };
}

function holder(t: TestContext, repoRoot: string) {
  const child = fork(
    new URL("../../../test-support/lifetime-lock-child.mjs", import.meta.url),
    [repoRoot],
    { execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"] },
  );
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  const acquired = once(child, "message").then(
    ([message]) => (message as { pid: number }).pid,
  );
  return { child, acquired };
}

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await once(child, "exit");
  return child.pid!;
}

async function writeRecord(
  root: string,
  record: Partial<LifetimeLockRecord>,
): Promise<string> {
  const path = await lifetimeLockPath(root, runCommand);
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(
    path,
    JSON.stringify({
      instanceId: "old",
      pid: process.pid,
      processStart: null,
      host: hostname(),
      repository: join(root, ".git"),
      startedAt: "2026-11-20T10:00:00.000Z",
      ...record,
    }),
  );
  return path;
}

test("the lock lives in the git common directory shared by worktrees", async (t) => {
  const r = await repository(t);
  const main = await lifetimeLockPath(r.root, runCommand);
  assert.equal(await lifetimeLockPath(r.worktree, runCommand), main);
  assert.match(main, /\/\.git\/patchmill\/run\.lock$/);
});

test("a live owner refuses a second runner", async (t) => {
  const r = await repository(t);
  const h = holder(t, r.root);
  const pid = await h.acquired;
  for (const repoRoot of [r.root, r.worktree]) {
    await assert.rejects(
      r.acquire(repoRoot),
      (error: unknown) =>
        error instanceof LifetimeLockHeldError && error.record?.pid === pid,
    );
  }
});

test("recovery after an unclean exit", async (t) => {
  const r = await repository(t);
  const h = holder(t, r.root);
  const pid = await h.acquired;
  h.child.kill("SIGKILL");
  await once(h.child, "exit");
  const lock = await r.acquire();
  try {
    assert.match(
      r.lines.join("\n"),
      new RegExp(`replaced a stale run lock \\(pid ${pid}`),
    );
    const record = JSON.parse(await fs.readFile(lock.path, "utf8"));
    assert.equal(record.pid, process.pid);
    assert.equal(record.host, hostname());
    assert.equal(typeof record.instanceId, "string");
  } finally {
    await lock.release();
  }
});

for (const processStart of ["12345", null]) {
  test(`a stale record of a dead PID is replaced (start marker ${String(processStart)})`, async (t) => {
    const r = await repository(t);
    const pid = await deadPid();
    await writeRecord(r.root, { pid, processStart });
    const lock = await r.acquire();
    await lock.release();
    assert.match(
      r.lines.join("\n"),
      new RegExp(`replaced a stale run lock \\(pid ${pid}`),
    );
  });
}

const procStat = await fs
  .access("/proc/self/stat")
  .then(() => true)
  .catch(() => false);

test(
  "a reused PID with another start marker is stale",
  { skip: !procStat && "no /proc on this platform" },
  async (t) => {
    const r = await repository(t);
    await writeRecord(r.root, { processStart: "1" });
    const lock = await r.acquire();
    await lock.release();
    assert.match(r.lines.join("\n"), /replaced a stale run lock/);
  },
);

test("a record of this live process with its own start marker refuses", async (t) => {
  const r = await repository(t);
  await writeRecord(r.root, {
    processStart: await processStartMarker(process.pid),
  });
  await assert.rejects(r.acquire(), LifetimeLockHeldError);
  assert.deepEqual(r.lines, []);
});

test("a record from another host refuses", async (t) => {
  const r = await repository(t);
  await writeRecord(r.root, { host: "elsewhere", pid: await deadPid() });
  await assert.rejects(
    r.acquire(),
    (error: unknown) =>
      error instanceof LifetimeLockHeldError &&
      /Remove .*run\.lock|run\.lock.*Remove/s.test(error.message),
  );
});

test("release clears the record and keeps the inode", async (t) => {
  const r = await repository(t);
  const first = await r.acquire();
  const inode = (await fs.stat(first.path)).ino;
  await first.release();
  assert.equal(await fs.readFile(first.path, "utf8"), "");
  assert.equal((await fs.stat(first.path)).ino, inode);
  const second = await r.acquire();
  await second.release();
  assert.deepEqual(r.lines, []);
});
