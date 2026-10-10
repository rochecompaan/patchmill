import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  withRunAdmission,
  type RunRepositoryNamespace,
} from "./run-admission.ts";
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test(
  "stale admission guard observation cannot archive a newly acquired guard",
  { timeout: 10_000 },
  async (t) => {
    const root = await fs.mkdtemp(join(tmpdir(), "admission-race-"));
    const coordination = join(root, "patchmill", "run-once"),
      guard = join(coordination, "admission-guard"),
      ownerPath = join(guard, "owner.json");
    const ns: RunRepositoryNamespace = {
      commonDir: root,
      cloneRoot: root,
      runStateDir: join(root, "state"),
      worktreeRoot: join(root, "workspaces"),
      todoRoot: { kind: "workspace-relative", path: ".pi/todos" },
      hostRepository: {
        provider: "github",
        host: "github.test",
        owner: "acme",
        repository: "repo",
      },
    };
    await fs.mkdir(guard, { recursive: true });
    const dead = JSON.stringify({
      version: 1,
      ownerToken: "dead",
      pid: 99999999,
      hostname: hostname(),
    });
    await fs.writeFile(ownerPath, dead);
    const observed = barrier(),
      firstOwns = barrier(),
      finishFirst = barrier();
    const nativeRead = fs.readFile,
      nativeOpen = fs.open;
    let observations = 0;
    const firstAdmission =
      createHash("sha256").update("first").digest("hex") + ".json";
    t.mock.method(
      fs,
      "readFile",
      async (...args: Parameters<typeof fs.readFile>) => {
        const raw = await nativeRead(...args);
        if (String(args[0]) === ownerPath && String(raw) === dead) {
          observations += 1;
          if (observations <= 2) {
            if (observations === 2) observed.release();
            await observed.promise;
          } else if (observations === 4) await firstOwns.promise;
        }
        return raw;
      },
    );
    t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
      if (
        String(args[0]) === join(coordination, "admissions", firstAdmission)
      ) {
        firstOwns.release();
        await finishFirst.promise;
      }
      return nativeOpen(...args);
    });
    syncBuiltinESMExports();
    try {
      const first = withRunAdmission(
        { namespace: ns, mode: "explicit", attemptId: "first" },
        async () => undefined,
      );
      const firstResult = Promise.allSettled([first]);
      const second = withRunAdmission(
        { namespace: ns, mode: "explicit", attemptId: "second" },
        async () => undefined,
      );
      await Promise.allSettled([second]);
      finishFirst.release();
      assert.equal((await firstResult)[0]!.status, "fulfilled");
      const archive = join(coordination, "archive", "admission-guards");
      for (const directory of await fs.readdir(archive))
        assert.equal(
          await nativeRead(join(archive, directory, "owner.json"), "utf8"),
          dead,
        );
    } finally {
      observed.release();
      firstOwns.release();
      finishFirst.release();
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
