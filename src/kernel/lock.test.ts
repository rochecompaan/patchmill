import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { fork } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test, type TestContext } from "node:test";
import fsExt from "fs-ext";
import { acquireLock, LockHeldError, readLock } from "./lock.ts";

async function location(t: TestContext) {
  const dir = await fs.mkdtemp(join(tmpdir(), "patchmill-lock-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return join(dir, "issue-7", "lock");
}

function child(t: TestContext, mode: string, path: string) {
  const proc = fork(
    new URL("../../test-support/issue-lock-child.mjs", import.meta.url),
    [mode, path],
    {
      execArgv: [],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  type Message = { event: string; pid?: number; childPid?: number };
  const messages: Message[] = [];
  let receive: ((message: Message) => void) | undefined;
  proc.on("message", (message: Message) => {
    if (receive) {
      const resolve = receive;
      receive = undefined;
      resolve(message);
    } else messages.push(message);
  });
  t.after(async () => {
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, "exit");
      proc.kill("SIGKILL");
      await exited;
    }
  });
  return {
    proc,
    send: (command: string) => proc.send(command),
    async next(event?: string) {
      const message =
        messages.shift() ??
        (await new Promise<Message>((resolve) => {
          receive = resolve;
        }));
      if (event) assert.equal(message.event, event);
      return message;
    },
  };
}

test("acquire publishes diagnostics and independently opened handles contend in one process", async (t) => {
  const path = await location(t);
  const owner = await acquireLock(path, {
    pid: 123,
    now: () => new Date("2026-10-16T12:00:00Z"),
  });
  t.after(() => owner.release());
  assert.equal(owner.path, path);
  assert.deepEqual(await readLock(path), {
    pid: 123,
    startedAt: "2026-10-16T12:00:00.000Z",
  });
  const open = fs.open;
  let contender: Awaited<ReturnType<typeof fs.open>> | undefined;
  const patch = mock.method(
    fs,
    "open",
    async (...args: Parameters<typeof fs.open>) => {
      contender = await open(...args);
      return contender;
    },
  );
  t.after(() => mock.restoreAll());
  await assert.rejects(acquireLock(path), (error: unknown) => {
    assert.ok(error instanceof LockHeldError);
    assert.deepEqual(error.record, {
      pid: 123,
      startedAt: "2026-10-16T12:00:00.000Z",
    });
    return true;
  });
  patch.mock.restore();
  assert.equal(contender?.fd, -1);
  assert.deepEqual(await readLock(path), {
    pid: 123,
    startedAt: "2026-10-16T12:00:00.000Z",
  });
});

test(
  "ownership excludes contenders before diagnostic publication",
  { timeout: 10000 },
  async (t) => {
    const path = await location(t);
    const owner = child(t, "publication-gap", path);
    await owner.next("paused");
    assert.equal(await readLock(path), undefined);
    await assert.rejects(acquireLock(path), (error: unknown) => {
      assert.ok(error instanceof LockHeldError);
      assert.equal(error.record, undefined);
      return true;
    });
    owner.send("publish");
    await owner.next("acquired");
    assert.equal((await readLock(path))?.pid, owner.proc.pid);
  },
);

for (const content of ["corrupt JSON", '{"pid":999999,"startedAt":"old"}']) {
  test(
    `competing recovery has one owner for ${content}`,
    { timeout: 10000 },
    async (t) => {
      const path = await location(t);
      await fs.mkdir(join(path, ".."), { recursive: true });
      await fs.writeFile(path, content);
      const inode = (await fs.stat(path)).ino;
      const contenders = [
        child(t, "contender", path),
        child(t, "contender", path),
      ];
      await Promise.all(contenders.map((c) => c.next("ready")));
      for (const c of contenders) c.send("acquire");
      const results = await Promise.all(contenders.map((c) => c.next()));
      assert.deepEqual(results.map((r) => r.event).sort(), [
        "acquired",
        "held",
      ]);
      const winner =
        contenders[results.findIndex((r) => r.event === "acquired")]!;
      assert.equal((await readLock(path))?.pid, winner.proc.pid);
      winner.send("release");
      await winner.next("released");
      assert.equal(await readLock(path), undefined);
      const loser = contenders[results.findIndex((r) => r.event === "held")]!;
      loser.send("acquire");
      await loser.next("acquired");
      assert.equal((await readLock(path))?.pid, loser.proc.pid);
      assert.equal((await fs.stat(path)).ino, inode);
    },
  );
}

test(
  "permanent inode excludes a preopened contender and old releases cannot disturb a successor",
  { timeout: 10000 },
  async (t) => {
    const path = await location(t);
    const old = await acquireLock(path);
    t.after(() => old.release());
    const inode = (await fs.stat(path)).ino;
    const preopened = child(t, "preopened", path);
    await preopened.next("ready");
    const releasing = old.release();
    assert.equal(old.release(), releasing);
    await releasing;
    assert.equal(await fs.readFile(path, "utf8"), "");
    assert.equal((await fs.stat(path)).ino, inode);
    const successor = await acquireLock(path, { pid: 456 });
    t.after(() => successor.release());
    const record = await readLock(path);
    assert.equal(record?.pid, 456);
    preopened.send("acquire");
    await preopened.next("held");
    assert.equal(old.release(), releasing);
    await Promise.all([old.release(), old.release()]);
    assert.deepEqual(await readLock(path), record);
    await assert.rejects(acquireLock(path), LockHeldError);
    await successor.release();
    preopened.send("acquire");
    await preopened.next("acquired");
    assert.equal((await fs.stat(path)).ino, inode);
  },
);

test(
  "owner crash releases the lock even while an ordinary spawned child stays alive",
  { timeout: 10000 },
  async (t) => {
    const path = await location(t);
    const owner = child(t, "owner-with-child", path);
    const { childPid } = await owner.next("acquired");
    assert.ok(childPid);
    t.after(() => {
      try {
        process.kill(childPid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    });
    const inode = (await fs.stat(path)).ino;
    await assert.rejects(acquireLock(path), LockHeldError);
    const exited = once(owner.proc, "exit");
    owner.proc.kill("SIGKILL");
    await exited;
    assert.equal(process.kill(childPid, 0), true);
    assert.equal((await readLock(path))?.pid, owner.proc.pid);
    const successor = await acquireLock(path);
    t.after(() => successor.release());
    assert.equal((await fs.stat(path)).ino, inode);
    assert.equal((await readLock(path))?.pid, process.pid);
  },
);

test("diagnostic reads reject wrong shapes but propagate filesystem errors", async (t) => {
  const path = await location(t);
  assert.equal(await readLock(path), undefined);
  await fs.mkdir(join(path, ".."), { recursive: true });
  for (const content of [
    "",
    "{",
    "null",
    "[]",
    "{}",
    '{"pid":"1","startedAt":"now"}',
    '{"pid":1,"startedAt":2}',
  ]) {
    await fs.writeFile(path, content);
    assert.equal(await readLock(path), undefined, content);
  }
  await assert.rejects(readLock(join(path, "child")), { code: "ENOTDIR" });
  await assert.rejects(readLock(join(path, "..")), { code: "EISDIR" });
  await assert.rejects(acquireLock(join(path, "child")), { code: "EEXIST" });
  await assert.rejects(acquireLock(join(path, "..")), { code: "EISDIR" });
});

test("failed metadata write propagates and closes ownership", async (t) => {
  const path = await location(t);
  const open = fs.open;
  const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
  let failedHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  const patch = mock.method(
    fs,
    "open",
    async (...args: Parameters<typeof fs.open>) => {
      const handle = await open(...args);
      failedHandle = handle;
      mock.method(handle, "writeFile", async () => {
        throw failure;
      });
      return handle;
    },
  );
  t.after(() => mock.restoreAll());
  await assert.rejects(
    acquireLock(path),
    (error: unknown) => error === failure,
  );
  patch.mock.restore();
  assert.equal(failedHandle?.fd, -1);
  const successor = await acquireLock(path);
  t.after(() => successor.release());
  assert.equal((await readLock(path))?.pid, process.pid);
});

test("release clearing failure still closes and repeated calls preserve the rejection", async (t) => {
  const path = await location(t);
  const open = fs.open;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  const patch = mock.method(
    fs,
    "open",
    async (...args: Parameters<typeof fs.open>) => {
      handle = await open(...args);
      return handle;
    },
  );
  t.after(() => mock.restoreAll());
  const owner = await acquireLock(path);
  patch.mock.restore();
  assert.ok(handle);
  const failure = Object.assign(new Error("clear failed"), { code: "EIO" });
  mock.method(handle, "truncate", async () => {
    throw failure;
  });
  const released = owner.release();
  assert.equal(owner.release(), released);
  await assert.rejects(released, (error: unknown) => error === failure);
  assert.equal(handle.fd, -1);
  const successor = await acquireLock(path);
  t.after(() => successor.release());
  await assert.rejects(owner.release(), (error: unknown) => error === failure);
  await assert.rejects(acquireLock(path), LockHeldError);
});

for (const phase of ["publication", "clearing", "close-only"]) {
  test(`${phase} failure preserves errors when close rejects`, async (t) => {
    const path = await location(t);
    const primary = new Error("operation failed");
    const cleanup = new Error("close failed");
    const open = fs.open;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    const patch = mock.method(
      fs,
      "open",
      async (...args: Parameters<typeof fs.open>) => {
        handle = await open(...args);
        const close = handle.close.bind(handle);
        t.after(close);
        mock.method(handle, "close", async () => {
          await close(); // Fault injection must not leak the real descriptor.
          throw cleanup;
        });
        if (phase === "publication") {
          mock.method(handle, "writeFile", async () => {
            throw primary;
          });
        }
        return handle;
      },
    );
    t.after(() => mock.restoreAll());
    const acquiring = acquireLock(path);
    const owner = phase === "publication" ? undefined : await acquiring;
    if (phase === "clearing") {
      assert.ok(handle);
      mock.method(handle, "truncate", async () => {
        throw primary;
      });
    }
    const failed = owner ? owner.release() : acquiring;
    if (owner) assert.equal(owner.release(), failed);
    let rejection: unknown;
    await assert.rejects(failed, (error: unknown) => {
      rejection = error;
      if (phase === "close-only") assert.equal(error, cleanup);
      else {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], primary);
        assert.equal(error.errors[1], cleanup);
        assert.equal(error.errors.length, 2);
      }
      return true;
    });
    patch.mock.restore();
    assert.equal(handle?.fd, -1);
    const successor = await acquireLock(path);
    t.after(() => successor.release());
    if (owner) {
      assert.equal(owner.release(), failed);
      await assert.rejects(
        owner.release(),
        (error: unknown) => error === rejection,
      );
    }
    await assert.rejects(acquireLock(path), LockHeldError);
  });
}

test("non-contention flock errors propagate and close the failed handle", async (t) => {
  const path = await location(t);
  const failure = Object.assign(new Error("locking unsupported"), {
    code: "ENOSYS",
  });
  let fd = -1;
  const patch = mock.method(
    fsExt,
    "flock",
    (
      descriptor: number,
      _flags: string,
      callback: (error: NodeJS.ErrnoException) => void,
    ) => {
      fd = descriptor;
      callback(failure);
    },
  );
  t.after(() => mock.restoreAll());
  await assert.rejects(
    acquireLock(path),
    (error: unknown) => error === failure,
  );
  patch.mock.restore();
  assert.throws(() => fsExt.fcntlSync(fd, "getfd"), { code: "EBADF" });
  const successor = await acquireLock(path);
  t.after(() => successor.release());
  const probe = await fs.open(path, constants.O_RDWR);
  t.after(() => probe.close());
  assert.throws(
    () => fsExt.flockSync(probe.fd, "exnb"),
    (error: unknown) =>
      ["EAGAIN", "EWOULDBLOCK"].includes(
        (error as NodeJS.ErrnoException).code!,
      ),
  );
});
