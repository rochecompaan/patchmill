import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  withRepositoryMutation,
  RepositoryMutationBusyError,
  RepositoryMutationOwnershipError,
  RepositoryMutationInterruptedError,
  type RepositoryMutationContext,
} from "./repository-mutation.ts";

async function fixture(): Promise<RepositoryMutationContext> {
  const root = await mkdtemp(join(tmpdir(), "repository-mutation-"));
  return {
    namespace: {
      commonDir: join(root, ".git"),
      cloneRoot: root,
      hostRepository: {
        provider: "github-gh",
        host: "github.com",
        owner: "test",
        repository: "repo",
      },
      runStateDir: join(root, ".runs"),
      worktreeRoot: join(root, ".worktrees"),
      todoRoot: { kind: "workspace-relative", path: ".pi/todos" },
    },
    attemptId: "attempt-a",
    assertOwned: async () => {},
    runner: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
  };
}
function guardPath(context: RepositoryMutationContext) {
  return join(
    context.namespace.commonDir,
    "patchmill",
    "run-once",
    "mutation.lock",
  );
}

test("worktree transactions serialize without starting a busy contender", async () => {
  const context = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = withRepositoryMutation(context, async () => {
    entered();
    await held;
  });
  try {
    await started;
    let secondEffect = false;
    await assert.rejects(
      withRepositoryMutation(
        { ...context, attemptId: "attempt-b" },
        async () => {
          secondEffect = true;
        },
        { waitMs: 0 },
      ),
      RepositoryMutationBusyError,
    );
    assert.equal(secondEffect, false);
    release();
    await first;
    await withRepositoryMutation(
      { ...context, attemptId: "attempt-b" },
      async () => {
        secondEffect = true;
      },
    );
    assert.equal(secondEffect, true);
  } finally {
    release();
    await first;
    await rm(context.namespace.cloneRoot, { recursive: true, force: true });
  }
});

test("obsolete release preserves a replacement guard", async () => {
  const context = await fixture();
  let replacement = "";
  try {
    await assert.rejects(
      withRepositoryMutation(context, async () => {
        const record = JSON.parse(await readFile(guardPath(context), "utf8"));
        replacement = JSON.stringify({ ...record, ownerToken: "replacement" });
        await writeFile(guardPath(context), replacement);
      }),
      RepositoryMutationOwnershipError,
    );
    assert.equal(await readFile(guardPath(context), "utf8"), replacement);
  } finally {
    await rm(context.namespace.cloneRoot, { recursive: true, force: true });
  }
});

test("dead local guards reconcile without discarding interrupted evidence", async () => {
  const context = await fixture();
  const path = guardPath(context);
  await mkdir(join(context.namespace.commonDir, "patchmill", "run-once"), {
    recursive: true,
  });
  const raw = JSON.stringify({
    version: 2,
    ownerToken: "dead",
    attemptId: "prior",
    pid: 2147483647,
    hostname: hostname(),
  });
  await writeFile(path, raw);
  try {
    await withRepositoryMutation(context, async () => {});
    const root = join(
      context.namespace.commonDir,
      "patchmill",
      "run-once",
      "archive",
      "mutations",
    );
    const archives = await readdir(root);
    assert.equal(archives.length, 1);
    assert.equal(await readFile(join(root, archives[0]), "utf8"), raw);
  } finally {
    await rm(context.namespace.cloneRoot, { recursive: true, force: true });
  }
});

test(
  "dead owner cannot release a still-executing Git command guard",
  { timeout: 20_000 },
  async () => {
    const context = await fixture();
    const root = context.namespace.cloneRoot;
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "--initial-branch=main");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    );
    const oid = git("rev-parse", "HEAD");
    const command = join(root, "held.cjs");
    await writeFile(
      command,
      `const fs=require('node:fs'); const cp=require('node:child_process');
const watcher=fs.watch(${JSON.stringify(root)},(_event,name)=>{ if(name==='release'){ cp.execFileSync('git',['update-ref','refs/heads/owned-late',${JSON.stringify(oid)}],{cwd:${JSON.stringify(root)}}); watcher.close(); process.exit(0); }});
console.log('ready');`,
    );
    const ownerFile = join(root, "owner.mjs");
    const module = new URL("./repository-mutation.ts", import.meta.url).href;
    const runner = new URL("../cli/commands/triage/command.ts", import.meta.url)
      .href;
    await writeFile(
      ownerFile,
      `import { withRepositoryMutation } from ${JSON.stringify(module)};
import { createCommandRunner } from ${JSON.stringify(runner)};
await withRepositoryMutation({ namespace:${JSON.stringify(context.namespace)}, attemptId:'dead-owner', assertOwned:async()=>{}, runner:createCommandRunner() }, tx=>tx.run(['-c',${JSON.stringify(`alias.hold=!${process.execPath} ${command}`)},'hold'],{onStdout(text){if(text.includes('ready'))process.send('ready');}}));`,
    );
    const owner = fork(ownerFile, [], {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    let group: number | undefined;
    try {
      await once(owner, "message", { signal: AbortSignal.timeout(5_000) });
      const original = await readFile(guardPath(context), "utf8");
      const token = JSON.parse(original).ownerToken;
      const directory = join(
        context.namespace.commonDir,
        "patchmill",
        "run-once",
        "mutation-commands",
        token,
      );
      const receiptPath = join(directory, (await readdir(directory))[0]);
      const receipt = await readFile(receiptPath, "utf8");
      group = JSON.parse(receipt).processGroupId;
      const exited = once(owner, "exit");
      owner.kill("SIGKILL");
      await exited;
      await assert.rejects(
        withRepositoryMutation(context, async () =>
          assert.fail("takeover must not mutate"),
        ),
        RepositoryMutationOwnershipError,
      );
      assert.equal(await readFile(guardPath(context), "utf8"), original);
      assert.equal(await readFile(receiptPath, "utf8"), receipt);
      const exists = execFileSync("git", ["show-ref"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(exists.includes("owned-late"), false);
    } finally {
      owner.kill("SIGKILL");
      if (group) {
        try {
          process.kill(-group, "SIGKILL");
        } catch {
          /* already stopped */
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("unknown spawn windows and legacy guards refuse takeover", async () => {
  for (const state of ["pending", "running", "unverified"]) {
    const context = await fixture();
    const root = join(context.namespace.commonDir, "patchmill", "run-once");
    const commands = join(root, "mutation-commands", "dead");
    await mkdir(commands, { recursive: true });
    const raw = JSON.stringify({
      version: 2,
      ownerToken: "dead",
      attemptId: "old",
      pid: 2147483647,
      hostname: hostname(),
    });
    await writeFile(guardPath(context), raw);
    await writeFile(
      join(commands, "command.json"),
      JSON.stringify({
        version: 1,
        ownerToken: "dead",
        state,
        processGroupId: 2147483647,
      }),
    );
    try {
      await assert.rejects(
        withRepositoryMutation(context, async () =>
          assert.fail("unknown command must not start"),
        ),
        RepositoryMutationOwnershipError,
      );
      assert.equal(await readFile(guardPath(context), "utf8"), raw);
    } finally {
      await rm(context.namespace.cloneRoot, { recursive: true, force: true });
    }
  }
});

test("foreign or malformed mutation owners stay fail-closed", async () => {
  for (const raw of [
    "not-json",
    JSON.stringify({
      version: 1,
      ownerToken: "foreign",
      attemptId: "prior",
      pid: process.pid,
      hostname: "foreign-host",
    }),
  ]) {
    const context = await fixture();
    await mkdir(join(context.namespace.commonDir, "patchmill", "run-once"), {
      recursive: true,
    });
    await writeFile(guardPath(context), raw);
    try {
      await assert.rejects(
        withRepositoryMutation(context, async () =>
          assert.fail("action must not start"),
        ),
        RepositoryMutationOwnershipError,
      );
      assert.equal(await readFile(guardPath(context), "utf8"), raw);
    } finally {
      await rm(context.namespace.cloneRoot, { recursive: true, force: true });
    }
  }
});

test("unverified command shutdown retains its guard and original interruption", async () => {
  const context = await fixture();
  context.runner = {
    supportsOwnedGit: true,
    run: async (_command, _args, options) => {
      await options!.ownedGit!.onStopped(false);
      return { code: 1, stdout: "partial", stderr: "shutdown unverified" };
    },
  };
  try {
    await assert.rejects(
      withRepositoryMutation(context, (tx) => tx.run(["fetch", "origin"])),
      RepositoryMutationInterruptedError,
    );
    const raw = await readFile(guardPath(context), "utf8");
    assert.equal(JSON.parse(raw).attemptId, "attempt-a");
    await assert.rejects(
      withRepositoryMutation(
        { ...context, attemptId: "second" },
        async () => assert.fail("guard must remain owned"),
        { waitMs: 0 },
      ),
      RepositoryMutationBusyError,
    );
    assert.equal(await readFile(guardPath(context), "utf8"), raw);
  } finally {
    await rm(context.namespace.cloneRoot, { recursive: true, force: true });
  }
});

test("command timeout waits for command shutdown and preserves interruption evidence", async () => {
  const context = await fixture();
  let stopped = false;
  context.runner = {
    supportsOwnedGit: true,
    run: async (_command, _args, options) =>
      new Promise((resolve) => {
        options!.signal!.addEventListener(
          "abort",
          () => {
            stopped = true;
            void options!
              .ownedGit!.onStopped(true)
              .then(() =>
                resolve({ code: 1, stdout: "partial", stderr: "aborted" }),
              );
          },
          { once: true },
        );
      }),
  };
  try {
    await assert.rejects(
      withRepositoryMutation(context, (tx) => tx.run(["fetch", "origin"]), {
        commandMs: 5,
      }),
      RepositoryMutationInterruptedError,
    );
    assert.equal(stopped, true);
    await assert.rejects(readFile(guardPath(context)), { code: "ENOENT" });
    const commandsRoot = join(
      context.namespace.commonDir,
      "patchmill",
      "run-once",
      "mutation-commands",
    );
    const owners = await readdir(commandsRoot);
    const records = await readdir(join(commandsRoot, owners[0]));
    assert.equal(records.length, 1);
    assert.equal(
      JSON.parse(
        await readFile(join(commandsRoot, owners[0], records[0]), "utf8"),
      ).state,
      "stopped",
    );
  } finally {
    await rm(context.namespace.cloneRoot, { recursive: true, force: true });
  }
});
