import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { setupCleanup } from "../../test-support/merged-cleanup-fixture.ts";
import { LockHeldError, acquireLock } from "./lock.ts";
import { readCleanupReceipt } from "./cleanup-state.ts";
import type { CommandRunner } from "../process/command.ts";

test("hook is Bash, one path argument, under the lock before every removal", async (t) => {
  const c = await setupCleanup(t);
  const planning = await c.planning();
  const before = await fs.stat(c.lockPath);
  const parentBefore = await fs.stat(c.issueDir);
  const commands: string[] = [];
  const runner: CommandRunner = async (command, args, options) => {
    commands.push(`${command} ${args.join(" ")}`);
    if (command === "bash" || args[1] === "remove" || args[0] === "branch") {
      await assert.rejects(acquireLock(c.lockPath), LockHeldError);
      if (command === "bash") {
        assert.deepEqual(args, [join(c.worktree, "scripts/cleanup hook.sh")]);
        assert.equal(options?.cwd, c.worktree);
        assert.equal(
          (await fs.stat(join(c.worktree, c.hookPath))).mode & 0o111,
          0,
        );
      } else assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
    }
    return c.deps.runner(command, args, options);
  };
  assert.equal((await c.cleanup({ runner })).status, "cleaned");
  assert.equal(
    commands.filter((command) => command.startsWith("bash ")).length,
    1,
  );
  await assert.rejects(fs.access(c.worktree));
  for (const workspace of planning)
    await assert.rejects(fs.access(workspace.path));
  assert.equal(await c.localBranch(), false);
  const after = await fs.stat(c.lockPath);
  const parentAfter = await fs.stat(c.issueDir);
  assert.deepEqual(
    [after.dev, after.ino, parentAfter.dev, parentAfter.ino],
    [before.dev, before.ino, parentBefore.dev, parentBefore.ino],
  );
  assert.match(
    await fs.readFile(join(c.issueDir, "cleanup.log"), "utf8"),
    new RegExp(c.worktree),
  );
  assert.equal(
    (await readCleanupReceipt(c.issueDir))?.hook.status,
    "succeeded",
  );
  assert.match(
    await c.git(["ls-remote", "--heads", "origin", "agent/issue-9-add-login"]),
    /agent\/issue-9-add-login/,
  );
});

for (const mode of ["dirty", "remove failure", "branch failure"] as const) {
  test(`successful hook is not repeated after ${mode}`, async (t) => {
    const c = await setupCleanup(t);
    if (mode === "dirty") await fs.writeFile(join(c.worktree, "dirty"), "keep");
    const runner: CommandRunner = (command, args, options) => {
      if (
        (mode === "remove failure" && args[1] === "remove") ||
        (mode === "branch failure" && args[0] === "branch")
      )
        return Promise.resolve({
          code: 1,
          stdout: "",
          stderr: "cleanup denied",
        });
      return c.deps.runner(command, args, options);
    };
    assert.equal((await c.cleanup({ runner })).status, "kept");
    assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
    assert.equal(await c.localBranch(), true);
    if (mode === "dirty") {
      assert.match(c.output.join("\n"), /Kept worktree .*uncommitted changes/);
      await fs.rm(join(c.worktree, "dirty"));
    }
    assert.equal((await c.cleanup()).status, "cleaned");
    assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\n");
    assert.equal(await c.localBranch(), false);
    assert.equal((await c.cleanup()).status, "skipped");
  });
}

test("hook can remove its own generated dirt before status inspection", async (t) => {
  const c = await setupCleanup(t);
  await fs.writeFile(join(c.worktree, "generated"), "remove");
  await fs.appendFile(join(c.worktree, c.hookPath), "rm generated\n");
  await c.git(["add", "scripts/cleanup hook.sh"], c.worktree);
  await c.git(["commit", "-m", "Cleanup generated files"], c.worktree);
  assert.equal((await c.cleanup()).status, "cleaned");
  await assert.rejects(fs.access(c.worktree));
});

for (const mode of [
  "non-zero",
  "missing script",
  "throw",
  "interrupt",
] as const) {
  test(`hook ${mode} keeps every target and records diagnostics`, async (t) => {
    const c = await setupCleanup(t);
    const planning = await c.planning();
    const controller = new AbortController();
    if (mode === "non-zero")
      await fs.appendFile(
        join(c.worktree, c.hookPath),
        "echo failure >&2\nexit 7\n",
      );
    if (mode === "missing script") c.config.cleanupHook = "./absent.sh";
    const runner: CommandRunner = async (command, args, options) => {
      if (command === "bash" && mode === "throw")
        throw new Error("hook start failed");
      if (command === "bash" && mode === "interrupt") {
        controller.abort();
        return { code: -1, stdout: "", stderr: "hook interrupted" };
      }
      return c.deps.runner(command, args, options);
    };
    const runLogPath = join(c.dir, "pi.log");
    assert.equal(
      (await c.cleanup({ runner, signal: controller.signal, runLogPath }))
        .status,
      "kept",
    );
    assert.deepEqual(c.host.state().issues[0]!.labels, ["agent-done"]);
    assert.equal(await readCleanupReceipt(c.issueDir), undefined);
    await fs.access(c.worktree);
    for (const workspace of planning) {
      await fs.access(workspace.path);
      assert.equal(await c.localBranch(workspace.branch), true);
    }
    assert.equal(await c.localBranch(), true);
    assert.match(c.output.join("\n"), /cleanup.*failed/i);
    assert.match(c.output.join("\n"), /cleanup.log/);
    assert.match(
      await fs.readFile(join(c.issueDir, "cleanup.log"), "utf8"),
      /failure|absent.sh|hook start failed|hook interrupted/,
    );
    assert.match(await fs.readFile(runLogPath, "utf8"), /failed/i);
  });
}

test("failed hook can be retried successfully", async (t) => {
  const c = await setupCleanup(t);
  await fs.appendFile(join(c.worktree, c.hookPath), "exit 3\n");
  assert.equal((await c.cleanup()).status, "kept");
  await fs.writeFile(
    join(c.worktree, c.hookPath),
    `printf 'hook ran\\n' >> ${JSON.stringify(c.counter)}\n`,
  );
  await c.git(["add", "scripts/cleanup hook.sh"], c.worktree);
  await c.git(["commit", "-m", "Repair cleanup hook"], c.worktree);
  assert.equal((await c.cleanup()).status, "cleaned");
  assert.equal(await fs.readFile(c.counter, "utf8"), "hook ran\nhook ran\n");
});

for (const path of ["-v", "cleanup-from-path.sh", ""]) {
  test(`hook path is a literal worktree path: ${JSON.stringify(path)}`, async (t) => {
    const c = await setupCleanup(t);
    const bin = join(c.dir, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(
      join(bin, "cleanup-from-path.sh"),
      `printf 'unexpected\\n' >> ${JSON.stringify(c.counter)}\n`,
      { mode: 0o755 },
    );
    c.env.PATH = `${bin}:${c.env.PATH}`;
    c.config.cleanupHook = path;
    assert.equal((await c.cleanup()).status, "kept");
    await fs.access(c.worktree);
    await assert.rejects(fs.access(c.counter));
  });
}

test("already-aborted cleanup starts no hook or removal", async (t) => {
  const c = await setupCleanup(t);
  assert.equal(
    (await c.cleanup({ signal: AbortSignal.abort() })).status,
    "skipped",
  );
  await fs.access(c.worktree);
  await assert.rejects(fs.access(c.counter));
});

for (const hook of [true, false]) {
  test(`missing implementation directory without receipt (hook=${hook})`, async (t) => {
    const c = await setupCleanup(t, hook);
    await c.git(["worktree", "remove", c.worktree]);
    assert.equal((await c.cleanup()).status, hook ? "kept" : "cleaned");
    assert.equal(await c.localBranch(), hook);
    if (hook)
      assert.match(
        c.output.join("\n"),
        /implementation.*worktree|worktree.*missing/i,
      );
  });
}

for (const mode of [
  "corrupt",
  "version",
  "identity",
  "receipt write",
  "log open",
  "log after hook",
  "log during removal",
] as const) {
  test(`cleanup state failure preserves remaining targets: ${mode}`, async (t) => {
    const c = await setupCleanup(t);
    const planning = await c.planning();
    const receiptPath = join(c.issueDir, "cleanup.json");
    const logPath = join(c.issueDir, "cleanup.log");
    if (["corrupt", "version", "identity"].includes(mode)) {
      await fs.writeFile(join(c.worktree, "dirty"), "keep");
      await c.cleanup();
      const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
      if (mode === "version") receipt.version = 999;
      if (mode === "identity") receipt.identity.pullRequest = 99;
      await fs.writeFile(
        receiptPath,
        mode === "corrupt" ? "{" : JSON.stringify(receipt),
      );
    }
    if (mode === "log open") await fs.mkdir(logPath);
    const runner: CommandRunner = async (command, args, options) => {
      const result = await c.deps.runner(command, args, options);
      if (command === "bash" && mode === "receipt write")
        await fs.mkdir(receiptPath);
      if (
        (command === "bash" && mode === "log after hook") ||
        (args[1] === "remove" && mode === "log during removal")
      ) {
        await fs.rm(logPath);
        await fs.mkdir(logPath);
      }
      return result;
    };
    assert.equal((await c.cleanup({ runner })).status, "kept");
    assert.equal(await c.localBranch(), true);
    if (mode !== "log during removal") await fs.access(c.worktree);
    for (const workspace of planning) {
      // Prior success with a dirty implementation already removed clean siblings.
      if (!["corrupt", "version", "identity"].includes(mode))
        await fs.access(workspace.path);
    }
    assert.match(c.output.join("\n"), /cleanup.*failed/i);
  });
}
