import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { CONFIG_FILE } from "../../../config/config.ts";
import { acquireLock, LockHeldError } from "../../../kernel/lock.ts";
import type { CommandRunner } from "../../../process/command.ts";
import { main } from "./main.ts";

async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "patchmill-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify({
      labels: { ready: "queue", inProgress: "working" },
      paths: { runsDir: "owned-runs" },
    }),
  );
  const lockPath = join(root, "owned-runs", "issue-9", "lock");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const calls: string[][] = [];
  let labels = ["working", "spec-approved", "unrelated"];
  let failure: "view" | "edit" | undefined;
  const runner: CommandRunner = async (command, args, options) => {
    assert.equal(command, "gh");
    assert.equal(options?.cwd, root);
    calls.push(args);
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
    if (args[0] === "--version" || args.join(" ") === "auth status")
      return ok();
    if (args.join(" ") === "api user --jq .login") return ok("fake-user");
    if (args[0] === "issue" && ["view", "edit"].includes(args[1]!)) {
      // Reading and resetting labels must both run inside the critical section.
      await assert.rejects(acquireLock(lockPath), LockHeldError);
      assert.equal(args[2], "9");
      if (failure === args[1])
        return { code: 1, stdout: "", stderr: `owned ${failure} failure` };
      if (args[1] === "view") {
        return ok(
          JSON.stringify({
            number: 9,
            title: "Add login",
            body: "",
            labels: labels.map((name) => ({ name })),
            state: "OPEN",
            url: "https://example.invalid/issues/9",
            author: { login: "owner" },
            createdAt: "2026-10-15T00:00:00Z",
            comments: [],
          }),
        );
      }
      assert.deepEqual(args, [
        "issue",
        "edit",
        "9",
        "--add-label",
        "queue",
        "--remove-label",
        "working",
      ]);
      labels = [...labels.filter((label) => label !== "working"), "queue"];
      return ok();
    }
    throw new Error(`Unexpected operation: ${args.join(" ")}`);
  };
  return {
    root,
    lockPath,
    stdout,
    stderr,
    calls,
    labels: () => labels,
    setLabels: (value: string[]) => {
      labels = value;
    },
    fail: (value: "view" | "edit") => {
      failure = value;
    },
    run: (args = ["--issue", "9"]) =>
      main(args, {
        repoRoot: root,
        runner,
        output: {
          stdout: (line) => stdout.push(line),
          stderr: (line) => stderr.push(line),
        },
      }),
  };
}

for (const metadata of [
  "",
  "{broken",
  JSON.stringify({ pid: 999999, startedAt: "old" }),
]) {
  test(`held OS lock blocks release before issue access with diagnostics ${JSON.stringify(metadata)}`, async (t) => {
    const h = await harness(t);
    const owner = await acquireLock(h.lockPath);
    t.after(() => owner.release());
    await writeFile(h.lockPath, metadata);
    const inode = (await stat(h.lockPath)).ino;
    assert.equal(await h.run(), 1);
    assert.match(h.stderr.join("\n"), /Run attempt is active/);
    assert.equal(h.calls.filter((args) => args[0] === "issue").length, 0);
    assert.deepEqual(h.labels(), ["working", "spec-approved", "unrelated"]);
    assert.equal((await stat(h.lockPath)).ino, inode);
    assert.equal(await readFile(h.lockPath, "utf8"), metadata);
  });
}

for (const pid of [999999, process.pid]) {
  test(`unlocked diagnostics with pid ${pid} permit reset and retain the permanent inode`, async (t) => {
    const h = await harness(t);
    await mkdir(dirname(h.lockPath), { recursive: true });
    await writeFile(h.lockPath, JSON.stringify({ pid, startedAt: "old" }));
    const inode = (await stat(h.lockPath)).ino;
    assert.equal(await h.run(), 0);
    assert.deepEqual(h.labels(), ["spec-approved", "unrelated", "queue"]);
    assert.equal(h.calls.filter((args) => args[1] === "edit").length, 1);
    assert.match(h.stdout.join("\n"), /working.*queue/);
    assert.deepEqual(h.stderr, []);
    assert.equal((await stat(h.lockPath)).ino, inode);
    assert.equal(await readFile(h.lockPath, "utf8"), "");
    const successor = await acquireLock(h.lockPath);
    await successor.release();
  });
}

test("issue without inProgress is unchanged and releases its lock", async (t) => {
  const h = await harness(t);
  h.setLabels(["spec-review", "in-progress"]);
  assert.equal(await h.run(), 0);
  assert.deepEqual(h.labels(), ["spec-review", "in-progress"]);
  assert.equal(h.calls.filter((args) => args[1] === "edit").length, 0);
  assert.match(h.stdout.join("\n"), /nothing to release/);
  const successor = await acquireLock(h.lockPath);
  await successor.release();
});

for (const operation of ["view", "edit"] as const) {
  test(`${operation} failure returns 1 without retry and releases the permanent lock`, async (t) => {
    const h = await harness(t);
    const initial = await acquireLock(h.lockPath);
    await initial.release();
    const inode = (await stat(h.lockPath)).ino;
    h.fail(operation);
    assert.equal(await h.run(), 1);
    assert.match(h.stderr.join("\n"), new RegExp(`owned ${operation} failure`));
    assert.deepEqual(h.stdout, []);
    assert.deepEqual(h.labels(), ["working", "spec-approved", "unrelated"]);
    assert.equal(h.calls.filter((args) => args[1] === operation).length, 1);
    assert.equal(
      h.calls.filter((args) => args[1] === "edit").length,
      operation === "view" ? 0 : 1,
    );
    assert.equal((await stat(h.lockPath)).ino, inode);
    assert.equal(await readFile(h.lockPath, "utf8"), "");
    const successor = await acquireLock(h.lockPath);
    await successor.release();
  });
}

test("invalid issue arguments stop before configuration or host access", async (t) => {
  const h = await harness(t);
  await rm(join(h.root, CONFIG_FILE));
  for (const args of [
    [],
    ["--issue"],
    ["--issue", "x"],
    ["--issue", "0"],
    ["--issue", "-1"],
    ["--issue", "1.5"],
    ["--issue", "1e2"],
    ["--issue", "9junk"],
    ["--issue", "9007199254740992"],
    ["--issue", "9", "extra"],
    ["--issue", "9", "--issue", "10"],
    ["--unknown"],
  ]) {
    h.stderr.length = 0;
    assert.equal(await h.run(args), 1);
    assert.match(h.stderr.join("\n"), /--issue/);
  }
  assert.deepEqual(h.calls, []);
});

test("missing configuration returns 1 without host access", async (t) => {
  const h = await harness(t);
  await rm(join(h.root, CONFIG_FILE));
  assert.equal(await h.run(), 1);
  assert.match(h.stderr.join("\n"), /Missing/);
  assert.deepEqual(h.calls, []);
});

test("help returns before configuration or host access", async (t) => {
  const h = await harness(t);
  await rm(join(h.root, CONFIG_FILE));
  assert.equal(await h.run(["--help"]), 0);
  assert.deepEqual(h.stderr, []);
  assert.deepEqual(h.calls, []);
});
